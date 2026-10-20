//! Bookmarks: database objects pinned to the top of the Connections sidebar.
//! Stored as `bookmarks.json` next to `connections.json`.
use crate::error::{AppError, AppResult};
use crate::models::Bookmark;
use parking_lot::Mutex;
use std::path::PathBuf;

pub struct BookmarkStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl BookmarkStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { path: data_dir.join("bookmarks.json"), lock: Mutex::new(()) }
    }

    fn read(&self) -> AppResult<Vec<Bookmark>> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let mut list: Vec<Bookmark> = serde_json::from_str(&std::fs::read_to_string(&self.path)?)?;
        list.sort_by_key(|b| b.order);
        Ok(list)
    }

    fn write(&self, list: &[Bookmark]) -> AppResult<()> {
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(list)?)?;
        std::fs::rename(tmp, &self.path)?;
        Ok(())
    }

    pub fn list(&self) -> AppResult<Vec<Bookmark>> {
        let _g = self.lock.lock();
        self.read()
    }

    /// Add a bookmark; the id and order are assigned here. Bookmarking the same
    /// connection + path again returns the existing bookmark unchanged.
    pub fn add(&self, mut b: Bookmark) -> AppResult<Bookmark> {
        let _g = self.lock.lock();
        if b.connection_id.is_empty() || b.path.is_empty() {
            return Err(AppError::msg("A bookmark needs a connection and a path"));
        }
        let mut all = self.read()?;
        if let Some(existing) = all.iter().find(|x| x.connection_id == b.connection_id && x.path == b.path) {
            return Ok(existing.clone());
        }
        b.id = uuid::Uuid::new_v4().to_string();
        b.order = all.iter().map(|x| x.order).max().map_or(0, |m| m + 1);
        all.push(b.clone());
        self.write(&all)?;
        Ok(b)
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let _g = self.lock.lock();
        let mut all = self.read()?;
        all.retain(|b| b.id != id);
        self.write(&all)
    }

    /// Reorder bookmarks to match `ids`; bookmarks not listed keep their relative order after them.
    pub fn reorder(&self, ids: &[String]) -> AppResult<Vec<Bookmark>> {
        let _g = self.lock.lock();
        let mut all = self.read()?;
        let pos = |id: &str| ids.iter().position(|x| x == id).unwrap_or(usize::MAX);
        all.sort_by_key(|b| pos(&b.id));
        for (i, b) in all.iter_mut().enumerate() {
            b.order = i as i64;
        }
        self.write(&all)?;
        Ok(all)
    }

    /// Drop every bookmark of a deleted connection.
    pub fn remove_for_connection(&self, connection_id: &str) -> AppResult<()> {
        let _g = self.lock.lock();
        let mut all = self.read()?;
        let before = all.len();
        all.retain(|b| b.connection_id != connection_id);
        if all.len() == before {
            return Ok(());
        }
        self.write(&all)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{NodeKind, TableRef};

    /// Removes its folder when dropped.
    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    fn store() -> (Dir, BookmarkStore) {
        let d = std::env::temp_dir().join(format!("devcat-bookmarks-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        let s = BookmarkStore::new(d.clone());
        (Dir(d), s)
    }

    fn bm(conn: &str, path: &[&str], kind: NodeKind) -> Bookmark {
        Bookmark {
            id: String::new(),
            connection_id: conn.into(),
            path: path.iter().map(|s| s.to_string()).collect(),
            label: path.last().map(|s| s.to_string()).unwrap_or_default(),
            kind,
            table: None,
            order: 0,
        }
    }

    fn labels(s: &BookmarkStore) -> Vec<String> {
        s.list().unwrap().into_iter().map(|b| b.label).collect()
    }

    #[test]
    fn missing_file_is_empty() {
        let (_d, s) = store();
        assert!(s.list().unwrap().is_empty());
    }

    #[test]
    fn add_assigns_id_and_order_and_dedupes() {
        let (_d, s) = store();
        let a = s.add(bm("c1", &["app"], NodeKind::Database)).unwrap();
        let users = TableRef { database: Some("app".into()), schema: Some("public".into()), name: "users".into() };
        let b = s.add(Bookmark { table: Some(users), ..bm("c1", &["app", "public", "tables", "users"], NodeKind::Table) }).unwrap();
        assert!(!a.id.is_empty() && a.id != b.id);
        assert_eq!((a.order, b.order), (0, 1));
        let again = s.add(bm("c1", &["app"], NodeKind::Database)).unwrap();
        assert_eq!(again.id, a.id, "same connection + path returns the existing bookmark");
        let other = s.add(bm("c2", &["app"], NodeKind::Database)).unwrap();
        assert_ne!(other.id, a.id, "same path on another connection is a new bookmark");
        let list = s.list().unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[1].table.as_ref().unwrap().name, "users");
        assert!(s.add(bm("", &["x"], NodeKind::Database)).is_err(), "connection is required");
        assert!(s.add(bm("c1", &[], NodeKind::Database)).is_err(), "path is required");
    }

    #[test]
    fn remove_and_reorder() {
        let (_d, s) = store();
        let a = s.add(bm("c1", &["a"], NodeKind::Database)).unwrap();
        s.add(bm("c1", &["b"], NodeKind::Database)).unwrap();
        let c = s.add(bm("c1", &["c"], NodeKind::Database)).unwrap();
        let order: Vec<_> = s.reorder(&[c.id.clone(), a.id.clone()]).unwrap().into_iter().map(|x| x.label).collect();
        assert_eq!(order, ["c", "a", "b"], "unlisted bookmarks keep their relative order after the listed ones");
        assert_eq!(labels(&s), ["c", "a", "b"]);
        s.remove(&a.id).unwrap();
        assert_eq!(labels(&s), ["c", "b"]);
        let d = s.add(bm("c1", &["d"], NodeKind::Database)).unwrap();
        assert_eq!(s.list().unwrap().last().unwrap().id, d.id, "new bookmarks go last");
    }

    #[test]
    fn remove_for_connection_keeps_others() {
        let (_d, s) = store();
        s.add(bm("c1", &["a"], NodeKind::Database)).unwrap();
        s.add(bm("c2", &["b"], NodeKind::Database)).unwrap();
        s.add(bm("c1", &["c"], NodeKind::Schema)).unwrap();
        s.remove_for_connection("c1").unwrap();
        assert_eq!(labels(&s), ["b"]);
        s.remove_for_connection("nope").unwrap();
        assert_eq!(labels(&s), ["b"]);
    }

    #[test]
    fn file_uses_camel_case() {
        let (d, s) = store();
        s.add(bm("c1", &["app"], NodeKind::MaterializedView)).unwrap();
        let raw = std::fs::read_to_string(d.0.join("bookmarks.json")).unwrap();
        assert!(raw.contains("\"connectionId\"") && raw.contains("\"materializedView\""), "{raw}");
    }
}
