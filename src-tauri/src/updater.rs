//! In-app updates from GitHub releases (`latest.json`, signed with the key in tauri.conf.json).
//! The frontend asks `update_check`; `update_install` downloads, verifies and installs the
//! pending update (emitting `update-progress`) and restarts the app.
use crate::error::{AppError, AppResult};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

static PENDING: Lazy<Mutex<Option<Update>>> = Lazy::new(Default::default);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// RFC 3339 publish date, when the manifest has one.
    pub date: Option<String>,
    /// Release notes (Markdown).
    pub notes: Option<String>,
    /// False where this install can't update itself (Linux .deb/.rpm): show a download link instead.
    pub can_install: bool,
}

/// Linux only self-updates when running as an AppImage.
fn can_self_install() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

/// Ask the update server for a newer version. None = up to date.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> AppResult<Option<UpdateInfo>> {
    let updater = app.updater().map_err(|e| AppError::msg(format!("Updater unavailable: {e}")))?;
    let found = updater.check().await.map_err(|e| AppError::msg(format!("Could not check for updates: {e}")))?;
    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        date: u.date.and_then(|d| d.format(&time::format_description::well_known::Rfc3339).ok()),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        can_install: can_self_install(),
    });
    *PENDING.lock() = found;
    Ok(info)
}

/// Download + verify + install the update found by the last `update_check`, then restart.
/// Progress: `update-progress` { downloaded, total? }.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> AppResult<()> {
    if !can_self_install() {
        return Err(AppError::msg("This installation can't update itself; download the new version instead"));
    }
    let update = PENDING.lock().take().ok_or_else(|| AppError::msg("No update pending; check for updates first"))?;
    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    let result = update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update-progress", json!({ "downloaded": downloaded, "total": total }));
            },
            || {},
        )
        .await;
    if let Err(e) = result {
        // Keep it so the user can retry without checking again.
        *PENDING.lock() = Some(update);
        return Err(AppError::msg(format!("Update failed: {e}")));
    }
    // Same teardown as a normal quit (VPNs, tunnels, terminals), then start the new version.
    // Async variant: we're on a runtime worker, where the blocking `shutdown` panics (abort).
    crate::network::shutdown_async().await;
    crate::claude::runner::shutdown_all();
    crate::keep_awake::shutdown();
    app.restart();
}

#[cfg(test)]
mod tests {
    /// Regression: the pre-restart teardown runs inside the async runtime and must not panic.
    #[tokio::test(flavor = "multi_thread")]
    async fn teardown_inside_runtime_does_not_panic() {
        crate::network::shutdown_async().await;
        crate::claude::runner::shutdown_all();
        crate::keep_awake::shutdown();
    }
}
