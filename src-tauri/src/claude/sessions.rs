//! Claude workspace: sessions. STUB — to be implemented (see the contract in mod.rs).
#![allow(unused_imports)]
use super::*;
use crate::error::{AppError, AppResult};
use serde_json::Value;

const TODO: &str = "Claude Code integration not implemented yet";
fn todo<T>() -> AppResult<T> { Err(AppError::Unsupported(TODO.into())) }

#[tauri::command] pub async fn claude_projects() -> AppResult<Vec<ClaudeProject>> { todo() }
#[tauri::command] pub async fn claude_sessions(_cwd: String) -> AppResult<Vec<SessionMeta>> { todo() }
/// Transcript lines of a session (only user/assistant/system/result-like entries, raw JSON).
#[tauri::command] pub async fn claude_transcript(_cwd: String, _session_id: String) -> AppResult<Vec<Value>> { todo() }
