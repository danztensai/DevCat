//! Windows: installing OpenVPN / WireGuard from DevCat. The official MSIs listed in
//! `vpn-installers.json` (pinned version + SHA-256) ship inside the Windows build as resources
//! (`vpn-installers/`); when one isn't bundled (e.g. Windows on ARM) it is downloaded from the
//! publisher. Either way the file must match the pinned hash before `msiexec` runs it, behind
//! one UAC prompt. OpenVPN is installed without its GUI / logon tray app, WireGuard without
//! launching its window: DevCat drives both tools itself.
use crate::error::{AppError, AppResult};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MANIFEST: &str = include_str!("../../vpn-installers.json");

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolInstaller {
    pub label: String,
    pub version: String,
    pub msi_properties: Vec<String>,
    /// by Windows architecture: "x64" | "arm64"
    pub files: HashMap<String, InstallerFile>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct InstallerFile {
    pub url: String,
    pub sha256: String,
}

impl InstallerFile {
    pub fn file_name(&self) -> &str {
        self.url.rsplit('/').next().unwrap_or("installer.msi")
    }
}

pub fn manifest() -> HashMap<String, ToolInstaller> {
    let mut m: HashMap<String, serde_json::Value> = serde_json::from_str(MANIFEST).expect("vpn-installers.json is valid");
    m.retain(|k, _| !k.starts_with('_'));
    m.into_iter().map(|(k, v)| (k, serde_json::from_value(v).expect("vpn-installers.json entry"))).collect()
}

/// Installer for `tool` on `arch`, if DevCat has one.
pub fn pick(tool: &str, arch: &str) -> Option<(ToolInstaller, InstallerFile)> {
    let t = manifest().remove(tool)?;
    let f = t.files.get(arch)?.clone();
    Some((t, f))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The file at `path` exists and matches `sha256`.
pub fn file_matches(path: &Path, sha256: &str) -> bool {
    std::fs::read(path).is_ok_and(|b| sha256_hex(&b).eq_ignore_ascii_case(sha256))
}

pub fn msiexec_args(msi: &Path, log: &Path, properties: &[String]) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "/i".into(),
        msi.to_string_lossy().into(),
        "/passive".into(),
        "/norestart".into(),
        "/l*v".into(),
        log.to_string_lossy().into(),
    ];
    a.extend(properties.iter().cloned());
    a
}

/// msiexec exit code → Ok(restart needed) or an error message.
pub fn interpret_exit(code: Option<i32>, label: &str, log: &Path) -> Result<bool, String> {
    match code {
        Some(0) => Ok(false),
        Some(3010) | Some(1641) => Ok(true),
        Some(1602) => Err(super::elevate::CANCELLED.to_string()),
        Some(1618) => Err("Another installation is already running. Try again when it has finished.".into()),
        Some(c) => Err(format!("The {label} installer failed (code {c}). Details: {}", log.display())),
        None => Err(format!("The {label} installer didn't finish")),
    }
}

/// Windows architecture of the OS (not of this process: x64 DevCat also runs on ARM64).
#[cfg(windows)]
fn os_arch() -> String {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture"])
        .creation_flags(0x0800_0000)
        .output();
    match out {
        Ok(o) if String::from_utf8_lossy(&o.stdout).trim().eq_ignore_ascii_case("arm64") => "arm64".into(),
        _ => "x64".into(),
    }
}

#[cfg(not(windows))]
fn os_arch() -> String {
    if cfg!(target_arch = "aarch64") { "arm64".into() } else { "x64".into() }
}

/// Versions DevCat can install on this computer, by tool (empty outside Windows).
pub fn available() -> HashMap<String, String> {
    if !cfg!(windows) {
        return HashMap::new();
    }
    let arch = os_arch();
    manifest().into_iter().filter(|(_, t)| t.files.contains_key(&arch)).map(|(k, t)| (k, t.version)).collect()
}

/// The verified MSI: the bundled copy, else a download into `cache_dir`.
async fn obtain(file: &InstallerFile, bundled_dir: Option<PathBuf>, cache_dir: &Path) -> AppResult<PathBuf> {
    if let Some(p) = bundled_dir.map(|d| d.join(file.file_name())) {
        if file_matches(&p, &file.sha256) {
            return Ok(p);
        }
    }
    let dest = cache_dir.join(file.file_name());
    if file_matches(&dest, &file.sha256) {
        return Ok(dest);
    }
    let bytes = reqwest::Client::new()
        .get(&file.url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::msg(format!("Download failed: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::msg(format!("Download failed: {e}")))?;
    if !sha256_hex(&bytes).eq_ignore_ascii_case(&file.sha256) {
        return Err(AppError::msg(format!("{} didn't match its expected checksum, so it wasn't run", file.file_name())));
    }
    std::fs::create_dir_all(cache_dir)?;
    std::fs::write(&dest, &bytes)?;
    Ok(dest)
}

/// Install `tool` ("openvpn" | "wireguard"). Returns whether Windows wants a restart.
pub async fn install(app: &tauri::AppHandle, tool: &str) -> AppResult<bool> {
    use tauri::Manager;
    if !cfg!(windows) {
        return Err(AppError::msg("Installing VPN tools from DevCat is only available on Windows"));
    }
    let arch = tauri::async_runtime::spawn_blocking(os_arch).await.map_err(|e| AppError::msg(e.to_string()))?;
    let (t, file) = pick(tool, &arch).ok_or_else(|| AppError::msg(format!("DevCat has no {tool} installer for Windows on {arch}")))?;
    let bundled = app.path().resource_dir().ok().map(|d| d.join("vpn-installers"));
    let cache = app.path().app_cache_dir().map_err(|e| AppError::msg(e.to_string()))?.join("vpn-installers");
    let msi = obtain(&file, bundled, &cache).await?;
    let log = cache.join(format!("{tool}-install.log"));
    std::fs::create_dir_all(&cache)?;
    let msiexec = PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())).join(r"System32\msiexec.exe");
    let out = super::elevate::run(&msiexec.to_string_lossy(), &msiexec_args(&msi, &log, &t.msi_properties), true, None).await?;
    interpret_exit(out.code, &t.label, &log).map_err(AppError::msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_complete() {
        let m = manifest();
        for tool in ["openvpn", "wireguard"] {
            let t = &m[tool];
            for arch in ["x64", "arm64"] {
                let f = &t.files[arch];
                assert!(f.url.starts_with("https://") && f.file_name().ends_with(".msi"), "{tool}/{arch}");
                assert_eq!(f.sha256.len(), 64, "{tool}/{arch}");
                assert!(f.sha256.chars().all(|c| c.is_ascii_hexdigit()));
                assert!(f.url.contains(&t.version), "{tool}/{arch} url matches version");
            }
        }
        assert!(m["openvpn"].msi_properties[0].starts_with("ADDLOCAL=OpenVPN,Drivers"));
        assert!(!m["openvpn"].msi_properties[0].contains("GUI"), "no tray app");
        assert_eq!(m["wireguard"].msi_properties, ["DO_NOT_LAUNCH=1"]);
        assert!(pick("openvpn", "x64").is_some() && pick("nope", "x64").is_none() && pick("openvpn", "mips").is_none());
    }

    #[test]
    fn hashing_and_matching() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let d = std::env::temp_dir().join(format!("devcat-inst-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("x.msi");
        std::fs::write(&p, b"abc").unwrap();
        assert!(file_matches(&p, "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"));
        assert!(!file_matches(&p, &"0".repeat(64)));
        assert!(!file_matches(&d.join("missing.msi"), &"0".repeat(64)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn msiexec_command_and_exit_codes() {
        let a = msiexec_args(Path::new(r"C:\a b\o.msi"), Path::new(r"C:\l.log"), &["DO_NOT_LAUNCH=1".into()]);
        assert_eq!(a, ["/i", r"C:\a b\o.msi", "/passive", "/norestart", "/l*v", r"C:\l.log", "DO_NOT_LAUNCH=1"]);
        let log = Path::new("l.log");
        assert_eq!(interpret_exit(Some(0), "OpenVPN", log), Ok(false));
        assert_eq!(interpret_exit(Some(3010), "OpenVPN", log), Ok(true));
        assert_eq!(interpret_exit(Some(1602), "OpenVPN", log), Err(crate::network::elevate::CANCELLED.to_string()));
        assert!(interpret_exit(Some(1603), "OpenVPN", log).unwrap_err().contains("code 1603"));
    }

    #[test]
    fn nothing_offered_outside_windows() {
        if !cfg!(windows) {
            assert!(available().is_empty());
        }
    }
}
