// "Show only bookmarked": once a connection is expanded, expand the path to each of its
// bookmarks (once), so the filtered tree isn't empty. Collapsing by hand afterwards sticks.
import { useEffect, useRef } from "react";
import type { Bookmark } from "../../../lib/types";
import { nodeKey, samePath } from "../tree/keys";
import { useTree, type NodeState } from "../tree/store";

export function useAutoExpandBookmarks(bookmarks: Bookmark[], bookmarksOnly: boolean, nodes: Record<string, NodeState>) {
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (!bookmarksOnly) {
      done.current.clear();
      return;
    }
    const t = useTree.getState();
    for (const b of bookmarks) {
      if (!nodes[nodeKey(b.connectionId, [])]?.expanded) {
        // Collapsed or disconnected: expand again next time it opens.
        const prefix = `${b.connectionId}|`;
        for (const k of done.current) if (k.startsWith(prefix)) done.current.delete(k);
        continue;
      }
      for (let i = 1; i < b.path.length; i++) {
        const seg = b.path.slice(0, i);
        const key = nodeKey(b.connectionId, seg);
        if (done.current.has(key)) continue;
        const parent = nodes[nodeKey(b.connectionId, b.path.slice(0, i - 1))];
        if (!parent?.children?.some((k) => samePath(k.path, seg))) break; // not loaded yet (or gone)
        done.current.add(key);
        if (!nodes[key]?.expanded) t.setExpanded(b.connectionId, seg, true);
      }
    }
  }, [bookmarks, bookmarksOnly, nodes]);
}
