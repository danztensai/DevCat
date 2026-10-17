//! Moving whole files between the computer and a phone, in chunks (a frame carries one chunk,
//! base64): `fs_download` reads a piece of a file, `fs_upload` writes one into a hidden
//! `.<name>.devcat-upload` next to the target and renames it into place after the last piece,
//! so a half-sent file never shows up under its real name.
use base64::Engine;
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// Largest piece a phone may ask for or send at once (before base64).
pub const CHUNK_MAX: usize = 4 * 1024 * 1024;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// `len` bytes of `path` from `offset`: `{ data, size, eof }`.
pub async fn read_chunk(path: String, offset: u64, len: usize) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
        let meta = f.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            return Err("That's a folder, not a file".into());
        }
        let size = meta.len();
        f.seek(SeekFrom::Start(offset.min(size))).map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity(len.min(CHUNK_MAX));
        f.take(len.clamp(1, CHUNK_MAX) as u64).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        let end = offset + buf.len() as u64;
        Ok(json!({ "data": B64.encode(&buf), "size": size, "eof": end >= size }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The file an upload of `name` into `dir` ends up as. `name` must be a plain file name.
pub fn upload_target(dir: &str, name: &str) -> Result<PathBuf, String> {
    let bad = name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) || name.len() > 255;
    if bad {
        return Err(format!("Not a valid file name: {name}"));
    }
    let dir = Path::new(dir);
    if !dir.is_dir() {
        return Err("That folder doesn't exist any more".into());
    }
    Ok(dir.join(name))
}

fn part_of(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.devcat-upload"))
}

/// One piece of an upload. The first piece (`offset` 0) fails with `EXISTS:` if the file is
/// already there and `overwrite` isn't set; `done` on the last piece moves the file into place.
pub async fn write_chunk(target: PathBuf, offset: u64, data: String, done: bool, overwrite: bool) -> Result<Value, String> {
    let bytes = B64.decode(data.as_bytes()).map_err(|_| "The upload got garbled; try again".to_string())?;
    if bytes.len() > CHUNK_MAX {
        return Err("Piece too large".into());
    }
    tokio::task::spawn_blocking(move || {
        let part = part_of(&target);
        if offset == 0 {
            if target.is_dir() {
                return Err(format!("There's a folder called {} here", target.file_name().unwrap_or_default().to_string_lossy()));
            }
            if target.exists() && !overwrite {
                return Err(format!("EXISTS: {} is already here", target.file_name().unwrap_or_default().to_string_lossy()));
            }
        }
        let mut f = if offset == 0 {
            fs::File::create(&part)
        } else {
            fs::OpenOptions::new().append(true).open(&part)
        }
        .map_err(|e| e.to_string())?;
        // Pieces must arrive in order; anything else means a lost or repeated piece.
        if f.metadata().map_err(|e| e.to_string())?.len() != offset {
            drop(f);
            let _ = fs::remove_file(&part);
            return Err("The upload was interrupted; start it again".into());
        }
        f.write_all(&bytes).map_err(|e| e.to_string())?;
        let written = offset + bytes.len() as u64;
        if done {
            f.sync_all().map_err(|e| e.to_string())?;
            drop(f);
            if cfg!(windows) && target.exists() {
                fs::remove_file(&target).map_err(|e| e.to_string())?;
            }
            fs::rename(&part, &target).map_err(|e| e.to_string())?;
        }
        Ok(json!({ "size": written }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Drop what a stopped upload left behind.
pub fn cancel(target: &Path) {
    let _ = fs::remove_file(part_of(target));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upload_then_download() {
        let dir = std::env::temp_dir().join(format!("devcat-transfer-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().into_owned();
        assert!(upload_target(&d, "../x").is_err());
        assert!(upload_target(&d, "a/b").is_err());
        let t = upload_target(&d, "hello.bin").unwrap();

        write_chunk(t.clone(), 0, B64.encode(b"hello "), false, false).await.unwrap();
        assert!(!t.exists(), "not under its real name until the last piece");
        // out of order: refused, and the piece file is gone
        assert!(write_chunk(t.clone(), 3, B64.encode(b"x"), false, false).await.is_err());
        write_chunk(t.clone(), 0, B64.encode(b"hello "), false, false).await.unwrap();
        write_chunk(t.clone(), 6, B64.encode(b"world"), true, false).await.unwrap();
        assert_eq!(fs::read(&t).unwrap(), b"hello world");
        assert!(!part_of(&t).exists());

        let e = write_chunk(t.clone(), 0, B64.encode(b"new"), true, false).await.unwrap_err();
        assert!(e.starts_with("EXISTS:"));
        write_chunk(t.clone(), 0, B64.encode(b"new"), true, true).await.unwrap();
        assert_eq!(fs::read(&t).unwrap(), b"new");

        let p = t.to_string_lossy().into_owned();
        let a = read_chunk(p.clone(), 0, 2).await.unwrap();
        assert_eq!((a["data"].as_str().unwrap(), a["size"].as_u64(), a["eof"].as_bool()), ("bmU=", Some(3), Some(false)));
        let b = read_chunk(p, 2, 2).await.unwrap();
        assert_eq!((b["data"].as_str().unwrap(), b["eof"].as_bool()), ("dw==", Some(true)));
        fs::remove_dir_all(&dir).unwrap();
    }
}
