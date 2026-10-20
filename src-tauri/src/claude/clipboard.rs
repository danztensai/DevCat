//! Put files on the OS clipboard (Copy in the Files tree), the way Explorer / Finder do, so pasting
//! in Slack, Teams or a mail attaches them and pasting in Explorer / Finder copies them.
//! Windows: `CF_HDROP`; macOS: file URLs on the general pasteboard; Linux X11: `text/uri-list`.
use crate::error::{AppError, AppResult};
use std::path::Path;

/// Copy local files or folders to the clipboard.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn fs_copy_files(paths: Vec<String>) -> AppResult<()> {
    if paths.is_empty() {
        return Err(AppError::msg("Nothing to copy"));
    }
    for p in &paths {
        let path = Path::new(p);
        if !path.is_absolute() {
            return Err(AppError::msg("Path must be absolute"));
        }
        if !path.exists() {
            return Err(AppError::msg(format!("{p} doesn't exist")));
        }
    }
    #[cfg(feature = "gui")]
    return crate::rt::spawn_blocking(move || set_files(paths))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?;
    #[cfg(not(feature = "gui"))]
    Err(AppError::msg("Copying files needs the DevCat app"))
}

#[cfg(feature = "gui")]
fn set_files(paths: Vec<String>) -> AppResult<()> {
    use clipboard_rs::{Clipboard, ClipboardContext};
    let ctx = ClipboardContext::new().map_err(|e| AppError::msg(format!("Couldn't open the clipboard: {e}")))?;
    // X11 wants file URIs; Windows and macOS take plain paths.
    #[cfg(all(unix, not(target_os = "macos")))]
    let paths = paths.iter().map(|p| file_uri(p)).collect();
    ctx.set_files(paths).map_err(|e| AppError::msg(format!("Couldn't copy to the clipboard: {e}")))
}

/// `file://` URI for an absolute path (RFC 8089), percent-encoding everything but unreserved bytes and `/`.
#[cfg(any(test, all(unix, not(target_os = "macos"))))]
fn file_uri(path: &str) -> String {
    let mut out = String::from("file://");
    for b in path.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::file_uri;

    #[test]
    fn encodes_file_uris() {
        assert_eq!(file_uri("/home/me/a b/ü#1.md"), "file:///home/me/a%20b/%C3%BC%231.md");
    }
}
