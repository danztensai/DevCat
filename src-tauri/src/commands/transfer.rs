//! Export / import / backup / restore / data transfer commands.
//! Logic lives in `crate::db::transfer`; these wrappers resolve sessions and
//! forward progress as `transfer-progress` events:
//! `{ "jobId": options.jobId, "rows": n, "done": bool, ... }`.
//!
//! Every command accepts `options.jobId` (any JSON value) to correlate events.
use crate::db::TableRef;
use crate::db::transfer::{self, ExportSource, TransferTarget};
use crate::error::{AppError, AppResult};
use crate::state::St;
use serde_json::Value;
use std::path::Path;

fn progress_emitter(options: &Value) -> impl Fn(Value) + Send + Sync + 'static {
    let job = options.get("jobId").cloned().unwrap_or(Value::Null);
    move |mut v: Value| {
        if let Value::Object(m) = &mut v {
            m.insert("jobId".into(), job.clone());
        }
        crate::events::emit("transfer-progress", v);
    }
}

/// Export a table (paged) or a query result to a file. `table` OR `query` must be set.
/// Returns number of rows written.
///
/// `format`: `csv` | `tsv` | `json` | `jsonl` | `sql` | `xlsx`.
///
/// Options:
/// - common: `jobId`, `batchSize` (table page size, default 1000), `filter` (table WHERE
///   expression / Mongo filter), `maxRows` (query exports, default 1_000_000), `schema` (query exports)
/// - csv: `delimiter` (default `,`; `\t`/`tab` allowed), `quote` (default `"`), `header` (default true),
///   `nullAs`/`nullText` (default empty string), `lineEnding` (`\n` default | `\r\n`/`crlf` | `\r`), `bom` (default false)
/// - json: `pretty`/`jsonPretty` (default true), `lines` (JSON lines; default true for `jsonl`)
/// - sql: `targetDialect` (`postgres`|`mysql`|`sqlite`|`mssql`, default = source), `tableName`/`sqlTableName`
///   (default source table / `query_result`), `qualified` (keep schema, default true),
///   `includeCreate`/`sqlIncludeCreate` (CREATE TABLE prelude, default false), `includeDrop` (default false),
///   `insertBatch` (rows per INSERT, default 100; max 1000 on MSSQL)
/// - xlsx: `header` (default true), `sheetName` (default `Sheet1`)
#[allow(clippy::too_many_arguments)]
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn export_data(
    state: St,
    conn_id: String,
    table: Option<TableRef>,
    query: Option<String>,
    database: Option<String>,
    format: String,
    path: String,
    options: Value,
) -> AppResult<u64> {
    let driver = state.driver(&conn_id).await?;
    let source = match (table, query.filter(|q| !q.trim().is_empty())) {
        (Some(mut t), _) => {
            if t.database.is_none() {
                t.database = database;
            }
            ExportSource::Table(t)
        }
        (None, Some(sql)) => ExportSource::Query { sql, database },
        (None, None) => return Err(AppError::msg("export needs a table or a query")),
    };
    let progress = progress_emitter(&options);
    transfer::export_data(&driver, source, &format, Path::new(&path), &options, &progress).await
}

/// Import a CSV/JSON file into an existing table. Returns rows inserted.
///
/// `format`: `csv` | `tsv` | `json` (array of objects or JSON lines, auto-detected) | `jsonl`.
///
/// Options:
/// - `jobId`, `batchSize` (rows per insert batch, default 500)
/// - `mapping`: `{ "<fileColumn>": "<tableColumn>" }`; when present only mapped columns are
///   imported (empty target = skip). Default: same names, case-insensitive; header-less CSV
///   maps `column1..N` to table columns by position.
/// - `mode`: `append` (default) | `truncate` (delete all rows first)
/// - `emptyAsNull` (default true for CSV, false for JSON), `nullAs`/`nullText` (string treated as NULL)
/// - csv: `delimiter` (default `,`), `quote` (default `"`), `header` (default true),
///   `skipRows` (lines skipped before the header, default 0). UTF-8 only.
///
/// Values are coerced to the target column types (numbers, booleans); for MongoDB CSV
/// imports numbers and true/false are inferred. Redis is not supported.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn import_data(
    state: St,
    conn_id: String,
    table: TableRef,
    format: String,
    path: String,
    options: Value,
) -> AppResult<u64> {
    let driver = state.driver(&conn_id).await?;
    let progress = progress_emitter(&options);
    transfer::import_data(&driver, &table, &format, Path::new(&path), &options, &progress).await
}

/// Preview the first rows of a CSV/JSON file: `{ columns: [..], rows: [[..]] }`.
///
/// Options: same parsing options as `import_data` plus `limit` (default 100).
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn import_preview(format: String, path: String, options: Value) -> AppResult<Value> {
    tokio::task::spawn_blocking(move || transfer::import_preview(&format, Path::new(&path), &options))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

/// Dump schema (+ optionally data) of a database/schema to a .sql file. For MongoDB `path`
/// is a directory receiving one `<collection>.jsonl` file per collection. Redis: unsupported.
/// Returns a summary (tables, rows, bytes, duration).
///
/// Options: `jobId`, `tables` (array of table names to include; default all),
/// `includeStructure` (CREATE statements, default true; false = data-only dump),
/// `includeData` (default true), `structureOnly` (default false), `dropIfExists` /
/// `dropExisting` / `dropTables` (emit DROP ... IF EXISTS, default true), `includeViews` (default true),
/// `insertBatch` (rows per INSERT, default 100), `batchSize` (read page size, default 1000).
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn backup_database(
    state: St,
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    path: String,
    options: Value,
) -> AppResult<String> {
    let driver = state.driver(&conn_id).await?;
    let progress = progress_emitter(&options);
    transfer::backup_database(&driver, database.as_deref(), schema.as_deref(), Path::new(&path), &options, &progress).await
}

/// Run a .sql script file against a database (statement by statement). For MongoDB, `path`
/// is a directory of `<collection>.jsonl` files as written by `backup_database`.
/// Returns a summary message with executed/failed counts.
///
/// Options: `jobId`, `continueOnError` (default false: stop at the first failing statement
/// and return an error), `schema` (default schema for execution), `dropExisting`
/// (MongoDB only: empty collections before loading).
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn restore_database(
    state: St,
    conn_id: String,
    database: Option<String>,
    path: String,
    options: Value,
) -> AppResult<String> {
    let driver = state.driver(&conn_id).await?;
    let progress = progress_emitter(&options);
    transfer::restore_database(&driver, database.as_deref(), Path::new(&path), &options, &progress).await
}

/// Copy tables (structure + data) between two connections, across dialects.
/// Returns rows copied.
///
/// Options: `jobId`, `createTables` (create missing target tables with mapped types,
/// default true), `dropExisting` (drop target tables first, default false), `truncate`
/// (delete target rows first, default false), `indexes` (create indexes, default true),
/// `foreignKeys` (add FKs after copying, default false), `batchSize` (default 1000),
/// `continueOnError` (skip failing tables, default false).
/// Progress events carry `table`, `tableIndex`, `tables`, `tableRows`, `tableTotal`, `rows`.
#[cfg_attr(feature = "gui", tauri::command)]
pub async fn transfer_tables(
    state: St,
    source_conn: String,
    target_conn: String,
    tables: Vec<TableRef>,
    target_database: Option<String>,
    target_schema: Option<String>,
    options: Value,
) -> AppResult<u64> {
    let src = state.driver(&source_conn).await?;
    let dst = state.driver(&target_conn).await?;
    let progress = progress_emitter(&options);
    let target = TransferTarget { database: target_database, schema: target_schema };
    transfer::transfer_tables(&src, &dst, &tables, &target, &options, &progress).await
}
