use crate::error::{AppError, AppResult};
use crate::models::Bookmark;
use crate::state::St;

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn list_bookmarks(state: St) -> AppResult<Vec<Bookmark>> {
    state.bookmarks.list()
}

/// Bookmark a tree node; returns the existing bookmark if it is already bookmarked.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn add_bookmark(state: St, bookmark: Bookmark) -> AppResult<Bookmark> {
    if state.store.get(&bookmark.connection_id).is_err() {
        return Err(AppError::msg("Connection not found"));
    }
    state.bookmarks.add(bookmark)
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn remove_bookmark(state: St, id: String) -> AppResult<()> {
    state.bookmarks.remove(&id)
}

/// Persist a new Bookmarks order; returns the reordered list.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn reorder_bookmarks(state: St, ids: Vec<String>) -> AppResult<Vec<Bookmark>> {
    state.bookmarks.reorder(&ids)
}
