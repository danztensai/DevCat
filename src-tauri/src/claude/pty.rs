//! Claude workspace: terminal. Pseudo-terminals running interactive `claude` (or the
//! user's shell / any program) for the xterm.js view.
//!
//! Events to the frontend:
//!   `pty-output` → { id, data }   (raw bytes, base64; batched ~12ms / 16KB)
//!   `pty-exit`   → { id, code }
use super::locate;
use super::runner::{Sink, app_sink};
use crate::error::{AppError, AppResult};
use base64::Engine;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

const BATCH_WINDOW: Duration = Duration::from_millis(12);
const BATCH_BYTES: usize = 16 * 1024;

struct Pty {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

static PTYS: Lazy<Mutex<HashMap<String, Arc<Pty>>>> = Lazy::new(Default::default);

fn get(id: &str) -> AppResult<Arc<Pty>> {
    PTYS.lock().get(id).cloned().ok_or_else(|| AppError::msg(format!("Terminal {id} is closed")))
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

/// The user's interactive shell.
fn default_shell() -> CommandBuilder {
    if cfg!(windows) {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let found = ["pwsh.exe", "powershell.exe"]
            .into_iter()
            .find_map(|p| std::env::split_paths(&path).map(|d| d.join(p)).find(|f| f.is_file()));
        match found {
            Some(p) => CommandBuilder::new(p),
            None => CommandBuilder::new("cmd.exe"),
        }
    } else {
        let shell = std::env::var("SHELL").ok().filter(|s| Path::new(s).is_file()).unwrap_or_else(|| "/bin/zsh".into());
        let mut c = CommandBuilder::new(shell);
        c.arg("-l");
        c
    }
}

async fn build_command(cwd: &str, program: Option<String>, args: Vec<String>) -> AppResult<CommandBuilder> {
    let mut cmd = match program.as_deref().filter(|p| !p.is_empty()) {
        None => default_shell(),
        Some("claude") => CommandBuilder::new(
            locate::claude_path().ok_or_else(|| AppError::msg("claude CLI not found (install Claude Code or set CLAUDE_PATH)"))?,
        ),
        Some(p) => CommandBuilder::new(p),
    };
    cmd.args(args);
    cmd.cwd(cwd);
    cmd.env("PATH", locate::child_path().await);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if std::env::var_os("LANG").is_none_or(|v| v.is_empty()) {
        cmd.env("LANG", "en_US.UTF-8");
    }
    // Don't let claude think it's nested in another Claude Code / misdetect the host terminal.
    for k in ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"] {
        cmd.env_remove(k);
    }
    Ok(cmd)
}

pub(super) async fn open(sink: Sink, cwd: &str, program: Option<String>, args: Vec<String>, cols: u16, rows: u16) -> AppResult<String> {
    if !Path::new(cwd).is_dir() {
        return Err(AppError::msg(format!("Not a directory: {cwd}")));
    }
    let cmd = build_command(cwd, program, args).await?;
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| AppError::msg(format!("openpty: {e}")))?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| AppError::msg(format!("Failed to start terminal program: {e}")))?;
    drop(pair.slave); // so the reader sees EOF once the child exits
    let mut reader = pair.master.try_clone_reader().map_err(|e| AppError::msg(e.to_string()))?;
    let writer = pair.master.take_writer().map_err(|e| AppError::msg(e.to_string()))?;
    let id = uuid::Uuid::new_v4().to_string();
    let pty = Arc::new(Pty {
        master: Mutex::new(pair.master),
        writer: Mutex::new(Some(writer)),
        killer: Mutex::new(child.clone_killer()),
    });
    PTYS.lock().insert(id.clone(), pty);

    // reader → batcher → pty-output
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let (s, pid) = (sink.clone(), id.clone());
    let batcher = std::thread::spawn(move || {
        let emit = |data: &[u8]| {
            s("pty-output", json!({ "id": pid, "data": base64::engine::general_purpose::STANDARD.encode(data) }));
        };
        while let Ok(first) = rx.recv() {
            let mut batch = first;
            let deadline = Instant::now() + BATCH_WINDOW;
            while batch.len() < BATCH_BYTES {
                match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                    Ok(more) => batch.extend_from_slice(&more),
                    Err(_) => break,
                }
            }
            emit(&batch);
        }
    });

    // exit watcher
    let pid = id.clone();
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code()).ok();
        // Flush remaining output first (bounded: background jobs may keep the tty open).
        let deadline = Instant::now() + Duration::from_millis(500);
        while !batcher.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        PTYS.lock().remove(&pid);
        sink("pty-exit", json!({ "id": pid, "code": code }));
    });
    Ok(id)
}

/// Open a terminal in `cwd`. `program`: "claude" (resolved binary), None (login shell) or any program.
#[tauri::command]
pub async fn pty_open(app: tauri::AppHandle, cwd: String, program: Option<String>, args: Vec<String>, cols: u16, rows: u16) -> AppResult<String> {
    open(app_sink(app), &cwd, program, args, cols, rows).await
}

/// Raw keystrokes (UTF-8).
#[tauri::command]
pub async fn pty_write(id: String, data: String) -> AppResult<()> {
    let pty = get(&id)?;
    let mut w = pty.writer.lock();
    let w = w.as_mut().ok_or_else(|| AppError::msg("Terminal input is closed"))?;
    w.write_all(data.as_bytes())?;
    w.flush()?;
    Ok(())
}

#[tauri::command]
pub async fn pty_resize(id: String, cols: u16, rows: u16) -> AppResult<()> {
    get(&id)?.master.lock().resize(size(cols, rows)).map_err(|e| AppError::msg(format!("resize: {e}")))
}

fn kill(pty: &Pty) {
    // Kill before dropping the writer: dropping it sends EOF, which lets the program exit cleanly first.
    let _ = pty.killer.lock().kill();
    pty.writer.lock().take();
}

/// Kill the program and drop the terminal (`pty-exit` still follows).
#[tauri::command]
pub async fn pty_close(id: String) -> AppResult<()> {
    if let Some(p) = PTYS.lock().remove(&id) {
        kill(&p);
    }
    Ok(())
}

/// Kill every terminal (app exit).
pub fn shutdown_all() {
    let all: Vec<Arc<Pty>> = PTYS.lock().drain().map(|(_, p)| p).collect();
    for p in all {
        kill(&p);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::claude::runner::tests::channel_sink;

    async fn collect_until_exit(rx: &mut tokio::sync::mpsc::UnboundedReceiver<(&'static str, serde_json::Value)>) -> (String, serde_json::Value) {
        let mut out = Vec::new();
        loop {
            let (e, v) = tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.expect("timeout").expect("closed");
            match e {
                "pty-output" => out.extend(base64::engine::general_purpose::STANDARD.decode(v["data"].as_str().unwrap()).unwrap()),
                "pty-exit" => return (String::from_utf8_lossy(&out).into_owned(), v["code"].clone()),
                _ => {}
            }
        }
    }

    #[tokio::test]
    async fn runs_program_and_reports_exit() {
        let (sink, mut rx) = channel_sink();
        let id = open(sink, "/tmp", Some("sh".into()), vec!["-c".into(), "printf hi-$TERM; exit 3".into()], 80, 24).await.unwrap();
        pty_resize(id.clone(), 100, 30).await.unwrap();
        let (out, code) = collect_until_exit(&mut rx).await;
        assert!(out.contains("hi-xterm-256color"), "{out:?}");
        assert_eq!(code, 3);
        assert!(pty_write(id, "x".into()).await.is_err(), "closed after exit");
    }

    #[tokio::test]
    async fn interactive_input_and_close() {
        let (sink, mut rx) = channel_sink();
        let id = open(sink, "/tmp", Some("cat".into()), vec![], 80, 24).await.unwrap();
        pty_write(id.clone(), "ping\r".into()).await.unwrap();
        let mut seen = String::new();
        while !seen.contains("ping") {
            let (e, v) = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
            if e == "pty-output" {
                seen.push_str(&String::from_utf8_lossy(&base64::engine::general_purpose::STANDARD.decode(v["data"].as_str().unwrap()).unwrap()));
            }
        }
        pty_close(id.clone()).await.unwrap();
        let (_, code) = collect_until_exit(&mut rx).await;
        assert_ne!(code, 0);
        assert!(pty_resize(id, 10, 10).await.is_err());
    }

    /// Resolves the real claude binary (free: --version only).
    #[tokio::test]
    #[ignore]
    async fn real_claude_version() {
        let (sink, mut rx) = channel_sink();
        open(sink, "/tmp", Some("claude".into()), vec!["--version".into()], 80, 24).await.unwrap();
        let (out, code) = collect_until_exit(&mut rx).await;
        println!("{out:?} {code}");
        assert!(out.contains("Claude Code") && code == 0);
    }

    #[tokio::test]
    async fn rejects_bad_cwd() {
        let (sink, _rx) = channel_sink();
        assert!(open(sink, "/definitely/not/here", None, vec![], 80, 24).await.is_err());
    }
}
