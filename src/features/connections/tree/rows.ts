// Flattens connections + cached tree nodes into the visible row list rendered by the
// virtualized tree. Also derives database/schema context for every node.
import type { ConnectionConfig, TableRef, TreeNode } from "../../../lib/types";
import { INFRA_KINDS } from "../../../lib/types";
import { nodeKey, type NodeState } from "./store";

/** Database / schema / folder a node lives in (inclusive of the node itself). */
export interface NodeCtx {
  database: string | null;
  schema: string | null;
  /** lowercase name of the nearest folder ("tables", "views", ...) */
  folder: string | null;
}

export type Row =
  | { type: "group"; id: string; name: string; count: number; collapsed: boolean; depth: 0; parentId: null }
  | { type: "conn"; id: string; conn: ConnectionConfig; depth: number; expanded: boolean; parentId: string | null }
  | { type: "node"; id: string; conn: ConnectionConfig; node: TreeNode; ctx: NodeCtx; parentPath: string[]; depth: number; expanded: boolean; loading: boolean; parentId: string }
  | { type: "error"; id: string; conn: ConnectionConfig; path: string[]; message: string; depth: number; parentId: string }
  | { type: "empty"; id: string; depth: number; parentId: string };

export type SelectableRow = Extract<Row, { type: "group" | "conn" | "node" }>;

export const isInfra = (c: ConnectionConfig) => INFRA_KINDS.includes(c.kind);
export const connRowId = (id: string) => `c:${id}`;
export const nodeRowId = (connId: string, path: string[]) => `n:${nodeKey(connId, path)}`;

const lastSeg = (n: TreeNode) => n.path[n.path.length - 1] ?? n.label;

export function childCtx(ctx: NodeCtx, n: TreeNode): NodeCtx {
  switch (n.kind) {
    case "database": return { database: n.table?.database ?? lastSeg(n), schema: null, folder: null };
    case "schema": return { ...ctx, schema: n.table?.schema ?? lastSeg(n), folder: null };
    case "folder": return { ...ctx, folder: lastSeg(n).toLowerCase() };
    default: return ctx;
  }
}

/** TableRef for an openable node, synthesized from context when the backend omits it. */
export function refOf(n: TreeNode, ctx: NodeCtx): TableRef {
  return n.table ?? { database: ctx.database, schema: ctx.schema, name: n.label };
}

/** Redis key name for a key node. */
export const redisKeyOf = (n: TreeNode) => n.table?.name ?? lastSeg(n);

/** True if the node is a "Tables" folder (or a folder of a SQL kind that holds tables). */
export function isTablesFolder(n: TreeNode): boolean {
  return n.kind === "folder" && (lastSeg(n).toLowerCase() === "tables" || n.label.toLowerCase() === "tables");
}

interface BuildArgs {
  connections: ConnectionConfig[];
  nodes: Record<string, NodeState>;
  collapsedGroups: Record<string, boolean>;
  query: string;
}

export function buildRows({ connections, nodes, collapsedGroups, query }: BuildArgs): Row[] {
  const q = query.trim().toLowerCase();
  const rows: Row[] = [];
  const matchMemo = new Map<string, boolean>();

  // Does any loaded descendant of (connId, path) match the query?
  const descMatches = (connId: string, path: string[]): boolean => {
    const key = nodeKey(connId, path);
    const memo = matchMemo.get(key);
    if (memo !== undefined) return memo;
    matchMemo.set(key, false); // cycle guard
    const kids = nodes[key]?.children ?? [];
    const res = kids.some((k) => k.label.toLowerCase().includes(q) || descMatches(connId, k.path));
    matchMemo.set(key, res);
    return res;
  };

  const emitChildren = (conn: ConnectionConfig, path: string[], ctx: NodeCtx, depth: number, parentId: string, filter: boolean) => {
    const st = nodes[nodeKey(conn.id, path)];
    if (st?.error) {
      rows.push({ type: "error", id: `e:${nodeKey(conn.id, path)}`, conn, path, message: st.error, depth, parentId });
      return;
    }
    const kids = st?.children;
    if (!kids) return;
    if (kids.length === 0 && !filter) {
      rows.push({ type: "empty", id: `x:${nodeKey(conn.id, path)}`, depth, parentId });
      return;
    }
    for (const n of kids) {
      const selfMatch = filter && n.label.toLowerCase().includes(q);
      const below = filter && !selfMatch && descMatches(conn.id, n.path);
      if (filter && !selfMatch && !below) continue;
      const ns = nodes[nodeKey(conn.id, n.path)];
      const nctx = childCtx(ctx, n);
      // While searching, ancestors of matches are shown expanded.
      const expanded = n.hasChildren && (below || !!ns?.expanded);
      const id = nodeRowId(conn.id, n.path);
      rows.push({ type: "node", id, conn, node: n, ctx: nctx, parentPath: path, depth, expanded, loading: !!ns?.loading, parentId });
      if (expanded || (ns?.error && ns.expanded)) emitChildren(conn, n.path, nctx, depth + 1, id, below);
    }
  };

  const emitConn = (conn: ConnectionConfig, depth: number, parentId: string | null) => {
    const nameMatch = !q || conn.name.toLowerCase().includes(q);
    const below = !!q && !nameMatch && !isInfra(conn) && descMatches(conn.id, []);
    if (!nameMatch && !below) return;
    const root = nodes[nodeKey(conn.id, [])];
    const expanded = !isInfra(conn) && (below || !!root?.expanded);
    const id = connRowId(conn.id);
    rows.push({ type: "conn", id, conn, depth, expanded, parentId });
    if (expanded) emitChildren(conn, [], { database: null, schema: null, folder: null }, depth + 1, id, below);
  };

  const ungrouped = connections.filter((c) => !c.group);
  const groups = new Map<string, ConnectionConfig[]>();
  for (const c of connections) if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  const byName = (a: ConnectionConfig, b: ConnectionConfig) => a.name.localeCompare(b.name);

  for (const c of [...ungrouped].sort(byName)) emitConn(c, 0, null);
  for (const name of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    const members = groups.get(name)!.sort(byName);
    const gid = `g:${name}`;
    const groupMatch = !q || name.toLowerCase().includes(q);
    const at = rows.length;
    // When searching, groups are always expanded so matches are visible.
    const collapsed = !q && !!collapsedGroups[name];
    rows.push({ type: "group", id: gid, name, count: members.length, collapsed, depth: 0, parentId: null });
    if (!collapsed) {
      if (groupMatch && q) {
        // group name matched: show all members unfiltered
        for (const c of members) {
          const id = connRowId(c.id);
          const expanded = !isInfra(c) && !!nodes[nodeKey(c.id, [])]?.expanded;
          rows.push({ type: "conn", id, conn: c, depth: 1, expanded, parentId: gid });
          if (expanded) emitChildren(c, [], { database: null, schema: null, folder: null }, 2, id, false);
        }
      } else {
        for (const c of members) emitConn(c, 1, gid);
      }
    }
    // Drop group header if nothing in it matched the search.
    if (q && rows.length === at + 1 && !groupMatch) rows.pop();
  }
  return rows;
}
