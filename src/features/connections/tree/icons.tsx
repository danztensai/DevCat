import clsx from "clsx";
import {
  Boxes, CalendarClock, Cog, Columns3, Database, Eye, Folder, FolderOpen, KeyRound, Layers, Layers3,
  Info, Link2, ListOrdered, SquareFunction, Table2, User, Zap,
} from "lucide-react";
import type { NodeKind, TreeNode } from "../../../lib/types";

/** Redis key type -> theme color. */
function keyColor(detail?: string | null): string {
  const t = (detail ?? "").toLowerCase();
  if (t.startsWith("string")) return "text-ok";
  if (t.startsWith("hash")) return "text-info";
  if (t.startsWith("list")) return "text-warn";
  if (t.startsWith("zset")) return "text-danger";
  if (t.startsWith("set")) return "text-accent";
  return "text-muted";
}

const base = "size-3.5 shrink-0";

export function NodeIcon({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  const k: NodeKind = node.kind;
  switch (k) {
    case "database": return <Database className={clsx(base, "text-info")} />;
    case "schema": return <Layers className={clsx(base, "text-info/80")} />;
    case "folder":
      if (isNoteNode(node)) return <Info className={clsx(base, "text-warn")} />;
      return expanded
        ? <FolderOpen className={clsx(base, "text-muted")} />
        : <Folder className={clsx(base, "text-muted")} />;
    case "keyGroup":
      return expanded
        ? <FolderOpen className={clsx(base, "text-muted")} />
        : <Folder className={clsx(base, "text-muted")} />;
    case "table": return <Table2 className={clsx(base, "text-accent")} />;
    case "view": return <Eye className={clsx(base, "text-ok")} />;
    case "materializedView": return <Layers3 className={clsx(base, "text-ok")} />;
    case "function": return <SquareFunction className={clsx(base, "text-info")} />;
    case "procedure": return <Cog className={clsx(base, "text-info")} />;
    case "trigger": return <Zap className={clsx(base, "text-warn")} />;
    case "sequence": return <ListOrdered className={clsx(base, "text-muted")} />;
    case "foreignKey": return <Link2 className={clsx(base, "text-info")} />;
    case "index": return <KeyRound className={clsx(base, "text-warn")} />;
    case "column": return <Columns3 className={clsx(base, "text-faint")} />;
    case "event": return <CalendarClock className={clsx(base, "text-muted")} />;
    case "collection": return <Boxes className={clsx(base, "text-ok")} />;
    case "key": return <KeyRound className={clsx(base, keyColor(node.detail))} />;
    case "user": return <User className={clsx(base, "text-muted")} />;
    default: return <Folder className={clsx(base, "text-muted")} />;
  }
}

/** Non-expandable informational node (e.g. Redis "scan capped at N keys"). */
export function isNoteNode(node: TreeNode): boolean {
  return node.kind === "folder" && !node.hasChildren && (node.path[node.path.length - 1] ?? "").startsWith("\u0000");
}
