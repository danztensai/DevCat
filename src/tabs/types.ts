import type { NodeKind, TableRef } from "../lib/types";

/** Every tab kind the workspace can show. Add new kinds here + in registry.tsx. */
export type TabSpec =
  | { type: "welcome" }
  | { type: "query"; connId: string; database?: string | null; schema?: string | null; initialSql?: string; savedQueryId?: string }
  | { type: "table-data"; connId: string; table: TableRef }
  | { type: "table-design"; connId: string; table?: TableRef | null; database?: string | null; schema?: string | null }
  | { type: "ddl"; connId: string; table: TableRef; kind: NodeKind }
  | { type: "redis"; connId: string; database?: string | null; key?: string | null }
  | { type: "mongo-collection"; connId: string; table: TableRef }
  | { type: "er-diagram"; connId: string; database?: string | null; schema?: string | null }
  | { type: "schema-compare"; sourceConnId?: string; targetConnId?: string }
  | { type: "data-transfer"; connId?: string; database?: string | null; schema?: string | null }
  | { type: "history" }
  | { type: "k8s"; connId: string }
  | { type: "rabbitmq"; connId: string }
  /** Network profile (VPN / SSH tunnel) details; profileId "" = new (kind preselected). */
  | { type: "network"; profileId: string; kind?: "ssh" | "openvpn" | "wireguard"; importPath?: string };

export type Tab = TabSpec & {
  id: string;
  title: string;
  /** dirty indicator (unsaved edits) */
  dirty?: boolean;
};

/** Connection a tab belongs to (used by project focus mode); null = not tied to a connection. */
export function tabConnId(t: TabSpec): string | null {
  if ("connId" in t && t.connId) return t.connId;
  if (t.type === "schema-compare") return t.sourceConnId ?? t.targetConnId ?? null;
  return null;
}
