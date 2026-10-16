//! OS keychain access (service "dev.devcat.app") with an in-memory cache for the life of the
//! process. On macOS every keychain read by an app the item's access list doesn't trust shows a
//! password prompt, so each secret is read at most once per launch instead of on every connect.
//! Only found values are cached; a missing entry is looked up again next time.
use crate::error::AppResult;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::LazyLock;

const SERVICE: &str = "dev.devcat.app";

static CACHE: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn get(key: &str) -> Option<String> {
    if let Some(v) = CACHE.lock().get(key) {
        return Some(v.clone());
    }
    if cfg!(test) {
        return None; // tests never touch the real keychain
    }
    let v = keyring::Entry::new(SERVICE, key).ok()?.get_password().ok()?;
    CACHE.lock().insert(key.to_string(), v.clone());
    Some(v)
}

/// Store `value`; an empty value deletes the entry.
pub fn set(key: &str, value: &str) -> AppResult<()> {
    if cfg!(test) {
        if value.is_empty() { CACHE.lock().remove(key); } else { CACHE.lock().insert(key.into(), value.into()); }
        return Ok(());
    }
    let entry = keyring::Entry::new(SERVICE, key)?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        CACHE.lock().remove(key);
    } else {
        entry.set_password(value)?;
        CACHE.lock().insert(key.to_string(), value.to_string());
    }
    Ok(())
}

pub fn delete(key: &str) {
    CACHE.lock().remove(key);
    if cfg!(test) {
        return;
    }
    if let Ok(e) = keyring::Entry::new(SERVICE, key) {
        let _ = e.delete_credential();
    }
}
