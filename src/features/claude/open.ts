import { openTab, useTabs } from "../../store/tabs";

export type ClaudeView = "chat" | "diff" | "review";

export function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** Stable tab key: `claude:${cwd}` for a new chat, `claude:${cwd}:${sessionId}` for a resumed session. */
export function claudeTabKey(cwd: string, sessionId?: string | null): string {
  return sessionId ? `claude:${cwd}:${sessionId}` : `claude:${cwd}`;
}

/** Open (or focus) the Claude Code workspace tab for a folder. Returns the tab id. */
export function openClaudeWorkspace(
  cwd: string,
  opts?: { sessionId?: string | null; view?: ClaudeView; title?: string | null },
): string {
  const sessionId = opts?.sessionId ?? null;
  const key = claudeTabKey(cwd, sessionId);
  const short = opts?.title ? opts.title.trim().slice(0, 28) + (opts.title.trim().length > 28 ? "…" : "") : null;
  const title = short ? `${basename(cwd)} · ${short}` : basename(cwd);
  const id = openTab({ type: "claude", cwd, sessionId, view: opts?.view ?? "chat" }, title, key);
  // Tab may already exist: still honor a requested view.
  if (opts?.view) useTabs.getState().update(id, { view: opts.view } as never);
  return id;
}
