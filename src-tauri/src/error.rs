use serde::{Serialize, Serializer};

/// Unified error type returned by every Tauri command.
/// Serialized to the frontend as a plain string message.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error("Not connected: {0}")]
    NotConnected(String),
    #[error("Not supported by this driver: {0}")]
    Unsupported(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Tiberius(#[from] tiberius::error::Error),
    #[error(transparent)]
    Mongo(#[from] mongodb::error::Error),
    #[error(transparent)]
    Redis(#[from] redis::RedisError),
    #[error(transparent)]
    Kube(#[from] kube::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Yaml(#[from] serde_yaml::Error),
    #[error(transparent)]
    Keyring(#[from] keyring::Error),
    #[error(transparent)]
    Any(#[from] anyhow::Error),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
