//! Files opened with DevCat (double-click in Finder / Explorer, "Open With", the Dock icon):
//! .ovpn profiles are imported, anything else opens in the editor. macOS delivers them as
//! `RunEvent::Opened`; Windows / Linux as command-line arguments, either at launch or, while
//! DevCat runs, through the single-instance plugin. They're queued until a window takes them
//! (`take_opened_files`) after the "opened-files" poke.
use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    /// The project it belongs to: its git repository, else its folder (paths are shown
    /// relative to it, and git status comes from it).
    pub root: Option<String>,
}

static PENDING: Mutex<Vec<OpenedFile>> = Mutex::new(Vec::new());

/// VPN profiles DevCat imports when opened (everything else opens in the editor).
pub fn is_vpn_profile(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ovpn"))
}

/// The closest folder above `p` with a `.git`, else `p`'s folder.
fn project_root(p: &Path) -> Option<PathBuf> {
    let dir = p.parent()?;
    dir.ancestors().find(|d| d.join(".git").exists()).map(Path::to_path_buf).or_else(|| Some(dir.to_path_buf()))
}

/// File arguments from a command line (`argv[0]` is the program; flags are skipped), relative
/// ones resolved against `cwd`.
pub fn from_args(argv: &[String], cwd: Option<&Path>) -> Vec<PathBuf> {
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            match cwd {
                Some(c) if p.is_relative() => c.join(p),
                _ => p,
            }
        })
        .collect()
}

pub fn accept(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let found: Vec<OpenedFile> = paths
        .into_iter()
        .filter(|p| p.is_file())
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p))
        .map(|p| OpenedFile { root: project_root(&p).map(|r| r.to_string_lossy().into_owned()), path: p.to_string_lossy().into_owned() })
        .collect();
    if found.is_empty() {
        return;
    }
    PENDING.lock().extend(found);
    let _ = app.emit("opened-files", ());
}

/// Files waiting to be opened (each is handed out once).
#[cfg_attr(feature = "gui", tauri::command)]
pub fn take_opened_files() -> Vec<OpenedFile> {
    std::mem::take(&mut *PENDING.lock())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_and_extensions() {
        let argv: Vec<String> = ["devcat", "--flag", "vpn/office.ovpn", "/abs/home.OVPN"].map(String::from).into();
        assert_eq!(from_args(&argv, Some(Path::new("/work"))), [PathBuf::from("/work/vpn/office.ovpn"), PathBuf::from("/abs/home.OVPN")]);
        assert_eq!(from_args(&argv[..1], None), Vec::<PathBuf>::new());
        assert!(is_vpn_profile(Path::new("/abs/home.OVPN")) && is_vpn_profile(Path::new("x.ovpn")));
        assert!(!is_vpn_profile(Path::new("wg0.conf")) && !is_vpn_profile(Path::new("notes.txt")) && !is_vpn_profile(Path::new("ovpn")));
    }

    #[test]
    fn root_is_the_repo_or_the_folder() {
        let d = std::env::temp_dir().join(format!("devcat-opened-{}", std::process::id()));
        std::fs::create_dir_all(d.join("repo/.git")).unwrap();
        std::fs::create_dir_all(d.join("repo/src/deep")).unwrap();
        std::fs::create_dir_all(d.join("loose")).unwrap();
        assert_eq!(project_root(&d.join("repo/src/deep/main.rs")), Some(d.join("repo")));
        assert_eq!(project_root(&d.join("loose/notes.txt")), Some(d.join("loose")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn queue_hands_each_file_out_once() {
        let f = OpenedFile { path: "/x/a.ovpn".into(), root: Some("/x".into()) };
        PENDING.lock().push(f.clone());
        assert_eq!(take_opened_files(), [f]);
        assert!(take_opened_files().is_empty());
    }
}
