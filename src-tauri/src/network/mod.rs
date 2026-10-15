//! Network profiles: VPNs (OpenVPN, WireGuard) and standalone SSH tunnels.
//!
//! CONTRACT (types + command signatures) — implementation is in progress.
//! Profiles are stored in `<app data>/network.json`; VPN config files live in
//! `<app data>/network/<id>.ovpn|.conf` (0600); passwords go to the OS keychain.
//!
//! Live state is pushed to the frontend with two events:
//!   `net-status` → `NetStatus`             (on every state change)
//!   `net-log`    → `{ id, lines: [..] }`   (batched log lines)
use crate::error::{AppError, AppResult};
use crate::models::SshConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

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

static DATA_DIR: once_cell::sync::OnceCell<PathBuf> = once_cell::sync::OnceCell::new();

/// Called once from `lib.rs` setup.
pub fn init(data_dir: PathBuf) {
    let _ = DATA_DIR.set(data_dir);
}

/// Make sure the profile `id` is connected (used before opening a connection that
/// declares `options.networkId`). Waits until connected or fails.
pub async fn ensure_connected(_app: &tauri::AppHandle, _id: &str) -> AppResult<()> {
    Err(AppError::Unsupported("network profiles not implemented yet".into()))
}

#[tauri::command] pub async fn net_list() -> AppResult<Vec<NetProfile>> { Ok(vec![]) }
#[tauri::command] pub async fn net_get(_id: String) -> AppResult<NetProfileFull> { Err(AppError::Unsupported("todo".into())) }
/// Create (empty id) or update. `config_text` = full .ovpn / WireGuard .conf for VPN kinds.
#[tauri::command] pub async fn net_save(_profile: NetProfile, _config_text: Option<String>) -> AppResult<NetProfile> { Err(AppError::Unsupported("todo".into())) }
#[tauri::command] pub async fn net_delete(_id: String) -> AppResult<()> { Err(AppError::Unsupported("todo".into())) }
/// Read a .ovpn / .conf file and return an unsaved draft (id "") with the config text.
#[tauri::command] pub async fn net_import(_path: String) -> AppResult<NetProfileFull> { Err(AppError::Unsupported("todo".into())) }
/// Parse config text (kind "openvpn" | "wireguard") into a summary + detected fields, for live preview.
#[tauri::command] pub async fn net_parse(_kind: NetKind, _text: String) -> AppResult<serde_json::Value> { Err(AppError::Unsupported("todo".into())) }
#[tauri::command] pub async fn net_connect(_app: tauri::AppHandle, _id: String) -> AppResult<()> { Err(AppError::Unsupported("todo".into())) }
#[tauri::command] pub async fn net_disconnect(_id: String) -> AppResult<()> { Err(AppError::Unsupported("todo".into())) }
#[tauri::command] pub async fn net_status() -> AppResult<Vec<NetStatus>> { Ok(vec![]) }
#[tauri::command] pub async fn net_logs(_id: String) -> AppResult<Vec<String>> { Ok(vec![]) }
#[tauri::command] pub async fn net_tools() -> AppResult<NetTools> { Err(AppError::Unsupported("todo".into())) }
#[tauri::command] pub async fn net_ssh_config_hosts() -> AppResult<Vec<SshConfigHost>> { Ok(vec![]) }
