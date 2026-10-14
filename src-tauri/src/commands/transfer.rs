//! Export / import / backup / restore commands. STUB — to be implemented
//! (logic lives in `crate::db::transfer`).
use crate::db::TableRef;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

/// format: "csv" | "json" | "sql" | "xlsx"(optional). options: delimiter, header, batchSize...
/// `table` OR `query` must be set. Returns number of rows written.
#[tauri::command]
pub async fn export_data(_state: State<'_, AppState>, _conn_id: String, _table: Option<TableRef>, _query: Option<String>, _database: Option<String>, _format: String, _path: String, _options: Value) -> AppResult<u64> {
    Err(AppError::Unsupported("export".into()))
}

/// Import CSV/JSON into an existing table. Returns rows inserted.
#[tauri::command]
pub async fn import_data(_state: State<'_, AppState>, _conn_id: String, _table: TableRef, _format: String, _path: String, _options: Value) -> AppResult<u64> {
    Err(AppError::Unsupported("import".into()))
}

/// Preview the first rows of a CSV/JSON file: `{ columns: [..], rows: [[..]] }`.
#[tauri::command]
pub async fn import_preview(_format: String, _path: String, _options: Value) -> AppResult<Value> {
    Err(AppError::Unsupported("import_preview".into()))
}

/// Dump schema (+ optionally data) of a database/schema to a .sql file.
#[tauri::command]
pub async fn backup_database(_state: State<'_, AppState>, _conn_id: String, _database: Option<String>, _schema: Option<String>, _path: String, _options: Value) -> AppResult<String> {
    Err(AppError::Unsupported("backup".into()))
}

/// Run a .sql script file against a database. Returns a summary message.
#[tauri::command]
pub async fn restore_database(_state: State<'_, AppState>, _conn_id: String, _database: Option<String>, _path: String, _options: Value) -> AppResult<String> {
    Err(AppError::Unsupported("restore".into()))
}

/// Copy table data between two connections (data transfer). Returns rows copied.
#[tauri::command]
pub async fn transfer_tables(_state: State<'_, AppState>, _source_conn: String, _target_conn: String, _tables: Vec<TableRef>, _target_database: Option<String>, _target_schema: Option<String>, _options: Value) -> AppResult<u64> {
    Err(AppError::Unsupported("transfer".into()))
}
