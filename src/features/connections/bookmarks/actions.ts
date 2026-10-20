// Opening a bookmark: objects open their tab; databases and schemas are revealed in the tree.
import { toast } from "sonner";
import type { Bookmark, ConnectionConfig, TreeNode } from "../../../lib/types";
import { openDdl, openMongoCollection, openRedis, openTableData } from "../openers";
import { nodeKey, samePath } from "../tree/keys";
import { nodeRowId } from "../tree/rows";
import { useTree } from "../tree/store";

const tree = () => useTree.getState();

/** False for bookmarks that can only be revealed (SQL / Mongo databases and schemas). */
export const opensInTab = (b: Bookmark, conn: ConnectionConfig) =>
  !(b.kind === "schema" || (b.kind === "database" && conn.kind !== "redis"));

/** Double-click / Enter on a bookmark row. */
export function openBookmark(b: Bookmark, conn: ConnectionConfig) {
  const ref = b.table ?? { name: b.label };
  switch (b.kind) {
    case "table":
    case "view":
    case "materializedView":
      if (conn.kind === "mongodb") openMongoCollection(conn.id, ref);
      else openTableData(conn.id, ref);
      return;
    case "collection":
      openMongoCollection(conn.id, ref);
      return;
    case "function":
    case "procedure":
    case "trigger":
    case "sequence":
    case "event":
      openDdl(conn.id, ref, b.kind);
      return;
    case "key":
      openRedis(conn.id, ref.database ?? null, ref.name);
      return;
    case "database":
      if (conn.kind === "redis") {
        openRedis(conn.id, ref.database ?? null);
        return;
      }
      break;
  }
  void revealBookmark(b, conn);
}

/** Children of a node once loaded (loading them if needed); null if loading failed. */
function loadedChildren(connId: string, path: string[]): Promise<TreeNode[] | null> {
  const key = nodeKey(connId, path);
  const st = tree().nodes[key];
  if (!st?.loading && !st?.children && !st?.error) void tree().load(connId, path);
  return new Promise((resolve) => {
    const check = () => {
      const n = tree().nodes[key];
      if (!n || n.loading || (!n.children && !n.error)) return false;
      resolve(n.error ? null : n.children ?? null);
      return true;
    };
    if (check()) return;
    const unsub = useTree.subscribe(() => {
      if (check()) unsub();
    });
  });
}

/** Expand the tree down to a bookmark, then select it and scroll it into view. */
export async function revealBookmark(b: Bookmark, conn: ConnectionConfig) {
  if (conn.projectId) tree().setProjectCollapsed(conn.projectId, false);
  await tree().expandConnection(conn.id);
  for (let i = 0; i < b.path.length; i++) {
    const kids = await loadedChildren(conn.id, b.path.slice(0, i));
    if (!kids) return; // connection or load error: already shown in the tree
    const seg = b.path.slice(0, i + 1);
    if (!kids.some((k) => samePath(k.path, seg))) {
      toast.error(`Couldn't find ${b.label} in ${conn.name}`);
      return;
    }
    if (i < b.path.length - 1) tree().setExpanded(conn.id, seg, true);
  }
  tree().reveal(nodeRowId(conn.id, b.path));
}
