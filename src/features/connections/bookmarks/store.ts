// Bookmarked tree nodes, shown at the top of the Connections sidebar. Persisted by the
// backend (bookmarks.json); other windows reload on the "bookmarks" broadcast.
import { toast } from "sonner";
import { create } from "zustand";
import { api, errMsg } from "../../../lib/api";
import type { Bookmark, ConnectionConfig, TreeNode } from "../../../lib/types";
import { broadcast, onBroadcast } from "../../../lib/windows";
import { samePath } from "../tree/keys";
import { redisKeyOf, refOf, type NodeCtx } from "../tree/rows";

interface BookmarksState {
  bookmarks: Bookmark[];
  load: () => Promise<void>;
  add: (conn: ConnectionConfig, node: TreeNode, ctx: NodeCtx) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Move a bookmark one place up (-1) or down (1). */
  move: (id: string, dir: -1 | 1) => Promise<void>;
}

/** Run a change, then reload from the backend (also on failure) and tell other windows. */
async function change(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (e) {
    toast.error(errMsg(e));
  }
  await useBookmarks.getState().load();
  broadcast({ kind: "bookmarks" });
}

export const useBookmarks = create<BookmarksState>((_set, get) => ({
  bookmarks: [],
  load: async () => {
    try {
      useBookmarks.setState({ bookmarks: await api.listBookmarks() });
    } catch (e) {
      console.error(e);
    }
  },
  add: (conn, node, ctx) =>
    change(() =>
      api.addBookmark({
        id: "",
        connectionId: conn.id,
        path: node.path,
        label: node.label,
        kind: node.kind,
        // Same reference activateNode opens (Redis keys carry their db + key name).
        table: node.kind === "key" ? { database: node.table?.database ?? ctx.database, name: redisKeyOf(node) } : refOf(node, ctx),
        order: 0,
      }),
    ),
  remove: (id) => change(() => api.removeBookmark(id)),
  move: (id, dir) => {
    const ids = get().bookmarks.map((b) => b.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return Promise.resolve();
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return change(() => api.reorderBookmarks(ids));
  },
}));

export const findBookmark = (connId: string, path: string[]) =>
  useBookmarks.getState().bookmarks.find((b) => b.connectionId === connId && samePath(b.path, path));

onBroadcast((m) => {
  if (m.kind === "bookmarks") void useBookmarks.getState().load();
});
