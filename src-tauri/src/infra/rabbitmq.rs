//! RabbitMQ management (via the HTTP management API). STUB — to be implemented.
use crate::error::{AppError, AppResult};
use crate::models::ConnectionConfig;

/// Test a RabbitMQ connection profile; returns the RabbitMQ version.
pub async fn test(_cfg: &ConnectionConfig) -> AppResult<String> {
    Err(AppError::Unsupported("rabbitmq not implemented yet".into()))
}
