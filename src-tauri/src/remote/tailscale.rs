//! This computer's address on its Tailscale network (tailnet), for `devcat serve --tailscale`:
//! phones with Tailscale on reach it at that one address at home and away, so a browser paired
//! there stays paired.
use serde_json::Value;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::time::Duration;

/// Tailscale's addresses (100.64.0.0/10).
pub fn is_tailnet_ip(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 100 && (64..128).contains(&o[1])
}

/// The host phones should use, from `tailscale status --json`: the MagicDNS name, else the
/// first IPv4 address. An error says why there's none (not running, logged out…).
pub fn parse_status(json: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("Couldn't read Tailscale's status: {e}"))?;
    let state = v["BackendState"].as_str().unwrap_or_default();
    if state != "Running" {
        let why = if state.is_empty() { "not running".to_string() } else { state.to_lowercase() };
        return Err(format!("Tailscale isn't connected ({why}): run `tailscale up`, or start without --tailscale"));
    }
    let me = &v["Self"];
    if let Some(name) = me["DNSName"].as_str().map(|n| n.trim_end_matches('.')).filter(|n| !n.is_empty()) {
        return Ok(name.to_string());
    }
    me["TailscaleIPs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|ip| ip.as_str()?.parse::<Ipv4Addr>().ok())
        .next()
        .map(|ip| ip.to_string())
        .ok_or_else(|| "Tailscale is connected but this computer has no tailnet address yet".into())
}

async fn tailscale_bin() -> Option<PathBuf> {
    if let Some(p) = crate::claude::locate::find_program("tailscale").await {
        return Some(p);
    }
    // The Mac App Store / standalone app keeps its CLI inside the bundle.
    let app = PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    app.is_file().then_some(app)
}

/// This computer's tailnet host name (or address).
pub async fn tailnet_host() -> Result<String, String> {
    let bin = tailscale_bin().await.ok_or("Tailscale isn't installed (no `tailscale` command found)")?;
    let mut cmd = crate::claude::locate::tool_command(&bin.to_string_lossy()).await;
    cmd.args(["status", "--json"]).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(5), cmd.output())
        .await
        .map_err(|_| "Tailscale didn't answer in time".to_string())?
        .map_err(|e| format!("Couldn't run tailscale: {e}"))?;
    parse_status(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tailnet_ips() {
        assert!(is_tailnet_ip("100.64.181.64".parse().unwrap()));
        assert!(is_tailnet_ip("100.127.0.1".parse().unwrap()));
        assert!(!is_tailnet_ip("100.128.0.1".parse().unwrap()));
        assert!(!is_tailnet_ip("192.168.0.130".parse().unwrap()));
    }

    #[test]
    fn status() {
        let running = r#"{"BackendState":"Running","Self":{"DNSName":"mini.tail123.ts.net.","TailscaleIPs":["100.64.1.2","fd7a::1"]}}"#;
        assert_eq!(parse_status(running).unwrap(), "mini.tail123.ts.net");
        let no_dns = r#"{"BackendState":"Running","Self":{"DNSName":"","TailscaleIPs":["fd7a::1","100.64.1.2"]}}"#;
        assert_eq!(parse_status(no_dns).unwrap(), "100.64.1.2");
        let stopped = r#"{"BackendState":"Stopped","Self":{"DNSName":"mini.tail123.ts.net."}}"#;
        assert!(parse_status(stopped).unwrap_err().contains("stopped"));
        assert!(parse_status("").is_err());
    }
}
