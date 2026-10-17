//! Folders phones may not browse, read or write: ones that hold keys and credentials, and
//! DevCat's own data (its remote-access key and paired devices live there).
use once_cell::sync::OnceCell;
use std::path::{Path, PathBuf};

static APP_DATA: OnceCell<PathBuf> = OnceCell::new();

pub fn init(app_data: &Path) {
    let _ = APP_DATA.set(app_data.canonicalize().unwrap_or_else(|_| app_data.to_path_buf()));
}

/// Home-relative folders and files with secrets.
const PRIVATE: &[&str] = &[
    ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker/config.json", ".netrc", ".pgpass", ".my.cnf",
    ".config/gcloud", ".config/gh", ".git-credentials", ".npmrc", ".pypirc", "Library/Keychains",
    ".password-store", ".vault-token",
];

fn denied_roots() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = APP_DATA.get().cloned().into_iter().collect();
    if let Some(h) = dirs::home_dir() {
        let h = h.canonicalize().unwrap_or(h);
        v.extend(PRIVATE.iter().map(|p| h.join(p)));
    }
    v
}

/// The path as it really is on disk (symlinks resolved); for a file that doesn't exist yet,
/// its folder resolved plus the name.
fn real(path: &Path) -> PathBuf {
    if let Ok(p) = path.canonicalize() {
        return p;
    }
    match (path.parent(), path.file_name()) {
        (Some(dir), Some(name)) => dir.canonicalize().map(|d| d.join(name)).unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

/// `Err` with a message for the phone if `path` is in a private place.
pub fn check(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("Use a full path".into());
    }
    let r = real(p);
    if denied_roots().iter().any(|d| r.starts_with(d)) {
        return Err("DevCat doesn't open this from a phone: it holds keys or credentials.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_places() {
        let d = std::env::temp_dir().join(format!("devcat-paths-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(d.join("remote")).unwrap();
        init(&d);
        let home = dirs::home_dir().unwrap();
        assert!(check(&home.join(".ssh/id_ed25519").to_string_lossy()).is_err());
        assert!(check(&home.join(".aws").to_string_lossy()).is_err());
        assert!(check(&d.join("remote/host.key").to_string_lossy()).is_err());
        assert!(check(&home.join("Projects/app/src/main.rs").to_string_lossy()).is_ok());
        assert!(check("relative/path").is_err());
        // A symlink into a private folder is still private.
        let link = std::env::temp_dir().join(format!("devcat-link-{}", uuid::Uuid::new_v4()));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(d.join("remote"), &link).unwrap();
            assert!(check(&link.join("host.key").to_string_lossy()).is_err());
            let _ = std::fs::remove_file(&link);
        }
    }
}
