use crate::db::DynDriver;
use crate::error::{AppError, AppResult};
use crate::history::HistoryStore;
use crate::store::ConnectionStore;
use std::collections::HashMap;
use tokio::sync::RwLock;

pub struct AppState {
    pub store: ConnectionStore,
    pub history: HistoryStore,
    /// Open database sessions keyed by connection id.
    pub sessions: RwLock<HashMap<String, DynDriver>>,
}

impl AppState {
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        Self {
            store: ConnectionStore::new(data_dir.clone()),
            history: HistoryStore::new(data_dir),
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// Get an open session, connecting lazily if the profile exists but is not open yet.
    pub async fn driver(&self, conn_id: &str) -> AppResult<DynDriver> {
        if let Some(d) = self.sessions.read().await.get(conn_id) {
            return Ok(d.clone());
        }
        let cfg = self.store.get(conn_id).map_err(|_| AppError::NotConnected(conn_id.into()))?;
        let d = crate::db::connect(&cfg).await?;
        self.sessions.write().await.insert(conn_id.to_string(), d.clone());
        Ok(d)
    }
}
