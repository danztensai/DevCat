// Typed wrappers around Tauri commands. Infra features (k8s, rabbitmq) keep
// their own api files under src/features/<feature>/api.ts.
import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig, ExecOptions, Project, HistoryEntry, NodeKind, QueryResult, RowChange,
  SavedQuery, SchemaSnapshot, TableDataPage, TableDataRequest, TableRef, TableStructure, TreeNode,
} from "./types";

export const api = {
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

  // kubernetes contexts (used by the connection dialog; implemented in infra/k8s.rs)
  k8sContexts: (kubeconfigPath?: string | null) => invoke<string[]>("k8s_contexts", { kubeconfigPath }),
};

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
