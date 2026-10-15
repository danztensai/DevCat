// Per-repo git state shared by the Git tab views and the sidebar (refs + working-tree status),
// and a helper that runs a git action with toasts and refreshes afterwards.
import { toast } from "sonner";
import { create } from "zustand";
import { api, errMsg } from "../../lib/api";
import type { GitRefs, GitStatus } from "../../lib/types";

export interface RepoState {
  refs: GitRefs | null;
  refsError: string | null;
  status: GitStatus | null;
  statusError: string | null;
  loading: boolean;
  /** Bumped after every refresh; views that cache data (stashes, open diffs) reload on it. */
  tick: number;
}

const EMPTY: RepoState = { refs: null, refsError: null, status: null, statusError: null, loading: false, tick: 0 };

export const useGitRepos = create<{ repos: Record<string, RepoState> }>(() => ({ repos: {} }));

function patch(repo: string, p: Partial<RepoState>) {
  useGitRepos.setState((s) => ({ repos: { ...s.repos, [repo]: { ...(s.repos[repo] ?? EMPTY), ...p } } }));
}

export function useRepo(repo: string): RepoState {
  return useGitRepos((s) => s.repos[repo] ?? EMPTY);
}

/** Keep the previous object when nothing changed so subscribers don't re-render. */
function same<T>(a: T | null, b: T): T {
  return a && JSON.stringify(a) === JSON.stringify(b) ? a : b;
}

const inflight = new Map<string, Promise<void>>();

/** Re-read refs and status of a repo. Concurrent calls share one request. */
export function refreshRepo(repo: string): Promise<void> {
  const cur = inflight.get(repo);
  if (cur) return cur;
  const p = (async () => {
    patch(repo, { loading: true });
    const [refs, status] = await Promise.allSettled([api.gitRefs(repo), api.gitStatus(repo)]);
    const prev = useGitRepos.getState().repos[repo] ?? EMPTY;
    patch(repo, {
      refs: refs.status === "fulfilled" ? same(prev.refs, refs.value) : prev.refs,
      refsError: refs.status === "rejected" ? errMsg(refs.reason) : null,
      status: status.status === "fulfilled" ? same(prev.status, status.value) : prev.status,
      statusError: status.status === "rejected" ? errMsg(status.reason) : null,
      loading: false,
      tick: prev.tick + 1,
    });
  })().finally(() => inflight.delete(repo));
  inflight.set(repo, p);
  return p;
}

/** Last lines of git's output for a toast description. */
export function outputTail(out: string | null | undefined, max = 600): string | undefined {
  const t = (out ?? "").trim();
  if (!t) return undefined;
  return t.length > max ? "…" + t.slice(t.length - max) : t;
}

/**
 * Run a git action: loading toast → success (with git output) / error toast, then refresh the repo.
 * Returns the action's result, or undefined when it failed. `rethrow` lets the caller handle errors itself.
 */
export async function gitAction<T>(
  repo: string,
  label: string,
  fn: () => Promise<T>,
  opts?: { done?: string; rethrow?: boolean; quiet?: boolean },
): Promise<T | undefined> {
  const id = opts?.quiet ? undefined : toast.loading(`${label}…`);
  try {
    const out = await fn();
    const description = typeof out === "string" ? outputTail(out) : undefined;
    if (id !== undefined) toast.success(opts?.done ?? label, { id, description });
    return out;
  } catch (e) {
    if (opts?.rethrow) {
      if (id !== undefined) toast.dismiss(id);
      throw e;
    }
    toast.error(`${label} failed`, { id, description: outputTail(errMsg(e), 1200) });
    return undefined;
  } finally {
    void refreshRepo(repo);
  }
}
