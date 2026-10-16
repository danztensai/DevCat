import { openTab, useTabs } from "../../store/tabs";
import { CLAUDE_PROVIDER_ID, findProvider, useProviders } from "./providers";

/** "terminal" shows the tab's active extra terminal. */
export type ClaudeView = "chat" | "diff" | "review" | "terminal";

export function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** Stable tab key: `claude:${cwd}` for a new Claude chat, `claude:${cwd}:${sessionId}` for a resumed session,
 *  `claude:${cwd}@${providerId}` for other AI connections. */
export function claudeTabKey(cwd: string, sessionId?: string | null, providerId?: string | null): string {
  if (providerId && providerId !== CLAUDE_PROVIDER_ID) return `claude:${cwd}@${providerId}`;
  return sessionId ? `claude:${cwd}:${sessionId}` : `claude:${cwd}`;
}

/** Open (or focus) the AI workspace tab for a folder. Returns the tab id.
 *  providerId defaults to the AI connection selected for new chats; sessions are Claude's. */
export function openClaudeWorkspace(
  cwd: string,
  opts?: { sessionId?: string | null; view?: ClaudeView; title?: string | null; providerId?: string | null },
): string {
  const st = useProviders.getState();
  const provider = opts?.sessionId
    ? findProvider(st.providers, CLAUDE_PROVIDER_ID)!
    : findProvider(st.providers, opts?.providerId ?? st.selectedId) ?? findProvider(st.providers, CLAUDE_PROVIDER_ID)!;
  const isClaude = provider.id === CLAUDE_PROVIDER_ID;
  const sessionId = isClaude ? (opts?.sessionId ?? null) : null;
  const key = claudeTabKey(cwd, sessionId, provider.id);
  const short = opts?.title ? opts.title.trim().slice(0, 28) + (opts.title.trim().length > 28 ? "…" : "") : null;
  const title = short ? `${basename(cwd)} · ${short}` : isClaude ? basename(cwd) : `${basename(cwd)} · ${provider.name}`;
  const id = openTab({ type: "claude", cwd, sessionId, view: opts?.view ?? "chat", providerId: isClaude ? null : provider.id }, title, key);
  // Tab may already exist: still honor a requested view.
  if (opts?.view) useTabs.getState().update(id, { view: opts.view } as never);
  return id;
}
