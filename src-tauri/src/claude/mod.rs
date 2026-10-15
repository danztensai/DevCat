//! Claude Code integration: drives the native `claude` CLI binary (no npm / Node SDK)
//! in bidirectional stream-json mode, plus the workspace helpers the Claude view needs
//! (session list from ~/.claude/projects, file tree + previews, git status/diff).
//!
//! CONTRACT — implementation in progress. Protocol (verified against claude 2.1.280):
//!   spawn: claude -p --input-format stream-json --output-format stream-json --verbose
//!          --include-partial-messages --permission-prompt-tool stdio
//!          [--model M] [--permission-mode M] [--resume ID [--fork-session]]
//!   stdin  → {"type":"control_request","request_id":ID,"request":{"subtype":"initialize"}}   (first)
//!   stdin  → {"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}
//!   stdout ← system(init|hook_*), assistant, user(tool_result), stream_event, result,
//!            control_response (to our requests),
//!            control_request {"subtype":"can_use_tool","tool_name","display_name","input",
//!                             "description","permission_suggestions","tool_use_id"}
//!   stdin  → {"type":"control_response","response":{"subtype":"success","request_id":ID,
//!            "response":{"behavior":"allow","updatedInput":{…}} | {"behavior":"deny","message":"…"}}}
//!   other control requests we send: interrupt, set_permission_mode {mode}, set_model {model}
//!
//! Events to the frontend:
//!   `claude-msg`  → { runId, msg }   (every stdout JSON object, unmodified)
//!   `claude-exit` → { runId, code, error? }
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeInfo {
    /// Absolute path of the claude binary, None if not found.
    pub path: Option<String>,
    pub version: Option<String>,
    /// From the initialize handshake (account email/org, models list, …) when available.
    pub account: Option<Value>,
    pub models: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    pub model: Option<String>,
    /// manual | acceptEdits | auto | plan | dontAsk | bypassPermissions
    pub permission_mode: Option<String>,
    /// Resume this session id.
    pub resume: Option<String>,
    /// With `resume`: continue as a new session id.
    #[serde(default)]
    pub fork: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProject {
    pub cwd: String,
    pub session_count: usize,
    /// RFC3339 of the newest session file.
    pub last_active: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    /// ai-title if present, else first user prompt (trimmed).
    pub title: String,
    pub first_prompt: Option<String>,
    pub last_prompt: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub message_count: usize,
    pub git_branch: Option<String>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
    /// git porcelain status letter(s) for files under a repo, e.g. "M", "A", "??".
    pub git: Option<String>,
    /// Ignored by .gitignore (only listed when show_ignored = true).
    #[serde(default)]
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetData {
    pub name: String,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    /// text | markdown | image | pdf | sheet | csv | docx | binary | too_large
    pub kind: String,
    pub path: String,
    pub mime: Option<String>,
    pub size: u64,
    /// text / markdown / csv / docx (extracted text)
    pub text: Option<String>,
    /// Monaco language id for text.
    pub language: Option<String>,
    /// image / pdf bytes, base64.
    pub data_base64: Option<String>,
    pub sheets: Option<Vec<SheetData>>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub old_path: Option<String>,
    /// Index (staged) status letter: M A D R C U or ' '
    pub index: String,
    /// Worktree status letter: M D ? or ' '
    pub worktree: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersions {
    pub original: String,
    pub modified: String,
    pub binary: bool,
}

const TODO: &str = "Claude Code integration not implemented yet";
fn todo<T>() -> AppResult<T> { Err(AppError::Unsupported(TODO.into())) }

// ---- Claude process
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
/// Start a one-shot code review run (read-only tools) of `scope`: "uncommitted" | "staged" | "branch" (vs `base`).
/// Streams like a chat run; the final `result` carries the review (structured findings when supported).
#[tauri::command] pub async fn claude_review(_app: tauri::AppHandle, _cwd: String, _scope: String, _base: Option<String>, _model: Option<String>) -> AppResult<String> { todo() }

// ---- Sessions (~/.claude/projects)
#[tauri::command] pub async fn claude_projects() -> AppResult<Vec<ClaudeProject>> { todo() }
#[tauri::command] pub async fn claude_sessions(_cwd: String) -> AppResult<Vec<SessionMeta>> { todo() }
/// Transcript lines of a session (only user/assistant/system/result-like entries, raw JSON).
#[tauri::command] pub async fn claude_transcript(_cwd: String, _session_id: String) -> AppResult<Vec<Value>> { todo() }

// ---- Files
#[tauri::command] pub async fn fs_list(_dir: String, _show_ignored: Option<bool>) -> AppResult<Vec<FileEntry>> { todo() }
#[tauri::command] pub async fn fs_preview(_path: String) -> AppResult<FilePreview> { todo() }

// ---- Git
#[tauri::command] pub async fn git_status(_cwd: String) -> AppResult<GitStatus> { todo() }
/// original = HEAD (or index when `staged` is false and the file is staged), modified = index (staged) or worktree.
#[tauri::command] pub async fn git_file_versions(_cwd: String, _path: String, _staged: bool) -> AppResult<FileVersions> { todo() }
#[tauri::command] pub async fn git_diff_text(_cwd: String, _staged: bool) -> AppResult<String> { todo() }
#[tauri::command] pub async fn git_stage(_cwd: String, _paths: Vec<String>) -> AppResult<()> { todo() }
#[tauri::command] pub async fn git_unstage(_cwd: String, _paths: Vec<String>) -> AppResult<()> { todo() }
/// Discard worktree changes (and delete untracked files) for `paths`.
#[tauri::command] pub async fn git_discard(_cwd: String, _paths: Vec<String>) -> AppResult<()> { todo() }
#[tauri::command] pub async fn git_commit(_cwd: String, _message: String) -> AppResult<String> { todo() }
