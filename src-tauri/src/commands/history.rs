use crate::error::AppResult;
use crate::history::{HistoryEntry, SavedQuery};
use crate::state::St;

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn history_list(state: St, connection_id: Option<String>, search: Option<String>, limit: Option<usize>) -> AppResult<Vec<HistoryEntry>> {
    Ok(state.history.list(connection_id.as_deref(), search.as_deref(), limit.unwrap_or(500)))
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn history_clear(state: St) -> AppResult<()> {
    state.history.clear()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn saved_queries_list(state: St) -> AppResult<Vec<SavedQuery>> {
    Ok(state.history.saved_list())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn saved_query_save(state: St, query: SavedQuery) -> AppResult<SavedQuery> {
    state.history.saved_upsert(query)
}

#[cfg_attr(feature = "gui", tauri::command)]
pub async fn saved_query_delete(state: St, id: String) -> AppResult<()> {
    state.history.saved_delete(&id)
}
