//! Notes: free-form Markdown notes, each optionally tied to a project (`None` = General).
//! Stored as `notes.json` next to `projects.json`.
use crate::error::{AppError, AppResult};
use crate::projects::ProjectStore;
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    /// Empty when creating.
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub pinned: bool,
    /// Unix milliseconds (set by the store).
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

pub struct NoteStore {
    path: PathBuf,
    lock: Mutex<()>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

impl NoteStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { path: data_dir.join("notes.json"), lock: Mutex::new(()) }
    }

    fn read(&self) -> AppResult<Vec<Note>> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        Ok(serde_json::from_str(&std::fs::read_to_string(&self.path)?)?)
    }

    fn write(&self, list: &[Note]) -> AppResult<()> {
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(list)?)?;
        std::fs::rename(tmp, &self.path)?;
        Ok(())
    }

    /// Pinned first, then most recently edited.
    pub fn list(&self) -> AppResult<Vec<Note>> {
        let _g = self.lock.lock();
        let mut all = self.read()?;
        all.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated_at.cmp(&a.updated_at)));
        Ok(all)
    }

    /// Create (empty id) or update a note's body, project and pin.
    pub fn save(&self, mut n: Note) -> AppResult<Note> {
        let _g = self.lock.lock();
        let mut all = self.read()?;
        let now = now_ms();
        match all.iter_mut().find(|x| !n.id.is_empty() && x.id == n.id) {
            Some(existing) => {
                // Pin / move alone don't count as an edit (keeps the list order stable).
                if existing.body != n.body {
                    existing.updated_at = now;
                }
                existing.body = n.body;
                existing.project_id = n.project_id;
                existing.pinned = n.pinned;
                n = existing.clone();
            }
            None if !n.id.is_empty() => return Err(AppError::msg("Note not found (it may have been deleted)")),
            None => {
                n.id = uuid::Uuid::new_v4().to_string();
                n.created_at = now;
                n.updated_at = now;
                all.push(n.clone());
            }
        }
        self.write(&all)?;
        Ok(n)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let _g = self.lock.lock();
        let mut all = self.read()?;
        all.retain(|n| n.id != id);
        self.write(&all)
    }

    /// A deleted project's notes move to General instead of being lost.
    pub fn unassign_project(&self, project_id: &str) -> AppResult<()> {
        let _g = self.lock.lock();
        let mut all = self.read()?;
        let mut changed = false;
        for n in all.iter_mut().filter(|n| n.project_id.as_deref() == Some(project_id)) {
            n.project_id = None;
            changed = true;
        }
        if changed { self.write(&all) } else { Ok(()) }
    }
}

#[tauri::command]
pub async fn notes_list(state: State<'_, AppState>) -> AppResult<Vec<Note>> {
    state.notes.list()
}

#[tauri::command]
pub async fn note_save(state: State<'_, AppState>, note: Note) -> AppResult<Note> {
    save_checked(&state.notes, &state.projects, note)
}

/// Save, refusing a project that doesn't exist.
pub(crate) fn save_checked(notes: &NoteStore, projects: &ProjectStore, note: Note) -> AppResult<Note> {
    if let Some(pid) = &note.project_id {
        if !projects.exists(pid)? {
            return Err(AppError::msg("Project not found"));
        }
    }
    notes.save(note)
}

#[tauri::command]
pub async fn note_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.notes.delete(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Removes its folder when dropped.
    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    fn store() -> (Dir, NoteStore) {
        let d = std::env::temp_dir().join(format!("devcat-notes-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        let s = NoteStore::new(d.clone());
        (Dir(d), s)
    }

    fn note(body: &str, project: Option<&str>) -> Note {
        Note { id: String::new(), project_id: project.map(Into::into), body: body.into(), pinned: false, created_at: 0, updated_at: 0 }
    }

    #[test]
    fn create_update_delete() {
        let (_d, s) = store();
        assert!(s.list().unwrap().is_empty());
        let a = s.save(note("# A", Some("p1"))).unwrap();
        assert!(!a.id.is_empty() && a.created_at > 0 && a.updated_at == a.created_at);
        let b = s.save(Note { body: "# A edited".into(), ..a.clone() }).unwrap();
        assert_eq!((b.id.as_str(), b.body.as_str(), b.created_at), (a.id.as_str(), "# A edited", a.created_at));
        assert_eq!(s.list().unwrap().len(), 1);
        s.delete(&a.id).unwrap();
        assert!(s.list().unwrap().is_empty());
        assert!(s.save(Note { id: "gone".into(), ..note("x", None) }).is_err());
    }

    #[test]
    fn pinned_first_and_pin_keeps_timestamp() {
        let (_d, s) = store();
        let old = s.save(note("old", None)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let new = s.save(note("new", None)).unwrap();
        assert_eq!(s.list().unwrap()[0].id, new.id);
        let pinned = s.save(Note { pinned: true, ..old.clone() }).unwrap();
        assert_eq!(pinned.updated_at, old.updated_at);
        assert_eq!(s.list().unwrap()[0].id, old.id);
    }

    #[test]
    fn deleting_project_moves_notes_to_general() {
        let (_d, s) = store();
        let a = s.save(note("a", Some("p1"))).unwrap();
        let b = s.save(note("b", Some("p2"))).unwrap();
        s.unassign_project("p1").unwrap();
        let all = s.list().unwrap();
        assert_eq!(all.iter().find(|n| n.id == a.id).unwrap().project_id, None);
        assert_eq!(all.iter().find(|n| n.id == b.id).unwrap().project_id.as_deref(), Some("p2"));
    }
}
