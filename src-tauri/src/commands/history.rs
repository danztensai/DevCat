use crate::error::AppResult;
use crate::history::{HistoryEntry, SavedQuery};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn history_list(state: State<'_, AppState>, connection_id: Option<String>, search: Option<String>, limit: Option<usize>) -> AppResult<Vec<HistoryEntry>> {
    Ok(state.history.list(connection_id.as_deref(), search.as_deref(), limit.unwrap_or(500)))
}

#[tauri::command]
pub async fn history_clear(state: State<'_, AppState>) -> AppResult<()> {
    state.history.clear()
}

#[tauri::command]
pub async fn saved_queries_list(state: State<'_, AppState>) -> AppResult<Vec<SavedQuery>> {
    Ok(state.history.saved_list())
}

#[tauri::command]
pub async fn saved_query_save(state: State<'_, AppState>, query: SavedQuery) -> AppResult<SavedQuery> {
    state.history.saved_upsert(query)
}

#[tauri::command]
pub async fn saved_query_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.history.saved_delete(&id)
}
