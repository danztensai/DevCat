//! Helm 3 releases, read straight from the cluster (no `helm` binary needed).
//!
//! Helm stores every release revision as a Secret labelled `owner=helm`
//! (`sh.helm.release.v1.<name>.v<revision>`). Its `release` field is
//! base64(gzip(JSON)) on top of the Secret's own base64 encoding.
use super::{conn, friendly};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use base64::Engine;
use k8s_openapi::api::core::v1::Secret;
use kube::api::{Api, ListParams};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::Read;
use tauri::State;

/// Decode the `release` payload of a Helm release Secret into JSON.
pub(crate) fn decode_release(raw: &[u8]) -> AppResult<Value> {
    let text: Vec<u8> = raw.iter().copied().filter(|b| !b.is_ascii_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&text)
        .map_err(|e| AppError::msg(format!("Invalid Helm release encoding: {e}")))?;
    let json = if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(bytes.as_slice()).read_to_end(&mut out)?;
        out
    } else {
        bytes
    };
    Ok(serde_json::from_slice(&json)?)
}

fn label<'a>(s: &'a Secret, k: &str) -> Option<&'a str> {
    s.metadata.labels.as_ref()?.get(k).map(String::as_str)
}

fn revision(s: &Secret) -> i64 {
    label(s, "version").and_then(|v| v.parse().ok()).unwrap_or(0)
}

fn release_of(s: &Secret) -> AppResult<Value> {
    let raw = s
        .data
        .as_ref()
        .and_then(|d| d.get("release"))
        .ok_or_else(|| AppError::msg("Helm secret has no release data"))?;
    decode_release(&raw.0)
}

/// Compact summary of one release revision.
fn summary(rel: &Value, s: &Secret) -> Value {
    let meta = &rel["chart"]["metadata"];
    let info = &rel["info"];
    json!({
        "name": rel["name"].as_str().or(label(s, "name")),
        "namespace": rel["namespace"].as_str().or(s.metadata.namespace.as_deref()),
        "revision": rel["version"].as_i64().unwrap_or_else(|| revision(s)),
        "status": info["status"].as_str().or(label(s, "status")),
        "chart": meta["name"],
        "chartVersion": meta["version"],
        "appVersion": meta["appVersion"],
        "icon": meta["icon"],
        "chartDescription": meta["description"],
        "updated": info["last_deployed"],
        "firstDeployed": info["first_deployed"],
        "description": info["description"],
    })
}

async fn helm_secrets(state: &AppState, conn_id: &str, namespace: Option<&str>, name: Option<&str>) -> AppResult<Vec<Secret>> {
    let c = conn(state, conn_id).await?;
    let api: Api<Secret> = match namespace.filter(|n| !n.is_empty()) {
        Some(ns) => Api::namespaced(c.client.clone(), ns),
        None => Api::all(c.client.clone()),
    };
    let mut sel = "owner=helm".to_string();
    if let Some(n) = name {
        sel.push_str(&format!(",name={n}"));
    }
    Ok(api.list(&ListParams::default().labels(&sel)).await.map_err(friendly)?.items)
}

/// Latest revision of every Helm release (optionally in one namespace).
#[tauri::command]
pub async fn k8s_helm_releases(state: State<'_, AppState>, conn_id: String, namespace: Option<String>) -> AppResult<Vec<Value>> {
    let secrets = helm_secrets(&state, &conn_id, namespace.as_deref(), None).await?;
    let mut latest: HashMap<(String, String), &Secret> = HashMap::new();
    for s in &secrets {
        let key = (s.metadata.namespace.clone().unwrap_or_default(), label(s, "name").unwrap_or_default().to_string());
        if latest.get(&key).is_none_or(|cur| revision(s) > revision(cur)) {
            latest.insert(key, s);
        }
    }
    let mut out: Vec<Value> = latest
        .values()
        .map(|s| match release_of(s) {
            Ok(rel) => summary(&rel, s),
            // Keep undecodable releases visible with what the labels tell us.
            Err(e) => json!({
                "name": label(s, "name"), "namespace": s.metadata.namespace, "revision": revision(s),
                "status": label(s, "status"), "error": e.to_string(),
            }),
        })
        .collect();
    out.sort_by(|a, b| {
        (a["namespace"].as_str(), a["name"].as_str()).cmp(&(b["namespace"].as_str(), b["name"].as_str()))
    });
    Ok(out)
}

/// One release in detail: values, manifest, notes and revision history.
#[tauri::command]
pub async fn k8s_helm_release(
    state: State<'_, AppState>,
    conn_id: String,
    namespace: String,
    name: String,
    revision: Option<i64>,
) -> AppResult<Value> {
    let mut secrets = helm_secrets(&state, &conn_id, Some(&namespace), Some(&name)).await?;
    if secrets.is_empty() {
        return Err(AppError::msg(format!("Helm release {namespace}/{name} not found")));
    }
    secrets.sort_by_key(|s| std::cmp::Reverse(self::revision(s)));
    let chosen = match revision {
        Some(r) => secrets.iter().find(|s| self::revision(s) == r).ok_or_else(|| AppError::msg(format!("Revision {r} not found")))?,
        None => &secrets[0],
    };
    let rel = release_of(chosen)?;
    let history: Vec<Value> = secrets
        .iter()
        .map(|s| match release_of(s) {
            Ok(r) => summary(&r, s),
            Err(_) => json!({ "revision": self::revision(s), "status": label(s, "status") }),
        })
        .collect();
    let values = if rel["config"].is_null() || rel["config"].as_object().is_some_and(|m| m.is_empty()) {
        String::new()
    } else {
        serde_yaml::to_string(&rel["config"])?
    };
    let defaults = if rel["chart"]["values"].is_null() { String::new() } else { serde_yaml::to_string(&rel["chart"]["values"])? };
    Ok(json!({
        "summary": summary(&rel, chosen),
        "values": values,
        "defaultValues": defaults,
        "manifest": rel["manifest"],
        "notes": rel["info"]["notes"],
        "history": history,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn decodes_gzip_and_plain_release_payloads() {
        let rel = json!({ "name": "web", "version": 3, "info": { "status": "deployed" }, "chart": { "metadata": { "name": "nginx", "version": "1.2.3" } } });
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(rel.to_string().as_bytes()).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(gz.finish().unwrap());
        assert_eq!(decode_release(b64.as_bytes()).unwrap()["chart"]["metadata"]["name"], "nginx");
        let plain = base64::engine::general_purpose::STANDARD.encode(rel.to_string());
        assert_eq!(decode_release(format!("{plain}\n").as_bytes()).unwrap()["version"], 3);
        assert!(decode_release(b"%%%").is_err());
    }
}
