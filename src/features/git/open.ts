import { openTab, useTabs } from "../../store/tabs";
import type { GitView } from "../../tabs/types";
import { basename, openFilePreview } from "../files/format";

export const gitTabKey = (repo: string) => `git:${repo.replace(/[\\/]+$/, "")}`;

/** Open (or focus) the Git tab of a repository. `path` filters History to one file, `sha` selects a commit. */
export function openGitRepo(repo: string, opts?: { view?: GitView; path?: string | null; sha?: string | null }): string {
  const root = repo.replace(/[\\/]+$/, "") || repo;
  const view = opts?.view ?? (opts?.path || opts?.sha ? "history" : undefined);
  const id = openTab({ type: "git", repo: root, view: view ?? "history", path: opts?.path ?? null, sha: opts?.sha ?? null }, basename(root), gitTabKey(root));
  // Tab may already exist: apply what was asked for (an omitted path keeps the current filter).
  const p: Record<string, unknown> = {};
  if (view) p.view = view;
  if (opts && "path" in opts) p.path = opts.path ?? null;
  if (opts?.sha) p.sha = opts.sha;
  if (Object.keys(p).length) useTabs.getState().update(id, p as never);
  return id;
}

/** Open the file preview with git blame shown. */
export function openBlame(path: string, root?: string | null): string {
  const id = openFilePreview(path, root);
  useTabs.getState().update(id, { blame: true } as never);
  return id;
}
