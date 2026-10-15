// Typed wrappers around Tauri commands. Infra features (k8s, rabbitmq) keep
// their own api files under src/features/<feature>/api.ts.
import { invoke } from "@tauri-apps/api/core";
import type {
  GitRepo, GitLogQuery, GitCommit, GitCommitDetail, GitBlame, GitRefs, GitStash, CommitAction, RemoteOpts,
  ClaudeInfo, ClaudeProject, ClaudeStartOptions, FileEntry, FilePreview, FileVersions, GitStatus, SessionMeta,
  ConnectionConfig, ExecOptions, NetKind, NetProfile, NetProfileFull, NetStatus, NetTools, Project, SshConfigHost, TrafficSample, HistoryEntry, NodeKind, QueryResult, RowChange,
  SavedQuery, SchemaSnapshot, TableDataPage, TableDataRequest, TableRef, TableStructure, TreeNode,
} from "./types";

export const api = {
  // windows
  /** Open another app window, optionally focused on a project and/or opening a tab. Returns its label. */
  openWindow: (projectId?: string | null, tab?: Record<string, unknown> | null) =>
    invoke<string>("open_window", { projectId: projectId ?? null, tab: tab ?? null }),

  // connections
  listConnections: () => invoke<ConnectionConfig[]>("list_connections"),
  getConnection: (id: string) => invoke<ConnectionConfig>("get_connection", { id }),
  saveConnection: (config: ConnectionConfig) => invoke<ConnectionConfig>("save_connection", { config }),
  deleteConnection: (id: string) => invoke<void>("delete_connection", { id }),
  testConnection: (config: ConnectionConfig) => invoke<string>("test_connection", { config }),
  openConnection: (id: string) => invoke<string>("open_connection", { id }),
  closeConnection: (id: string) => invoke<void>("close_connection", { id }),
  openConnectionIds: () => invoke<string[]>("open_connection_ids"),

  // projects
  listProjects: () => invoke<Project[]>("list_projects"),
  saveProject: (project: Project) => invoke<Project>("save_project", { project }),
  deleteProject: (id: string, deleteConnections = false) => invoke<void>("delete_project", { id, deleteConnections }),
  moveConnections: (ids: string[], projectId: string | null) => invoke<void>("move_connections", { ids, projectId }),
  reorderProjects: (ids: string[]) => invoke<Project[]>("reorder_projects", { ids }),

  // database
  children: (connId: string, path: string[]) => invoke<TreeNode[]>("db_children", { connId, path }),
  listDatabases: (connId: string) => invoke<string[]>("db_list_databases", { connId }),
  execute: (connId: string, script: string, { skipHistory, ...opts }: ExecOptions = {}) =>
    invoke<QueryResult[]>("db_execute", { connId, script, opts, skipHistory: skipHistory ?? false }),
  cancel: (connId: string) => invoke<void>("db_cancel", { connId }),
  tableData: (connId: string, req: TableDataRequest) => invoke<TableDataPage>("db_table_data", { connId, req }),
  tableStructure: (connId: string, table: TableRef) => invoke<TableStructure>("db_table_structure", { connId, table }),
  applyChanges: (connId: string, table: TableRef, changes: RowChange[]) =>
    invoke<number>("db_apply_changes", { connId, table, changes }),
  objectDdl: (connId: string, table: TableRef, kind: NodeKind) => invoke<string>("db_object_ddl", { connId, table, kind }),
  schemaSnapshot: (connId: string, database?: string | null, schema?: string | null) =>
    invoke<SchemaSnapshot>("db_schema_snapshot", { connId, database, schema }),
  getKey: (connId: string, database: string | null, key: string) => invoke<unknown>("db_get_key", { connId, database, key }),
  setKey: (connId: string, database: string | null, value: unknown) => invoke<void>("db_set_key", { connId, database, value }),
  deleteKey: (connId: string, database: string | null, key: string) => invoke<void>("db_delete_key", { connId, database, key }),

  // history
  historyList: (connectionId?: string | null, search?: string | null, limit?: number) =>
    invoke<HistoryEntry[]>("history_list", { connectionId, search, limit }),
  historyClear: () => invoke<void>("history_clear"),
  savedQueries: () => invoke<SavedQuery[]>("saved_queries_list"),
  saveQuery: (query: SavedQuery) => invoke<SavedQuery>("saved_query_save", { query }),
  deleteSavedQuery: (id: string) => invoke<void>("saved_query_delete", { id }),

  // transfer
  exportData: (args: { connId: string; table?: TableRef | null; query?: string | null; database?: string | null; format: string; path: string; options?: Record<string, unknown> }) =>
    invoke<number>("export_data", { options: {}, table: null, query: null, database: null, ...args }),
  importPreview: (format: string, path: string, options: Record<string, unknown> = {}) =>
    invoke<{ columns: string[]; rows: unknown[][] }>("import_preview", { format, path, options }),
  importData: (connId: string, table: TableRef, format: string, path: string, options: Record<string, unknown> = {}) =>
    invoke<number>("import_data", { connId, table, format, path, options }),
  backupDatabase: (connId: string, database: string | null, schema: string | null, path: string, options: Record<string, unknown> = {}) =>
    invoke<string>("backup_database", { connId, database, schema, path, options }),
  restoreDatabase: (connId: string, database: string | null, path: string, options: Record<string, unknown> = {}) =>
    invoke<string>("restore_database", { connId, database, path, options }),
  transferTables: (sourceConn: string, targetConn: string, tables: TableRef[], targetDatabase: string | null, targetSchema: string | null, options: Record<string, unknown> = {}) =>
    invoke<number>("transfer_tables", { sourceConn, targetConn, tables, targetDatabase, targetSchema, options }),

  // network profiles (VPN / SSH tunnels). Events: "net-status" (NetStatus), "net-log" ({ id, lines })
  netList: () => invoke<NetProfile[]>("net_list"),
  netGet: (id: string) => invoke<NetProfileFull>("net_get", { id }),
  netSave: (profile: NetProfile, configText?: string | null) => invoke<NetProfile>("net_save", { profile, configText: configText ?? null }),
  netDelete: (id: string) => invoke<void>("net_delete", { id }),
  netImport: (path: string) => invoke<NetProfileFull>("net_import", { path }),
  netParse: (kind: NetKind, text: string) => invoke<Record<string, unknown>>("net_parse", { kind, text }),
  netConnect: (id: string) => invoke<void>("net_connect", { id }),
  netDisconnect: (id: string) => invoke<void>("net_disconnect", { id }),
  netStatus: () => invoke<NetStatus[]>("net_status"),
  netLogs: (id: string) => invoke<string[]>("net_logs", { id }),
  netTools: () => invoke<NetTools>("net_tools"),
  netSshConfigHosts: () => invoke<SshConfigHost[]>("net_ssh_config_hosts"),
  /** Last ≤5 minutes of traffic samples; live updates arrive as "net-traffic" events. */
  netTraffic: (id: string) => invoke<TrafficSample[]>("net_traffic", { id }),

  // Claude Code workspace. Events: "claude-msg" ({ runId, msg: ClaudeMsg }), "claude-exit" ({ runId, code, error? })
  claudeInfo: () => invoke<ClaudeInfo>("claude_info"),
  claudeStart: (cwd: string, opts: ClaudeStartOptions = {}) => invoke<string>("claude_start", { cwd, opts }),
  claudeSend: (runId: string, text: string, images?: string[] | null) => invoke<void>("claude_send", { runId, text, images: images ?? null }),
  claudePermission: (runId: string, requestId: string, decision: { behavior: "allow"; updatedInput?: unknown; updatedPermissions?: unknown } | { behavior: "deny"; message: string }) =>
    invoke<void>("claude_permission", { runId, requestId, decision }),
  claudeControl: (runId: string, subtype: "interrupt" | "set_permission_mode" | "set_model", payload?: Record<string, unknown>) =>
    invoke<unknown>("claude_control", { runId, subtype, payload: payload ?? null }),
  claudeStop: (runId: string) => invoke<void>("claude_stop", { runId }),
  claudeReview: (cwd: string, scope: "uncommitted" | "staged" | "branch", base?: string | null, model?: string | null) =>
    invoke<string>("claude_review", { cwd, scope, base: base ?? null, model: model ?? null }),
  claudeProjects: () => invoke<ClaudeProject[]>("claude_projects"),
  claudeSessions: (cwd: string) => invoke<SessionMeta[]>("claude_sessions", { cwd }),
  claudeTranscript: (cwd: string, sessionId: string) => invoke<unknown[]>("claude_transcript", { cwd, sessionId }),
  fsList: (dir: string, showIgnored = false) => invoke<FileEntry[]>("fs_list", { dir, showIgnored }),
  fsPreview: (path: string) => invoke<FilePreview>("fs_preview", { path }),
  /** Open a regular, non-executable file in its default app (scripts/executables are refused). */
  fsOpenExternal: (path: string) => invoke<void>("fs_open_external", { path }),
  gitStatus: (cwd: string) => invoke<GitStatus>("git_status", { cwd }),
  gitFileVersions: (cwd: string, path: string, staged: boolean) => invoke<FileVersions>("git_file_versions", { cwd, path, staged }),
  gitDiffText: (cwd: string, staged: boolean) => invoke<string>("git_diff_text", { cwd, staged }),
  gitStage: (cwd: string, paths: string[]) => invoke<void>("git_stage", { cwd, paths }),
  gitUnstage: (cwd: string, paths: string[]) => invoke<void>("git_unstage", { cwd, paths }),
  gitDiscard: (cwd: string, paths: string[]) => invoke<void>("git_discard", { cwd, paths }),
  gitCommit: (cwd: string, message: string) => invoke<string>("git_commit", { cwd, message }),

  // Git tools (src-tauri/src/gitx). `cwd` = any path inside the repo.
  /** Find repos at/under `root` (and the repo enclosing it). maxDepth default 6. */
  gitRepos: (root: string, maxDepth?: number) => invoke<GitRepo[]>("git_repos", { root, maxDepth: maxDepth ?? null }),
  gitLog: (cwd: string, query: GitLogQuery) => invoke<GitCommit[]>("git_log", { cwd, query }),
  gitShow: (cwd: string, sha: string) => invoke<GitCommitDetail>("git_show", { cwd, sha }),
  /** File before (first parent) / after `sha`. */
  gitCommitFileVersions: (cwd: string, sha: string, path: string, oldPath?: string | null) =>
    invoke<FileVersions>("git_commit_file_versions", { cwd, sha, path, oldPath: oldPath ?? null }),
  /** Unified diff text of one commit (vs first parent). */
  gitCommitDiff: (cwd: string, sha: string) => invoke<string>("git_commit_diff", { cwd, sha }),
  /** rev null = working tree. */
  gitBlame: (cwd: string, path: string, rev?: string | null) => invoke<GitBlame>("git_blame", { cwd, path, rev: rev ?? null }),
  gitRefs: (cwd: string) => invoke<GitRefs>("git_refs", { cwd }),
  /** Switch to a branch/commit; create = new branch `target` at startPoint (default HEAD). Remote branch names create a tracking branch. */
  gitCheckout: (cwd: string, target: string, create = false, startPoint?: string | null) =>
    invoke<void>("git_checkout", { cwd, target, create, startPoint: startPoint ?? null }),
  gitBranchDelete: (cwd: string, name: string, force = false, remote = false) => invoke<void>("git_branch_delete", { cwd, name, force, remote }),
  /** New branch at startPoint (default HEAD) without switching to it. */
  gitBranchCreate: (cwd: string, name: string, startPoint?: string | null) => invoke<void>("git_branch_create", { cwd, name, startPoint: startPoint ?? null }),
  gitBranchRename: (cwd: string, from: string, to: string) => invoke<void>("git_branch_rename", { cwd, from, to }),
  /** Merge `branch` into the current branch; returns git output. */
  gitMerge: (cwd: string, branch: string, noFf = false) => invoke<string>("git_merge", { cwd, branch, noFf }),
  /** Abort the merge/rebase/cherry-pick/revert in progress. */
  gitAbort: (cwd: string) => invoke<void>("git_abort", { cwd }),
  gitTagCreate: (cwd: string, name: string, sha?: string | null, message?: string | null) =>
    invoke<void>("git_tag_create", { cwd, name, sha: sha ?? null, message: message ?? null }),
  gitTagDelete: (cwd: string, name: string) => invoke<void>("git_tag_delete", { cwd, name }),
  gitCommitAction: (cwd: string, sha: string, action: CommitAction) => invoke<string>("git_commit_action", { cwd, sha, action }),
  gitStashList: (cwd: string) => invoke<GitStash[]>("git_stash_list", { cwd }),
  gitStashSave: (cwd: string, message: string | null, includeUntracked: boolean) =>
    invoke<void>("git_stash_save", { cwd, message, includeUntracked }),
  /** pop = apply + drop. */
  gitStashApply: (cwd: string, index: number, pop: boolean) => invoke<string>("git_stash_apply", { cwd, index, pop }),
  gitStashDrop: (cwd: string, index: number) => invoke<void>("git_stash_drop", { cwd, index }),
  /** Network ops (non-interactive: SSH agent / credential helper only); return git output. */
  gitFetch: (cwd: string, opts: RemoteOpts = {}) => invoke<string>("git_fetch", { cwd, opts }),
  gitPull: (cwd: string, opts: RemoteOpts = {}) => invoke<string>("git_pull", { cwd, opts }),
  gitPush: (cwd: string, opts: RemoteOpts = {}) => invoke<string>("git_push", { cwd, opts }),

  // Terminal (PTY). Events: "pty-output" ({ id, data: base64 }), "pty-exit" ({ id, code })
  /** program: "claude" = the resolved Claude Code binary, null = the user's login shell, else a path/name. */
  ptyOpen: (cwd: string, program: string | null, args: string[], cols: number, rows: number) =>
    invoke<string>("pty_open", { cwd, program, args, cols, rows }),
  ptyWrite: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  ptyClose: (id: string) => invoke<void>("pty_close", { id }),

  // kubernetes contexts (used by the connection dialog; implemented in infra/k8s.rs)
  k8sContexts: (kubeconfigPath?: string | null) => invoke<string[]>("k8s_contexts", { kubeconfigPath }),
};

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
