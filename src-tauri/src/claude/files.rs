//! Claude workspace: files. STUB — to be implemented (see the contract in mod.rs).
#![allow(unused_imports)]
use super::*;
use crate::error::{AppError, AppResult};
use serde_json::Value;

const TODO: &str = "Claude Code integration not implemented yet";
fn todo<T>() -> AppResult<T> { Err(AppError::Unsupported(TODO.into())) }

#[tauri::command] pub async fn fs_list(_dir: String, _show_ignored: Option<bool>) -> AppResult<Vec<FileEntry>> { todo() }
#[tauri::command] pub async fn fs_preview(_path: String) -> AppResult<FilePreview> { todo() }
