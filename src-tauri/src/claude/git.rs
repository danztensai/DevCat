//! Claude workspace: git. STUB — to be implemented (see the contract in mod.rs).
#![allow(unused_imports)]
use super::*;
use crate::error::{AppError, AppResult};
use serde_json::Value;

const TODO: &str = "Claude Code integration not implemented yet";
fn todo<T>() -> AppResult<T> { Err(AppError::Unsupported(TODO.into())) }

#[tauri::command] pub async fn git_status(_cwd: String) -> AppResult<GitStatus> { todo() }
/// original = HEAD (or index when `staged` is false and the file is staged), modified = index (staged) or worktree.
#[tauri::command] pub async fn git_file_versions(_cwd: String, _path: String, _staged: bool) -> AppResult<FileVersions> { todo() }
#[tauri::command] pub async fn git_diff_text(_cwd: String, _staged: bool) -> AppResult<String> { todo() }
#[tauri::command] pub async fn git_stage(_cwd: String, _paths: Vec<String>) -> AppResult<()> { todo() }
#[tauri::command] pub async fn git_unstage(_cwd: String, _paths: Vec<String>) -> AppResult<()> { todo() }
/// Discard worktree changes (and delete untracked files) for `paths`.
#[tauri::command] pub async fn git_discard(_cwd: String, _paths: Vec<String>) -> AppResult<()> { todo() }
#[tauri::command] pub async fn git_commit(_cwd: String, _message: String) -> AppResult<String> { todo() }
