//! Files opened with DevCat (.ovpn: double-click in Finder / Explorer, "Open With", the Dock
//! icon). macOS delivers them as `RunEvent::Opened`; Windows / Linux as command-line arguments,
//! either at launch or, while DevCat runs, through the single-instance plugin. They're queued
//! until a window takes them (`take_opened_files`) after the "opened-files" poke.
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Extensions DevCat imports when opened.
pub fn is_openable(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ovpn"))
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
    let found: Vec<String> = paths
        .into_iter()
        .filter(|p| is_openable(p) && p.is_file())
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p).to_string_lossy().into_owned())
        .collect();
    if found.is_empty() {
        return;
    }
    PENDING.lock().extend(found);
    let _ = app.emit("opened-files", ());
}

/// Files waiting to be imported (each is handed out once).
#[tauri::command]
pub fn take_opened_files() -> Vec<String> {
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
        assert!(is_openable(Path::new("/abs/home.OVPN")) && is_openable(Path::new("x.ovpn")));
        assert!(!is_openable(Path::new("wg0.conf")) && !is_openable(Path::new("notes.txt")) && !is_openable(Path::new("ovpn")));
    }

    #[test]
    fn queue_hands_each_file_out_once() {
        PENDING.lock().push("/x/a.ovpn".into());
        assert_eq!(take_opened_files(), ["/x/a.ovpn"]);
        assert!(take_opened_files().is_empty());
    }
}
