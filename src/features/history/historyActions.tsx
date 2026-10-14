// Shared actions + formatting for the history sidebar panel and the full History tab.
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { DATABASE_KINDS, type HistoryEntry, type SavedQuery } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { confirmDialog, promptDialog } from "../connections/dialogs";
import { openQuery } from "../connections/openers";

export function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

export function absoluteTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** One-line preview of a (possibly multi-line) query. */
export function firstLine(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

export const connectionName = (id?: string | null) =>
  (id && useConnections.getState().byId(id)?.name) || (id ? "Deleted connection" : "No connection");

function fallbackConnection(): string | null {
  const c = useConnections.getState().connections.find((c) => DATABASE_KINDS.includes(c.kind));
  return c?.id ?? null;
}

export function openHistoryEntry(e: HistoryEntry) {
  const exists = useConnections.getState().byId(e.connectionId);
  const connId = exists ? e.connectionId : fallbackConnection();
  if (!connId) { toast.error("The connection for this query no longer exists"); return; }
  if (!exists) toast.message(`Original connection was removed — opened on ${connectionName(connId)}`);
  openQuery(connId, { database: exists ? e.database : null, initialSql: e.query });
}

export function openSavedQuery(q: SavedQuery) {
  const exists = q.connectionId ? useConnections.getState().byId(q.connectionId) : undefined;
  const connId = exists ? q.connectionId! : fallbackConnection();
  if (!connId) { toast.error("Add a database connection to open this query"); return; }
  openQuery(connId, { database: exists ? q.database : null, initialSql: q.query, savedQueryId: q.id, title: q.name });
}

export async function copyText(text: string, what = "SQL") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
}

export async function renameSavedQuery(q: SavedQuery): Promise<boolean> {
  const name = await promptDialog({ title: "Rename saved query", label: "Name", defaultValue: q.name, confirmLabel: "Rename" });
  if (!name || name === q.name) return false;
  try {
    await api.saveQuery({ ...q, name });
    return true;
  } catch (e) {
    toast.error(`Rename failed: ${errMsg(e)}`);
    return false;
  }
}

export async function deleteSavedQuery(q: SavedQuery): Promise<boolean> {
  const ok = await confirmDialog({ title: "Delete saved query", message: <>Delete <b>{q.name}</b>? This cannot be undone.</>, confirmLabel: "Delete", danger: true });
  if (!ok) return false;
  try {
    await api.deleteSavedQuery(q.id);
    toast.success(`Deleted ${q.name}`);
    return true;
  } catch (e) {
    toast.error(`Delete failed: ${errMsg(e)}`);
    return false;
  }
}

export async function clearHistory(): Promise<boolean> {
  const ok = await confirmDialog({ title: "Clear history", message: "Remove every entry from the query history? Saved queries are kept.", confirmLabel: "Clear all", danger: true });
  if (!ok) return false;
  try {
    await api.historyClear();
    toast.success("History cleared");
    return true;
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
}
