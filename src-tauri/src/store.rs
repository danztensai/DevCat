//! Persistence for saved connections (JSON in app data dir) and secrets (OS keychain).
use crate::error::{AppError, AppResult};
use crate::models::ConnectionConfig;
use std::path::PathBuf;


pub struct ConnectionStore {
    path: PathBuf,
}

impl ConnectionStore {
    pub fn new(data_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&data_dir);
        Self { path: data_dir.join("connections.json") }
    }

    pub fn load_all(&self) -> AppResult<Vec<ConnectionConfig>> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let raw = std::fs::read_to_string(&self.path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn write_all(&self, list: &[ConnectionConfig]) -> AppResult<()> {
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(list)?)?;
        std::fs::rename(tmp, &self.path)?;
        Ok(())
    }

    /// Returns the connection with secrets filled in from the keychain.
    pub fn get(&self, id: &str) -> AppResult<ConnectionConfig> {
        let mut c = self
            .load_all()?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::msg(format!("Connection {id} not found")))?;
        c.password = get_secret(&format!("{id}:password"));
        if let Some(ssh) = c.ssh.as_mut() {
            ssh.password = get_secret(&format!("{id}:ssh"));
        }
        Ok(c)
    }

    pub fn save(&self, mut cfg: ConnectionConfig) -> AppResult<ConnectionConfig> {
        if cfg.id.is_empty() {
            cfg.id = uuid::Uuid::new_v4().to_string();
        }
        if let Some(pw) = cfg.password.take() {
            set_secret(&format!("{}:password", cfg.id), &pw)?;
        }
        if let Some(ssh) = cfg.ssh.as_mut() {
            if let Some(pw) = ssh.password.take() {
                set_secret(&format!("{}:ssh", cfg.id), &pw)?;
            }
        }
        let mut all = self.load_all()?;
        match all.iter_mut().find(|c| c.id == cfg.id) {
            Some(existing) => *existing = cfg.clone(),
            None => all.push(cfg.clone()),
        }
        self.write_all(&all)?;
        Ok(cfg)
    }

    /// Apply an edit to every saved profile (secrets untouched) and persist.
    pub fn update_all(&self, mut f: impl FnMut(&mut ConnectionConfig)) -> AppResult<()> {
        let mut all = self.load_all()?;
        all.iter_mut().for_each(&mut f);
        self.write_all(&all)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let mut all = self.load_all()?;
        all.retain(|c| c.id != id);
        self.write_all(&all)?;
        delete_secret(&format!("{id}:password"));
        delete_secret(&format!("{id}:ssh"));
        Ok(())
    }
}

use crate::secrets::{delete as delete_secret, get as get_secret, set as set_secret};
