use crate::db::*;
use crate::error::AppResult;
use crate::history::HistoryEntry;
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn db_children(state: State<'_, AppState>, conn_id: String, path: Vec<String>) -> AppResult<Vec<TreeNode>> {
    state.driver(&conn_id).await?.children(&path).await
}

#[tauri::command]
pub async fn db_list_databases(state: State<'_, AppState>, conn_id: String) -> AppResult<Vec<String>> {
    state.driver(&conn_id).await?.list_databases().await
}

/// Execute a script and record it in history (unless `skip_history`, used for
/// internal queries such as Mongo page loads or Redis key lookups).
#[tauri::command]
pub async fn db_execute(state: State<'_, AppState>, conn_id: String, script: String, opts: ExecOptions, skip_history: Option<bool>) -> AppResult<Vec<QueryResult>> {
    let d = state.driver(&conn_id).await?;
    let started = std::time::Instant::now();
    let res = d.execute(&script, &opts).await;
    if skip_history.unwrap_or(false) {
        return res;
    }
    let _ = state.history.add(HistoryEntry {
        id: String::new(),
        connection_id: conn_id,
        database: opts.database.clone(),
        query: script,
        executed_at: String::new(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        success: res.is_ok(),
        error: res.as_ref().err().map(|e| e.to_string()),
    });
    res
}

#[tauri::command]
pub async fn db_cancel(state: State<'_, AppState>, conn_id: String) -> AppResult<()> {
    state.driver(&conn_id).await?.cancel().await
}

#[tauri::command]
pub async fn db_table_data(state: State<'_, AppState>, conn_id: String, req: TableDataRequest) -> AppResult<TableDataPage> {
    state.driver(&conn_id).await?.table_data(&req).await
}

#[tauri::command]
pub async fn db_table_structure(state: State<'_, AppState>, conn_id: String, table: TableRef) -> AppResult<TableStructure> {
    state.driver(&conn_id).await?.table_structure(&table).await
}

#[tauri::command]
pub async fn db_apply_changes(state: State<'_, AppState>, conn_id: String, table: TableRef, changes: Vec<RowChange>) -> AppResult<u64> {
    state.driver(&conn_id).await?.apply_changes(&table, &changes).await
}

#[tauri::command]
pub async fn db_object_ddl(state: State<'_, AppState>, conn_id: String, table: TableRef, kind: NodeKind) -> AppResult<String> {
    state.driver(&conn_id).await?.object_ddl(&table, &kind).await
}

#[tauri::command]
pub async fn db_schema_snapshot(state: State<'_, AppState>, conn_id: String, database: Option<String>, schema: Option<String>) -> AppResult<SchemaSnapshot> {
    state.driver(&conn_id).await?.schema_snapshot(database.as_deref(), schema.as_deref()).await
}

#[tauri::command]
pub async fn db_get_key(state: State<'_, AppState>, conn_id: String, database: Option<String>, key: String) -> AppResult<Value> {
    state.driver(&conn_id).await?.get_key(database.as_deref(), &key).await
}

#[tauri::command]
pub async fn db_set_key(state: State<'_, AppState>, conn_id: String, database: Option<String>, value: Value) -> AppResult<()> {
    state.driver(&conn_id).await?.set_key(database.as_deref(), &value).await
}

#[tauri::command]
pub async fn db_delete_key(state: State<'_, AppState>, conn_id: String, database: Option<String>, key: String) -> AppResult<()> {
    state.driver(&conn_id).await?.delete_key(database.as_deref(), &key).await
}
