//! Claude workspace: runner. STUB — to be implemented (see the contract in mod.rs).
#![allow(unused_imports)]
use super::*;
use crate::error::{AppError, AppResult};
use serde_json::Value;

const TODO: &str = "Claude Code integration not implemented yet";
fn todo<T>() -> AppResult<T> { Err(AppError::Unsupported(TODO.into())) }

#[tauri::command] pub async fn claude_info() -> AppResult<ClaudeInfo> { todo() }
/// Start a session in `cwd`; returns a run id. Messages arrive as `claude-msg` events.
#[tauri::command] pub async fn claude_start(_app: tauri::AppHandle, _cwd: String, _opts: StartOptions) -> AppResult<String> { todo() }
/// Send a user message (text; optional image paths are attached as base64 image blocks).
#[tauri::command] pub async fn claude_send(_run_id: String, _text: String, _images: Option<Vec<String>>) -> AppResult<()> { todo() }
/// Answer a can_use_tool request. `decision` = {behavior:"allow", updatedInput?, updatedPermissions?} | {behavior:"deny", message}.
#[tauri::command] pub async fn claude_permission(_run_id: String, _request_id: String, _decision: Value) -> AppResult<()> { todo() }
/// Send a control request: subtype "interrupt" | "set_permission_mode" ({mode}) | "set_model" ({model}).
#[tauri::command] pub async fn claude_control(_run_id: String, _subtype: String, _payload: Option<Value>) -> AppResult<Value> { todo() }
#[tauri::command] pub async fn claude_stop(_run_id: String) -> AppResult<()> { todo() }
