//! Query history and saved queries (favorites), stored as JSON in the app data dir.
use crate::error::AppResult;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const MAX_HISTORY: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub connection_id: String,
    pub database: Option<String>,
    pub query: String,
    pub executed_at: String,
    pub elapsed_ms: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub connection_id: Option<String>,
    pub database: Option<String>,
    pub query: String,
    pub updated_at: String,
}

pub struct HistoryStore {
    history_path: PathBuf,
    saved_path: PathBuf,
    lock: Mutex<()>,
}

fn read_json<T: for<'de> Deserialize<'de>>(p: &PathBuf) -> Vec<T> {
    std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

impl HistoryStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            history_path: dir.join("history.json"),
            saved_path: dir.join("saved_queries.json"),
            lock: Mutex::new(()),
        }
    }

    pub fn add(&self, mut e: HistoryEntry) -> AppResult<HistoryEntry> {
        let _g = self.lock.lock();
        let mut all: Vec<HistoryEntry> = read_json(&self.history_path);
        if e.id.is_empty() {
            e.id = uuid::Uuid::new_v4().to_string();
        }
        if e.executed_at.is_empty() {
            e.executed_at = chrono::Utc::now().to_rfc3339();
        }
        all.insert(0, e.clone());
        all.truncate(MAX_HISTORY);
        std::fs::write(&self.history_path, serde_json::to_string(&all)?)?;
        Ok(e)
    }

    pub fn list(&self, connection_id: Option<&str>, search: Option<&str>, limit: usize) -> Vec<HistoryEntry> {
        let _g = self.lock.lock();
        let s = search.map(|s| s.to_lowercase());
        read_json::<HistoryEntry>(&self.history_path)
            .into_iter()
            .filter(|e| connection_id.map_or(true, |c| e.connection_id == c))
            .filter(|e| s.as_ref().map_or(true, |s| e.query.to_lowercase().contains(s)))
            .take(limit)
            .collect()
    }

    pub fn clear(&self) -> AppResult<()> {
        let _g = self.lock.lock();
        std::fs::write(&self.history_path, "[]")?;
        Ok(())
    }

    pub fn saved_list(&self) -> Vec<SavedQuery> {
        let _g = self.lock.lock();
        read_json(&self.saved_path)
    }

    pub fn saved_upsert(&self, mut q: SavedQuery) -> AppResult<SavedQuery> {
        let _g = self.lock.lock();
        let mut all: Vec<SavedQuery> = read_json(&self.saved_path);
        if q.id.is_empty() {
            q.id = uuid::Uuid::new_v4().to_string();
        }
        q.updated_at = chrono::Utc::now().to_rfc3339();
        match all.iter_mut().find(|x| x.id == q.id) {
            Some(x) => *x = q.clone(),
            None => all.push(q.clone()),
        }
        std::fs::write(&self.saved_path, serde_json::to_string_pretty(&all)?)?;
        Ok(q)
    }

    pub fn saved_delete(&self, id: &str) -> AppResult<()> {
        let _g = self.lock.lock();
        let mut all: Vec<SavedQuery> = read_json(&self.saved_path);
        all.retain(|x| x.id != id);
        std::fs::write(&self.saved_path, serde_json::to_string_pretty(&all)?)?;
        Ok(())
    }
}
