//! Claude workspace: review. STUB — to be implemented (see the contract in mod.rs).
#![allow(unused_imports)]
use super::*;
use crate::error::{AppError, AppResult};
use serde_json::Value;

const TODO: &str = "Claude Code integration not implemented yet";
fn todo<T>() -> AppResult<T> { Err(AppError::Unsupported(TODO.into())) }

/// Start a one-shot code review run (read-only tools) of `scope`: "uncommitted" | "staged" | "branch" (vs `base`).
/// Streams like a chat run; the final `result` carries the review (structured findings when supported).
#[tauri::command] pub async fn claude_review(_app: tauri::AppHandle, _cwd: String, _scope: String, _base: Option<String>, _model: Option<String>) -> AppResult<String> { todo() }
