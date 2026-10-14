// Context menu builders for every tree row type.
import {
  ArrowLeftRight, Code, Copy, CopyPlus, Eraser, ExternalLink, FilePlus, GitCompare, Network, Pencil,
  PencilRuler, Play, Plug, Plus, RefreshCw, SquareTerminal, Table2, Trash2, Unplug,
} from "lucide-react";
import { dialectOf, type ConnectionConfig } from "../../../lib/types";
import { useConnections } from "../../../store/connections";
import { useUi } from "../../../store/ui";
import type { MenuItem } from "../ContextMenu";
import {
  openDataTransfer, openDdl, openErDiagram, openInfra, openMongoCollection, openQuery, openRedis,
  openSchemaCompare, openTableData, openTableDesign,
} from "../openers";
import { isSqlKind, selectTop } from "../../table/sqlDialect";
import {
  activateConnection, copyText, deleteConnection, deleteRedisKey, disconnect, dropCollection, dropObject,
  duplicateConnection, refreshAll, truncateTable,
} from "./actions";
import { isInfra, isTablesFolder, redisKeyOf, refOf, type Row } from "./rows";
import { useTree } from "./store";

const ic = (I: typeof Play) => <I className="size-3.5" />;
const refresh = (connId: string, path: string[]) => useTree.getState().refresh(connId, path);

function connectionMenu(conn: ConnectionConfig): MenuItem[] {
  const edit: MenuItem[] = [
    { label: "Edit connection…", icon: ic(Pencil), onClick: () => useUi.getState().openConnectionDialog(conn.id) },
    { label: "Duplicate", icon: ic(CopyPlus), onClick: () => duplicateConnection(conn) },
    { label: "Delete", icon: ic(Trash2), danger: true, onClick: () => deleteConnection(conn) },
  ];
  if (isInfra(conn)) {
    return [{ label: "Open", icon: ic(ExternalLink), onClick: () => openInfra(conn.id, conn.kind === "kubernetes" ? "k8s" : "rabbitmq") }, "separator", ...edit];
  }
  const isOpen = useConnections.getState().open.has(conn.id);
  return [
    isOpen
      ? { label: "Disconnect", icon: ic(Unplug), onClick: () => disconnect(conn) }
      : { label: "Connect", icon: ic(Plug), onClick: () => activateConnection(conn) },
    { label: "New query", icon: ic(SquareTerminal), onClick: () => openQuery(conn.id, { database: conn.database }) },
    { label: "Refresh", icon: ic(RefreshCw), shortcut: "F5", onClick: () => refresh(conn.id, []) },
    "separator",
    { label: "Data transfer…", icon: ic(ArrowLeftRight), onClick: () => openDataTransfer(conn.id, conn.database) },
    ...(isSqlKind(conn.kind) ? [{ label: "Schema compare…", icon: ic(GitCompare), onClick: () => openSchemaCompare(conn.id) } as MenuItem] : []),
    "separator",
    ...edit,
  ];
}

function nodeMenu(row: Extract<Row, { type: "node" }>): MenuItem[] {
  const { conn, node, ctx, parentPath } = row;
  const sql = isSqlKind(conn.kind);
  const ref = refOf(node, ctx);
  const doRefresh: MenuItem = { label: "Refresh", icon: ic(RefreshCw), shortcut: "F5", onClick: () => refresh(conn.id, node.path) };
  const copyName: MenuItem = { label: "Copy name", icon: ic(Copy), onClick: () => copyText(node.label) };

  switch (node.kind) {
    case "database":
    case "schema": {
      const db = ctx.database;
      const schema = ctx.schema;
      if (conn.kind === "redis") {
        return [
          { label: "Open key browser", icon: ic(ExternalLink), onClick: () => openRedis(conn.id, db) },
          { label: "New console", icon: ic(SquareTerminal), onClick: () => openQuery(conn.id, { database: db }) },
          "separator", doRefresh,
        ];
      }
      if (!sql) {
        return [
          { label: "New query", icon: ic(SquareTerminal), onClick: () => openQuery(conn.id, { database: db }) },
          { label: "Import / export…", icon: ic(ArrowLeftRight), onClick: () => openDataTransfer(conn.id, db) },
          "separator", copyName, doRefresh,
        ];
      }
      return [
        { label: "New query", icon: ic(SquareTerminal), onClick: () => openQuery(conn.id, { database: db, schema }) },
        { label: "New table…", icon: ic(FilePlus), onClick: () => openTableDesign(conn.id, null, db, schema) },
        "separator",
        { label: "ER diagram", icon: ic(Network), onClick: () => openErDiagram(conn.id, db, schema) },
        { label: "Backup / restore, import / export…", icon: ic(ArrowLeftRight), onClick: () => openDataTransfer(conn.id, db, schema) },
        { label: "Schema compare…", icon: ic(GitCompare), onClick: () => openSchemaCompare(conn.id) },
        "separator", copyName, doRefresh,
      ];
    }
    case "folder":
      return isTablesFolder(node) && sql
        ? [{ label: "New table…", icon: ic(Plus), onClick: () => openTableDesign(conn.id, null, ctx.database, ctx.schema) }, "separator", doRefresh]
        : [doRefresh];
    case "table":
    case "view":
    case "materializedView": {
      if (!sql) {
        return [
          { label: "Open", icon: ic(Table2), onClick: () => (conn.kind === "mongodb" ? openMongoCollection(conn.id, ref) : openTableData(conn.id, ref)) },
          copyName,
        ];
      }
      const d = dialectOf(conn.kind);
      const isTable = node.kind === "table";
      return [
        { label: "Open data", icon: ic(Table2), shortcut: "↵", onClick: () => openTableData(conn.id, ref) },
        ...(isTable ? [{ label: "Design table", icon: ic(PencilRuler), onClick: () => openTableDesign(conn.id, ref) } as MenuItem] : []),
        { label: "View DDL", icon: ic(Code), onClick: () => openDdl(conn.id, ref, node.kind) },
        { label: "New query", icon: ic(SquareTerminal), onClick: () => openQuery(conn.id, { database: ref.database, schema: ref.schema, initialSql: selectTop(d, ref) }) },
        { label: "Export…", icon: ic(ArrowLeftRight), onClick: () => openDataTransfer(conn.id, ref.database, ref.schema) },
        "separator",
        copyName,
        doRefresh,
        "separator",
        ...(isTable ? [{ label: "Truncate…", icon: ic(Eraser), danger: true, onClick: () => truncateTable(conn, ref, parentPath) } as MenuItem] : []),
        { label: isTable ? "Drop table…" : "Drop view…", icon: ic(Trash2), danger: true, onClick: () => dropObject(conn, node, ref, parentPath) },
      ];
    }
    case "collection":
      return [
        { label: "Open", icon: ic(Table2), shortcut: "↵", onClick: () => openMongoCollection(conn.id, ref) },
        { label: "New query", icon: ic(SquareTerminal), onClick: () => openQuery(conn.id, { database: ref.database, initialSql: `db.getCollection(${JSON.stringify(ref.name)}).find({}).limit(100)` }) },
        { label: "Export…", icon: ic(ArrowLeftRight), onClick: () => openDataTransfer(conn.id, ref.database) },
        "separator", copyName, doRefresh, "separator",
        { label: "Drop collection…", icon: ic(Trash2), danger: true, onClick: () => dropCollection(conn, ref, parentPath) },
      ];
    case "key": {
      const key = redisKeyOf(node);
      return [
        { label: "Open", icon: ic(ExternalLink), shortcut: "↵", onClick: () => openRedis(conn.id, ctx.database, key) },
        { label: "Copy key", icon: ic(Copy), onClick: () => copyText(key) },
        "separator",
        { label: "Delete key…", icon: ic(Trash2), danger: true, onClick: () => deleteRedisKey(conn, ctx.database, key, parentPath) },
      ];
    }
    case "function":
    case "procedure":
    case "trigger":
    case "sequence":
    case "event":
      return [
        { label: "View DDL", icon: ic(Code), shortcut: "↵", onClick: () => openDdl(conn.id, ref, node.kind) },
        copyName,
      ];
    default:
      return node.hasChildren ? [copyName, doRefresh] : [copyName];
  }
}

export function rowMenu(row: Row): MenuItem[] | null {
  switch (row.type) {
    case "conn": return connectionMenu(row.conn);
    case "node": return nodeMenu(row);
    case "group": return [
      { label: row.collapsed ? "Expand group" : "Collapse group", onClick: () => useTree.getState().toggleGroup(row.name) },
      { label: "New connection…", icon: ic(Plus), onClick: () => useUi.getState().openConnectionDialog(null) },
    ];
    default: return null;
  }
}

export function backgroundMenu(): MenuItem[] {
  return [
    { label: "New connection…", icon: ic(Plus), onClick: () => useUi.getState().openConnectionDialog(null) },
    { label: "Refresh all", icon: ic(RefreshCw), onClick: () => void refreshAll() },
    { label: "Collapse all", onClick: () => useTree.getState().collapseAll() },
  ];
}
