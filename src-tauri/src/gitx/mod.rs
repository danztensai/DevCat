//! Git tools: nested repository discovery, history/graph, commit details, blame,
//! branches, tags, stashes and remote operations. Built on the `git` CLI helpers in
//! `claude::git` (same binary lookup, env and path validation).
//!
//! CONTRACT: the types below are mirrored in `src/lib/types.ts`; commands in `commands.rs`
//! are mirrored in `src/lib/api.ts`. Keep them in sync.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod commands;
mod parse;
mod scan;

/// A git repository found under a scanned folder.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepo {
    /// Absolute path of the work tree.
    pub path: String,
    /// Folder name.
    pub name: String,
    /// Path relative to the scanned root ("." for the root itself, "../.." when the root is inside it).
    pub rel: String,
    /// Absolute path of the closest enclosing repo in the result list (nesting), None for top level.
    pub parent: Option<String>,
    /// `.git` is a file: submodule or linked worktree.
    pub is_submodule: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Changed + untracked file count.
    pub changes: u32,
    pub head_sha: Option<String>,
    /// Status failed (corrupt repo, permission…).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitLogQuery {
    /// Revision / range (default HEAD). Ignored when `all`.
    pub rev: Option<String>,
    /// All refs (branches, remotes, tags) — for the graph.
    #[serde(default)]
    pub all: bool,
    /// Only commits touching this path (absolute or repo-relative); follows renames for files.
    pub path: Option<String>,
    /// Message search (--grep, case-insensitive) — or a sha prefix.
    pub search: Option<String>,
    pub author: Option<String>,
    #[serde(default)]
    pub skip: u32,
    /// Default 200, max 2000.
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub sha: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// Author time, unix seconds.
    pub time: i64,
    pub subject: String,
    /// Decorations: "HEAD -> main", "origin/main", "tag: v1.0" split into items.
    pub refs: Vec<GitRefLabel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRefLabel {
    pub name: String,
    /// "head" (the checked-out branch), "branch", "remote", "tag", "detached" (bare HEAD), "stash".
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    pub path: String,
    pub old_path: Option<String>,
    /// A M D R C T
    pub status: String,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub commit: GitCommit,
    /// Full message without the subject line.
    pub body: String,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    /// Files changed vs the first parent (root commit: vs empty tree).
    pub files: Vec<GitCommitFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub sha: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    /// The line came from this path (renames).
    pub filename: String,
    /// "0000…" = not committed yet.
    pub uncommitted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    /// 1-based line in the final file.
    pub line: u32,
    pub sha: String,
    /// 1-based line in the originating commit.
    pub orig_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlame {
    /// File content at `rev` (or the working tree), so line numbers match.
    pub content: String,
    pub lines: Vec<BlameLine>,
    pub commits: HashMap<String, BlameCommit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    /// "main" or "origin/main".
    pub name: String,
    /// Full ref, e.g. refs/heads/main.
    pub full_ref: String,
    pub sha: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub subject: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitTag {
    pub name: String,
    /// Commit the tag points at.
    pub sha: String,
    pub annotated: bool,
    pub subject: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefs {
    /// Checked-out branch, None when detached.
    pub current: Option<String>,
    pub head_sha: Option<String>,
    pub local: Vec<GitBranch>,
    pub remote: Vec<GitBranch>,
    pub tags: Vec<GitTag>,
    pub remotes: Vec<GitRemote>,
    /// Merge / rebase / cherry-pick / revert in progress.
    pub operation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStash {
    pub index: u32,
    /// "stash@{0}"
    pub name: String,
    pub sha: String,
    pub message: String,
    pub time: i64,
}

/// Commit-level action from the history view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum CommitAction {
    Checkout,
    CherryPick,
    Revert,
    ResetSoft,
    ResetMixed,
    ResetHard,
}

/// Remote operation; output is git's combined stdout/stderr.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteOpts {
    /// fetch: remote name or all remotes when None.
    pub remote: Option<String>,
    /// pull: rebase instead of merge.
    #[serde(default)]
    pub rebase: bool,
    /// push: --set-upstream <remote> <branch> when the branch has no upstream.
    #[serde(default)]
    pub set_upstream: bool,
    /// push: --force-with-lease.
    #[serde(default)]
    pub force: bool,
    /// push: also push tags.
    #[serde(default)]
    pub tags: bool,
}
