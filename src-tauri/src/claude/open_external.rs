//! Open a previewed file in its default application — safely.
//!
//! The webview is not given a blanket `opener:allow-open-path` permission because
//! "opening" an executable, script, installer or shortcut runs it. This command only
//! opens regular, non-executable files whose type can't launch code.
use crate::error::{AppError, AppResult};
use std::path::Path;

/// Extensions that execute code, install software or point somewhere else when opened.
const BLOCKED: &[&str] = &[
    // macOS
    "app", "command", "tool", "terminal", "workflow", "action", "scpt", "scptd", "applescript", "osax",
    "pkg", "mpkg", "dmg", "prefpane", "kext", "webloc", "inetloc", "fileloc", "mobileconfig",
    // shells / interpreters
    "sh", "bash", "zsh", "csh", "ksh", "fish", "py", "pyw", "pyc", "rb", "pl", "php", "lua", "jar",
    // Windows
    "exe", "msi", "msix", "appx", "bat", "cmd", "com", "scr", "pif", "cpl", "msc", "ps1", "psm1", "vbs", "vbe",
    "js", "jse", "wsf", "wsh", "hta", "lnk", "url", "reg", "inf", "gadget", "application", "appref-ms",
    // Linux
    "desktop", "appimage", "run", "bin", "deb", "rpm", "snap", "flatpakref",
];

pub(crate) fn check(path: &Path) -> AppResult<()> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| AppError::msg(format!("{}: {e}", path.display())))?;
    if meta.file_type().is_symlink() {
        return Err(AppError::msg("Refusing to open a symbolic link externally"));
    }
    if !meta.is_file() {
        return Err(AppError::msg("Only regular files can be opened externally"));
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if BLOCKED.contains(&ext.as_str()) {
        return Err(AppError::msg(format!(".{ext} files can run code, so DevCat won't open them externally. Use Reveal in Finder instead.")));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 != 0 {
            return Err(AppError::msg("This file is executable, so DevCat won't open it externally. Use Reveal in Finder instead."));
        }
    }
    Ok(())
}

/// Open a regular, non-executable file with the system's default application.
#[tauri::command]
pub async fn fs_open_external(path: String) -> AppResult<()> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err(AppError::msg("Path must be absolute"));
    }
    check(p)?;
    tauri_plugin_opener::open_path(p, None::<&str>).map_err(|e| AppError::msg(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_executables_and_scripts() {
        let dir = std::env::temp_dir().join(format!("devcat-open-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("report.pdf");
        std::fs::write(&ok, b"%PDF-1.4").unwrap();
        assert!(check(&ok).is_ok());
        for name in ["run.command", "x.sh", "evil.JS", "a.lnk", "b.webloc"] {
            let f = dir.join(name);
            std::fs::write(&f, b"x").unwrap();
            assert!(check(&f).is_err(), "{name} must be blocked");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let exe = dir.join("tool");
            std::fs::write(&exe, b"#!/bin/sh").unwrap();
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(check(&exe).is_err(), "executable bit must be blocked");
        }
        assert!(check(&dir).is_err(), "directories (e.g. .app bundles) are refused");
        std::fs::remove_dir_all(&dir).ok();
    }
}
