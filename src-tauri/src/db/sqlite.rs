//! Sqlite driver. STUB — to be implemented.
use super::*;
use crate::error::{AppError, AppResult};
use crate::models::{ConnectionConfig, ConnectionKind};
use async_trait::async_trait;

pub struct SqliteDriver {}

impl SqliteDriver {
    pub async fn connect(_cfg: &ConnectionConfig) -> AppResult<Self> {
        Err(AppError::Unsupported("Sqlite driver not implemented yet".into()))
    }
}

#[async_trait]
impl Driver for SqliteDriver {
    fn kind(&self) -> ConnectionKind { ConnectionKind::Sqlite }
    fn dialect(&self) -> Dialect { Dialect::Sqlite }
    async fn server_version(&self) -> AppResult<String> { Err(AppError::Unsupported("todo".into())) }
    async fn children(&self, _path: &[String]) -> AppResult<Vec<TreeNode>> { Err(AppError::Unsupported("todo".into())) }
    async fn list_databases(&self) -> AppResult<Vec<String>> { Err(AppError::Unsupported("todo".into())) }
    async fn execute(&self, _script: &str, _opts: &ExecOptions) -> AppResult<Vec<QueryResult>> { Err(AppError::Unsupported("todo".into())) }
    async fn table_data(&self, _req: &TableDataRequest) -> AppResult<TableDataPage> { Err(AppError::Unsupported("todo".into())) }
    async fn table_structure(&self, _table: &TableRef) -> AppResult<TableStructure> { Err(AppError::Unsupported("todo".into())) }
    async fn apply_changes(&self, _table: &TableRef, _changes: &[RowChange]) -> AppResult<u64> { Err(AppError::Unsupported("todo".into())) }
    async fn object_ddl(&self, _table: &TableRef, _kind: &NodeKind) -> AppResult<String> { Err(AppError::Unsupported("todo".into())) }
    async fn schema_snapshot(&self, _database: Option<&str>, _schema: Option<&str>) -> AppResult<SchemaSnapshot> { Err(AppError::Unsupported("todo".into())) }
    async fn close(&self) {}
}
