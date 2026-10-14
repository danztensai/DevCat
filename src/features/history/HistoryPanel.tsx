// Sidebar: saved queries (collapsible) + recent query history.
import clsx from "clsx";
import { ChevronDown, ChevronRight, CircleCheck, CircleX, Copy, FileCode2, Maximize2, Pencil, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { IconButton, Spinner } from "../../components/ui";
import type { HistoryEntry, SavedQuery } from "../../lib/types";
import { inFocus, useConnections } from "../../store/connections";
import { useContextMenu, type MenuItem } from "../connections/ContextMenu";
import { openHistoryTab } from "../connections/openers";
import {
  connectionName, copyText, deleteSavedQuery, firstLine, formatDuration, openHistoryEntry, openSavedQuery, relativeTime, renameSavedQuery,
} from "./historyActions";
import { useHistoryData } from "./useHistoryData";

const SAVED_OPEN_KEY = "devcat.history.savedOpen";

export default function HistoryPanel() {
  const [search, setSearch] = useState("");
  const { history: allHistory, saved: allSaved, loading, error, refresh } = useHistoryData({ search, limit: 300 });
  // Focus mode: only show entries for the focused project's connections.
  const focus = useConnections((s) => s.focusProjectId);
  const history = useMemo(() => allHistory.filter((e) => inFocus(e.connectionId)), [allHistory, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = useMemo(() => allSaved.filter((q) => inFocus(q.connectionId)), [allSaved, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const [savedOpen, setSavedOpen] = useState(() => localStorage.getItem(SAVED_OPEN_KEY) !== "0");
  const menu = useContextMenu();
  useConnections((s) => s.connections); // re-render when connection names change
  useNow(60_000);

  const toggleSaved = () => {
    setSavedOpen((v) => {
      localStorage.setItem(SAVED_OPEN_KEY, v ? "0" : "1");
      return !v;
    });
  };

  const savedFiltered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return saved;
    return saved.filter((q) => q.name.toLowerCase().includes(s) || q.query.toLowerCase().includes(s));
  }, [saved, search]);

  const savedMenu = (q: SavedQuery): MenuItem[] => [
    { label: "Open", icon: <Play className="size-3.5" />, onClick: () => openSavedQuery(q) },
    { label: "Rename…", icon: <Pencil className="size-3.5" />, onClick: async () => { if (await renameSavedQuery(q)) refresh(); } },
    { label: "Copy SQL", icon: <Copy className="size-3.5" />, onClick: () => copyText(q.query) },
    "separator",
    { label: "Delete", icon: <Trash2 className="size-3.5" />, danger: true, onClick: async () => { if (await deleteSavedQuery(q)) refresh(); } },
  ];
  const historyMenu = (e: HistoryEntry): MenuItem[] => [
    { label: "Open in new query", icon: <Play className="size-3.5" />, onClick: () => openHistoryEntry(e) },
    { label: "Copy SQL", icon: <Copy className="size-3.5" />, onClick: () => copyText(e.query) },
    ...(e.error ? [{ label: "Copy error", icon: <Copy className="size-3.5" />, onClick: () => copyText(e.error!, "error") }] : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearch("")}
            placeholder="Search queries"
            spellCheck={false}
            className="h-6 w-full rounded border border-line bg-app pr-2 pl-7 text-xs text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
        <IconButton title="Refresh" onClick={refresh}>
          {loading ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
        </IconButton>
        <IconButton title="Open full history" onClick={openHistoryTab}><Maximize2 className="size-3.5" /></IconButton>
      </div>

      {error && <div className="selectable border-b border-line bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

      <SectionHeader open={savedOpen} onToggle={toggleSaved} label="Saved queries" count={savedFiltered.length} />
      {savedOpen && (
        <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-line py-0.5">
          {savedFiltered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-faint">{search ? "No matching saved queries." : "Save a query from the editor to keep it here."}</div>
          ) : savedFiltered.map((q) => (
            <button
              key={q.id}
              onClick={() => openSavedQuery(q)}
              onContextMenu={(e) => menu.show(e, savedMenu(q))}
              title={q.query.slice(0, 600)}
              className="flex h-7 w-full items-center gap-2 px-3 text-left hover:bg-hover"
            >
              <FileCode2 className="size-3.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{q.name}</span>
              <span className="max-w-[40%] shrink-0 truncate text-[11px] text-faint">{q.connectionId ? connectionName(q.connectionId) : ""}</span>
            </button>
          ))}
        </div>
      )}

      <SectionHeader label="History" count={history.length} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {history.length === 0 && !loading ? (
          <div className="px-3 py-2 text-xs text-faint">{search ? "No matching queries." : "Queries you run will appear here."}</div>
        ) : history.map((e) => (
          <button
            key={e.id}
            onClick={() => openHistoryEntry(e)}
            onContextMenu={(ev) => menu.show(ev, historyMenu(e))}
            title={(e.error ? `Error: ${e.error}\n\n` : "") + e.query.slice(0, 600)}
            className="group flex w-full flex-col gap-0.5 border-b border-line/40 px-3 py-1.5 text-left hover:bg-hover"
          >
            <span className="flex w-full items-center gap-1.5">
              {e.success
                ? <CircleCheck className="size-3 shrink-0 text-ok" />
                : <CircleX className="size-3 shrink-0 text-danger" />}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg/90">{firstLine(e.query)}</span>
            </span>
            <span className="flex w-full items-center gap-1.5 pl-[18px] text-[11px] text-faint">
              <span className="min-w-0 truncate">{connectionName(e.connectionId)}{e.database ? ` · ${e.database}` : ""}</span>
              <span className="ml-auto shrink-0">{relativeTime(e.executedAt)}</span>
              <span className="shrink-0 tabular-nums">· {formatDuration(e.elapsedMs)}</span>
            </span>
          </button>
        ))}
      </div>
      {menu.element}
    </div>
  );
}

function SectionHeader({ label, count, open, onToggle }: { label: string; count: number; open?: boolean; onToggle?: () => void }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!onToggle}
      className={clsx(
        "flex h-7 w-full shrink-0 items-center gap-1 border-b border-line bg-app/40 px-2 text-left text-[11px] font-semibold tracking-wider text-muted uppercase",
        onToggle && "hover:text-fg",
      )}
    >
      {onToggle ? <Chevron className="size-3.5" /> : <span className="w-3.5" />}
      <span className="flex-1">{label}</span>
      <span className="font-normal tabular-nums text-faint">{count}</span>
    </button>
  );
}

/** Re-render periodically so relative timestamps stay fresh. */
export function useNow(intervalMs: number) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
