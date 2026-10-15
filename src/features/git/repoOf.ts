// Which git repository (work-tree root) contains a file? Cached per directory.
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { dirname } from "../files/format";

const cache = new Map<string, Promise<string | null>>();

export function repoRootOf(dir: string): Promise<string | null> {
  let p = cache.get(dir);
  if (!p) {
    p = api.gitStatus(dir).then((s) => (s.isRepo ? s.root ?? null : null)).catch(() => null);
    cache.set(dir, p);
  }
  return p;
}

/** Repo root of a file: undefined while looking, null when it isn't in a repo. */
export function useRepoRoot(file: string): string | null | undefined {
  const dir = dirname(file);
  const [root, setRoot] = useState<{ dir: string; root: string | null } | null>(null);
  useEffect(() => {
    let stale = false;
    void repoRootOf(dir).then((r) => { if (!stale) setRoot({ dir, root: r }); });
    return () => { stale = true; };
  }, [dir]);
  return root?.dir === dir ? root.root : undefined;
}
