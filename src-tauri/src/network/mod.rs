//! Network profiles: VPNs (OpenVPN, WireGuard) and standalone SSH tunnels.
//!
//! Profiles are stored in `<app data>/network.json`; VPN config files live in
//! `<app data>/network/<id>.ovpn|.conf` (0600); passwords go to the OS keychain.
//!
//! Live state is pushed to the frontend with two events:
//!   `net-status` → `NetStatus`             (on every state change)
//!   `net-log`    → `{ id, lines: [..] }`   (batched log lines)
mod elevate;
mod openvpn;
mod parse;
mod registry;
mod ssh_tunnel;
pub(crate) mod store;
mod tools;
pub mod traffic;
mod wireguard;

use crate::error::{AppError, AppResult};
use crate::models::{ConnectionConfig, SshConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use store::{NetStore, check_id};

pub(crate) use crate::db::ssh::expand_home;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NetKind {
    /// Standalone SSH tunnel with one or more port forwards.
    Ssh,
    Openvpn,
    Wireguard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PortForward {
    /// "local" = -L bind_port:remote_host:remote_port ; "dynamic" = -D bind_port (SOCKS5)
    pub kind: String,
    /// Local port on 127.0.0.1 (0 = pick a free port).
    pub bind_port: u16,
    #[serde(default)]
    pub remote_host: String,
    #[serde(default)]
    pub remote_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetProfile {
    pub id: String,
    pub name: String,
    pub kind: NetKind,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    /// Connect automatically when DevCat starts.
    #[serde(default)]
    pub auto_connect: bool,
    /// SSH tunnel: the SSH server (password/passphrase kept in the keychain).
    #[serde(default)]
    pub ssh: Option<SshConfig>,
    #[serde(default)]
    pub forwards: Vec<PortForward>,
    /// VPN: username for `auth-user-pass` (OpenVPN).
    #[serde(default)]
    pub vpn_user: Option<String>,
    /// VPN password / private-key passphrase. Never written to disk (keychain).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vpn_password: Option<String>,
    /// Short human description derived from the config, e.g. "udp vpn.example.com:1194".
    #[serde(default)]
    pub summary: Option<String>,
    /// Extra options (e.g. "dns": "true" for WireGuard, "ovpnArgs": extra CLI args).
    #[serde(default)]
    pub options: HashMap<String, String>,
}

/// Profile plus its VPN config text (for editing).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetProfileFull {
    pub profile: NetProfile,
    pub config_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetStatus {
    pub id: String,
    /// "disconnected" | "connecting" | "connected" | "disconnecting" | "error"
    pub state: String,
    /// RFC3339 time the current state was entered.
    pub since: Option<String>,
    /// e.g. "10.8.0.6 via utun5" or "127.0.0.1:5433 → db:5432"
    pub detail: Option<String>,
    pub error: Option<String>,
    /// Bound local ports for SSH tunnels (same order as `forwards`).
    #[serde(default)]
    pub local_ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetTools {
    pub openvpn: Option<String>,
    pub wireguard: Option<String>,
    /// How elevation is obtained: "osascript" (macOS) | "pkexec" (Linux) | "uac" (Windows) | "none".
    pub elevation: String,
    /// Install hints per tool for the current OS, e.g. {"openvpn": "brew install openvpn"}.
    pub install_hints: HashMap<String, String>,
}

/// A host from ~/.ssh/config, for "Import from SSH config".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub user: Option<String>,
    pub identity_file: Option<String>,
}

static STORE: once_cell::sync::OnceCell<NetStore> = once_cell::sync::OnceCell::new();

/// How long `ensure_connected` waits (VPN auth dialogs take a while).
const ENSURE_TIMEOUT: Duration = Duration::from_secs(60);

fn store() -> AppResult<&'static NetStore> {
    STORE.get().ok_or_else(|| AppError::msg("network store not initialised"))
}

/// Called once from `lib.rs` setup.
pub fn init(data_dir: PathBuf) {
    let _ = STORE.set(NetStore::new(data_dir, Box::new(store::Keyring)));
}

/// Called from `lib.rs` setup after `init`: enables events and connects `auto_connect` profiles.
pub fn start(app: tauri::AppHandle) {
    let _ = registry::APP.set(app);
    registry::spawn_log_flusher();
    traffic::spawn_sampler();
    tauri::async_runtime::spawn(async {
        let Ok(profiles) = store().and_then(|s| s.load_all()) else { return };
        for p in profiles.into_iter().filter(|p| p.auto_connect) {
            if let Err(e) = start_connect(&p.id).await {
                registry::log(&p.id, &format!("Auto-connect failed: {e}"));
            }
        }
    });
}

/// Disconnect everything (app exit), so no openvpn / wg interface outlives DevCat.
pub fn shutdown() {
    tauri::async_runtime::block_on(async {
        let all = futures::future::join_all(registry::ids().into_iter().map(|id| async move {
            let _ = disconnect(&id).await;
        }));
        let _ = tokio::time::timeout(Duration::from_secs(20), all).await;
    });
}

/// Make sure the profile `id` is connected (used before opening a connection that
/// declares `options.networkId`). Waits until connected or fails.
pub async fn ensure_connected(app: &tauri::AppHandle, id: &str) -> AppResult<()> {
    let _ = registry::APP.set(app.clone());
    ensure(id).await
}

/// Connect the network profile a connection depends on (`options.networkId`), if any.
pub(crate) async fn ensure_for(cfg: &ConnectionConfig) -> AppResult<()> {
    let Some(id) = cfg.options.get("networkId").map(|s| s.trim()).filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    match registry::APP.get() {
        Some(app) => ensure_connected(app, id).await,
        None => ensure(id).await,
    }
}

async fn ensure(id: &str) -> AppResult<()> {
    check_id(id)?;
    let profile = store()?
        .find(id)
        .map_err(|_| AppError::msg(format!("The network profile ({id}) required by this connection no longer exists")))?;
    if registry::status(id).state == registry::CONNECTED {
        return Ok(());
    }
    start_connect(id).await?;
    match wait_connected(id, ENSURE_TIMEOUT).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(AppError::msg(format!("Timed out waiting for network \"{}\" to connect", profile.name))),
        Err(e) => Err(AppError::msg(format!("Network \"{}\": {e}", profile.name))),
    }
}

/// Begin connecting in the background (no-op if already connecting/connected).
async fn start_connect(id: &str) -> AppResult<()> {
    check_id(id)?;
    let full = store()?.get(id)?;
    let Some(generation) = registry::begin_connect(id) else { return Ok(()) };
    let id = id.to_string();
    tokio::spawn(async move {
        let profile = full.profile;
        let res = match store() {
            Err(e) => Err(e),
            Ok(st) => match profile.kind {
                NetKind::Ssh => ssh_tunnel::connect(id.clone(), generation, profile).await,
                NetKind::Openvpn => openvpn::connect(id.clone(), generation, profile, st).await,
                NetKind::Wireguard => wireguard::connect(id.clone(), generation, profile, st).await,
            },
        };
        if let Err(e) = res {
            registry::set_error(&id, generation, e.to_string());
        }
    });
    Ok(())
}

/// `Ok(true)` once connected, `Ok(false)` on timeout, `Err` if the attempt failed.
async fn wait_connected(id: &str, timeout: Duration) -> AppResult<bool> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let st = registry::status(id);
        match st.state.as_str() {
            registry::CONNECTED => return Ok(true),
            registry::ERROR => return Err(AppError::msg(st.error.unwrap_or_else(|| "connection failed".into()))),
            registry::DISCONNECTED => return Err(AppError::msg("disconnected")),
            _ => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

async fn disconnect(id: &str) -> AppResult<()> {
    let Some((generation, run)) = registry::begin_disconnect(id) else { return Ok(()) };
    let res = match run {
        None => Ok(()),
        Some(registry::Run::Ssh(r)) => {
            registry::log(id, "Disconnecting");
            drop(r);
            Ok(())
        }
        Some(registry::Run::Openvpn(r)) => r.stop(id).await,
        Some(registry::Run::Wireguard(r)) => r.stop(id).await,
    };
    match &res {
        Ok(()) => {
            registry::log(id, "Disconnected");
            registry::set_disconnected(id, generation);
        }
        Err(e) => {
            registry::set_error(id, generation, e.to_string());
        }
    }
    res
}

#[tauri::command]
pub async fn net_list() -> AppResult<Vec<NetProfile>> {
    store()?.load_all()
}

#[tauri::command]
pub async fn net_get(id: String) -> AppResult<NetProfileFull> {
    store()?.get(&id)
}

/// Create (empty id) or update. `config_text` = full .ovpn / WireGuard .conf for VPN kinds.
#[tauri::command]
pub async fn net_save(profile: NetProfile, config_text: Option<String>) -> AppResult<NetProfile> {
    store()?.save(profile, config_text)
}

#[tauri::command]
pub async fn net_delete(id: String) -> AppResult<()> {
    check_id(&id)?;
    let _ = disconnect(&id).await;
    store()?.delete(&id)?;
    registry::remove(&id);
    traffic::remove(&id);
    Ok(())
}

/// Read a .ovpn / .conf file and return an unsaved draft (id "") with the config text.
#[tauri::command]
pub async fn net_import(path: String) -> AppResult<NetProfileFull> {
    let path = expand_home(&path);
    let meta = std::fs::metadata(&path)?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err(AppError::msg("File is too large for a VPN configuration"));
    }
    let text = std::fs::read_to_string(&path)?;
    let kind = parse::detect_kind(&path, &text)
        .ok_or_else(|| AppError::msg("Unrecognized file: expected an OpenVPN (.ovpn) or WireGuard (.conf) configuration"))?;
    let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "VPN".into());
    let mut profile = NetProfile {
        id: String::new(),
        name,
        kind,
        project_id: None,
        color: None,
        auto_connect: false,
        ssh: None,
        forwards: vec![],
        vpn_user: None,
        vpn_password: None,
        summary: None,
        options: HashMap::new(),
    };
    let config_text = match kind {
        NetKind::Openvpn => {
            let base = path.parent().map(PathBuf::from).unwrap_or_default();
            let (text, creds, _warnings) = parse::inline_ovpn_files(&text, &base);
            if let Some((user, pass)) = creds {
                profile.vpn_user = Some(user);
                profile.vpn_password = pass;
            }
            profile.summary = Some(parse::parse_ovpn(&text).summary);
            text
        }
        _ => {
            profile.summary = Some(parse::parse_wireguard(&text).summary);
            text
        }
    };
    Ok(NetProfileFull { profile, config_text: Some(config_text) })
}

/// Parse config text (kind "openvpn" | "wireguard") into a summary + detected fields, for live preview.
#[tauri::command]
pub async fn net_parse(kind: NetKind, text: String) -> AppResult<serde_json::Value> {
    match kind {
        NetKind::Openvpn => Ok(serde_json::to_value(parse::parse_ovpn(&text))?),
        NetKind::Wireguard => Ok(serde_json::to_value(parse::parse_wireguard(&text))?),
        NetKind::Ssh => Err(AppError::msg("SSH tunnels have no config text to parse")),
    }
}

#[tauri::command]
pub async fn net_connect(app: tauri::AppHandle, id: String) -> AppResult<()> {
    let _ = registry::APP.set(app);
    start_connect(&id).await?;
    // Returns early (Ok) if still connecting after the timeout; `net-status` follows.
    wait_connected(&id, ENSURE_TIMEOUT).await.map(|_| ())
}

#[tauri::command]
pub async fn net_disconnect(id: String) -> AppResult<()> {
    check_id(&id)?;
    disconnect(&id).await
}

#[tauri::command]
pub async fn net_status() -> AppResult<Vec<NetStatus>> {
    let live = registry::statuses();
    Ok(store()?
        .load_all()?
        .into_iter()
        .map(|p| live.get(&p.id).cloned().unwrap_or_else(|| registry::idle(&p.id)))
        .collect())
}

#[tauri::command]
pub async fn net_logs(id: String) -> AppResult<Vec<String>> {
    Ok(registry::logs(&id))
}

#[tauri::command]
pub async fn net_tools() -> AppResult<NetTools> {
    tauri::async_runtime::spawn_blocking(|| NetTools {
        openvpn: tools::find_openvpn().map(|p| p.to_string_lossy().to_string()),
        wireguard: tools::find_wireguard().map(|p| p.to_string_lossy().to_string()),
        elevation: elevate::mechanism().into(),
        install_hints: HashMap::from([
            ("openvpn".to_string(), tools::openvpn_hint()),
            ("wireguard".to_string(), tools::wireguard_hint()),
        ]),
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub async fn net_ssh_config_hosts() -> AppResult<Vec<SshConfigHost>> {
    tauri::async_runtime::spawn_blocking(parse::read_ssh_config).await.map_err(|e| AppError::msg(e.to_string()))
}

/// Recent traffic samples (1/s, up to 5 minutes) for a profile; live updates arrive as
/// `net-traffic` events with the same `TrafficSample` shape.
#[tauri::command]
pub async fn net_traffic(id: String) -> AppResult<Vec<traffic::TrafficSample>> {
    Ok(traffic::history(&id))
}
