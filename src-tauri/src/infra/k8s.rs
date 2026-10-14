//! Kubernetes monitoring (Lens-like). STUB — to be implemented.
use crate::error::{AppError, AppResult};
use crate::models::ConnectionConfig;

/// Test a Kubernetes connection profile; returns the server version.
pub async fn test(_cfg: &ConnectionConfig) -> AppResult<String> {
    Err(AppError::Unsupported("kubernetes not implemented yet".into()))
}
