//! Locating the VPN command line tools.
use std::path::{Path, PathBuf};

/// Directories GUI apps often lack in PATH (Homebrew, MacPorts, sbin).
const EXTRA_DIRS: &[&str] = &[
    "/opt/homebrew/sbin", "/opt/homebrew/bin", "/usr/local/sbin", "/usr/local/bin", "/opt/local/sbin", "/opt/local/bin", "/usr/sbin", "/sbin",
];

fn exe(name: &str) -> String {
    if cfg!(windows) && !name.ends_with(".exe") { format!("{name}.exe") } else { name.to_string() }
}

fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        p.is_file()
    }
}

/// Find a program in PATH or the extra well-known directories.
pub fn which(name: &str) -> Option<PathBuf> {
    let file = exe(name);
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .chain(EXTRA_DIRS.iter().map(PathBuf::from))
        .map(|d| d.join(&file))
        .find(|p| is_executable(p))
}

/// Numeric components of a version-ish name ("openvpn-2.6.14-openssl-3.0.16" → [2,6,14,3,0,16]).
fn version_key(name: &str) -> Vec<u64> {
    name.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).filter_map(|s| s.parse().ok()).collect()
}

/// Newest `openvpn-*/openvpn` inside a Tunnelblick resources dir.
fn newest_bundled(dir: &Path) -> Option<PathBuf> {
    let mut found: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let bin = e.path().join("openvpn");
            (name.starts_with("openvpn-") && is_executable(&bin)).then(|| (version_key(&name), bin))
        })
        .collect();
    found.sort();
    found.pop().map(|(_, p)| p)
}

/// The OpenVPN that ships inside DevCat.app (Contents/Resources/vpn/openvpn; macOS builds).
pub fn bundled_openvpn() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let p = exe.parent()?.parent()?.join("Resources").join("vpn").join("openvpn");
    is_executable(&p).then_some(p)
}

pub fn find_openvpn() -> Option<PathBuf> {
    if cfg!(windows) {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let p = PathBuf::from(pf).join(r"OpenVPN\bin\openvpn.exe");
        return if p.is_file() { Some(p) } else { which("openvpn") };
    }
    // macOS: DevCat's own build first (known version, LZO/LZ4 included), then the system's.
    // MacPorts' openvpn2 port installs the binary as `openvpn2`.
    bundled_openvpn()
        .or_else(|| which("openvpn")).or_else(|| which("openvpn2")).or_else(|| newest_bundled(Path::new("/Applications/Tunnelblick.app/Contents/Resources/openvpn")))
}

/// `wg-quick` on macOS/Linux, `wireguard.exe` on Windows.
pub fn find_wireguard() -> Option<PathBuf> {
    if cfg!(windows) {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let p = PathBuf::from(pf).join(r"WireGuard\wireguard.exe");
        return if p.is_file() { Some(p) } else { which("wireguard") };
    }
    which("wg-quick")
}

pub fn openvpn_hint() -> String {
    if cfg!(target_os = "macos") {
        "brew install openvpn".into()
    } else if cfg!(windows) {
        "Install OpenVPN Community from https://openvpn.net/community-downloads/".into()
    } else {
        "sudo apt install openvpn".into()
    }
}

pub fn wireguard_hint() -> String {
    if cfg!(target_os = "macos") {
        "brew install wireguard-tools".into()
    } else if cfg!(windows) {
        "Install WireGuard for Windows from https://www.wireguard.com/install/".into()
    } else {
        "sudo apt install wireguard-tools".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(version_key("openvpn-2.6.14-openssl-3.0.16") > version_key("openvpn-2.6.9-openssl-3.0.16"));
        assert!(version_key("openvpn-2.10.0") > version_key("openvpn-2.9.9"));
    }

    #[cfg(unix)]
    #[test]
    fn bundled_pick_newest() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("devcat-tb-{}", uuid::Uuid::new_v4()));
        for v in ["openvpn-2.5.11-openssl-1.1.1w", "openvpn-2.6.12-openssl-3.0.15", "openvpn-2.6.9-openssl-3.0.15"] {
            std::fs::create_dir_all(d.join(v)).unwrap();
            let bin = d.join(v).join("openvpn");
            std::fs::write(&bin, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::fs::create_dir_all(d.join("openvpn-9.9.9")).unwrap(); // no binary
        let p = newest_bundled(&d).unwrap();
        assert!(p.ends_with("openvpn-2.6.12-openssl-3.0.15/openvpn"), "{}", p.display());
        std::fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn which_finds_sh() {
        if cfg!(unix) {
            assert!(which("sh").is_some());
        }
        assert!(which("definitely-not-a-real-binary-xyz").is_none());
    }
}
