// Mirrors src-tauri/src/models.rs and src-tauri/src/db/mod.rs. Keep in sync.

export type ConnectionKind =
  | "postgres" | "mysql" | "sqlite" | "mssql" | "mongodb" | "redis"
  | "kubernetes" | "rabbitmq";

export const DATABASE_KINDS: ConnectionKind[] = ["postgres", "mysql", "sqlite", "mssql", "mongodb", "redis"];
export const INFRA_KINDS: ConnectionKind[] = ["kubernetes", "rabbitmq"];

export interface SshConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  auth: "password" | "key";
  keyPath?: string | null;
  password?: string | null;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  kind: ConnectionKind;
  host: string;
  port?: number | null;
  user: string;
  password?: string | null;
  /** Default db. Redis: db index. RabbitMQ: vhost. */
  database?: string | null;
  /** SQLite file, or kubeconfig path for Kubernetes. */
  filePath?: string | null;
  /** Full URI override (e.g. mongodb+srv://...). */
  url?: string | null;
  sslMode?: string | null;
  ssh?: SshConfig | null;
  color?: string | null;
  /** Legacy free-text group; migrated to projects by the backend. Don't use. */
  group?: string | null;
  /** Project (sidebar folder) this connection belongs to. */
  projectId?: string | null;
  /** Kubernetes: { context }. RabbitMQ: { managementPort, useTls }. */
  options: Record<string, string>;
  readOnly: boolean;
}

/** User-created folder that groups connections in the sidebar. */
export interface Project {
  id: string;
  name: string;
  color?: string | null;
  description?: string | null;
  order: number;
}

export type NodeKind =
  | "database" | "schema" | "folder" | "table" | "view" | "materializedView"
  | "function" | "procedure" | "trigger" | "sequence" | "index" | "foreignKey" | "column"
  | "event" | "collection" | "key" | "keyGroup" | "user";

export interface TableRef {
  database?: string | null;
  schema?: string | null;
  name: string;
}

export interface TreeNode {
  path: string[];
  label: string;
  kind: NodeKind;
  hasChildren: boolean;
  detail?: string | null;
  table?: TableRef | null;
}

export interface ColumnInfo { name: string; typeName: string }

export type CellValue = string | number | boolean | null | object;

export interface QueryResult {
  statement: string;
  columns: ColumnInfo[];
  rows: CellValue[][];
  rowsAffected?: number | null;
  elapsedMs: number;
  truncated: boolean;
  message?: string | null;
}

export interface ExecOptions {
  database?: string | null;
  schema?: string | null;
  maxRows?: number | null;
  /** Don't record in query history (internal/background queries). Frontend-only flag. */
  skipHistory?: boolean;
}

export interface SortSpec { column: string; desc: boolean }

export interface TableDataRequest {
  table: TableRef;
  offset: number;
  limit: number;
  /** SQL WHERE expression, or Mongo JSON filter. */
  filter?: string | null;
  sort: SortSpec[];
}

export interface TableDataPage {
  result: QueryResult;
  total?: number | null;
  primaryKey: string[];
}

export interface ColumnDef {
  name: string;
  dataType: string;
  nullable: boolean;
  default?: string | null;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  comment?: string | null;
  ordinal: number;
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  method?: string | null;
}

export interface ForeignKeyDef {
  name: string;
  columns: string[];
  refSchema?: string | null;
  refTable: string;
  refColumns: string[];
  onUpdate?: string | null;
  onDelete?: string | null;
}

export interface TableStructure {
  table?: TableRef | null;
  columns: ColumnDef[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
  comment?: string | null;
}

export interface SchemaSnapshot {
  tables: TableStructure[];
  views: [TableRef, string][];
}

export type RowChange =
  | { op: "insert"; values: Record<string, CellValue> }
  | { op: "update"; key: Record<string, CellValue>; values: Record<string, CellValue> }
  | { op: "delete"; key: Record<string, CellValue> };

export type Dialect = "postgres" | "mysql" | "sqlite" | "mssql" | "none";

export function dialectOf(kind: ConnectionKind): Dialect {
  switch (kind) {
    case "postgres": case "mysql": case "sqlite": case "mssql": return kind;
    default: return "none";
  }
}

/** Redis key value as returned by db_get_key. */
export interface RedisKeyValue {
  key: string;
  type: "string" | "list" | "set" | "zset" | "hash" | "stream" | "none" | string;
  /** seconds, -1 = no expiry */
  ttl: number;
  length?: number;
  /** string: string; list/set: string[]; zset: [member, score][]; hash: Record<string,string>; stream: entries */
  value: unknown;
}

export interface HistoryEntry {
  id: string;
  connectionId: string;
  database?: string | null;
  query: string;
  executedAt: string;
  elapsedMs: number;
  success: boolean;
  error?: string | null;
}

export interface SavedQuery {
  id: string;
  name: string;
  connectionId?: string | null;
  database?: string | null;
  query: string;
  updatedAt: string;
}

export type ExportFormat = "csv" | "json" | "sql" | "xlsx";
