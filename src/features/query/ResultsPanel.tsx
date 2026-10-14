// Bottom panel of the query tab: one grid per result set plus a Messages log.
import { save } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Download, MessageSquareText, Table2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Empty, Spinner } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { Dialect, QueryResult } from "../../lib/types";
import DataGrid from "../grid/DataGrid";

export interface RunMessage {
  statement: string;
  ok: boolean;
  elapsedMs: number;
  rows?: number;
  rowsAffected?: number | null;
  truncated?: boolean;
  message?: string | null;
  error?: string;
}

export interface RunState {
  id: number;
  results: QueryResult[];
  messages: RunMessage[];
  error?: string;
  totalMs: number;
}

interface Props {
  run: RunState | null;
  running: boolean;
  startedAt: number | null;
  connId: string;
  database: string | null;
  dialect: Dialect;
}

export default function ResultsPanel({ run, running, startedAt, connId, database, dialect }: Props) {
  const grids = run?.results.filter((r) => r.columns.length > 0) ?? [];
  const [active, setActive] = useState<number | "messages">(0);

  useEffect(() => {
    if (!run) return;
    setActive(run.error || !run.results.some((r) => r.columns.length) ? "messages" : 0);
  }, [run]);

  const current = active === "messages" ? null : grids[active] ?? null;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-8 shrink-0 items-stretch gap-px overflow-x-auto border-b border-line bg-app text-xs">
        {grids.map((r, i) => (
          <TabBtn key={i} active={active === i} onClick={() => setActive(i)}>
            <Table2 className="size-3.5 text-info" />
            Result {grids.length > 1 ? i + 1 : ""}
            <span className="text-faint">{r.rows.length.toLocaleString()}{r.truncated ? "+" : ""}</span>
          </TabBtn>
        ))}
        <TabBtn active={active === "messages" || (!grids.length && !!run)} onClick={() => setActive("messages")}>
          <MessageSquareText className="size-3.5" />
          Messages
          {run?.error && <XCircle className="size-3.5 text-danger" />}
        </TabBtn>
        <div className="flex-1" />
        {running && startedAt && <RunningTimer startedAt={startedAt} />}
        {!running && run && (
          <span className="flex items-center px-3 text-[11px] text-muted">
            {run.error ? "Failed" : `${run.results.length} statement${run.results.length === 1 ? "" : "s"}`} · {fmtMs(run.totalMs)}
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {!run && !running && (
          <Empty title="No results yet">
            Run a statement with <Kbd>⌘↵</Kbd>, or the whole script with <Kbd>⌘⇧↵</Kbd>.
          </Empty>
        )}
        {!run && running && <div className="flex h-full items-center justify-center"><Spinner /></div>}
        {run && current && (
          <DataGrid
            key={`${run.id}:${active}`}
            columns={current.columns}
            rows={current.rows}
            dialect={dialect}
            footer={<ResultFooter result={current} connId={connId} database={database} />}
          />
        )}
        {run && !current && <MessagesView run={run} />}
        {running && run && (
          <div className="pointer-events-none absolute inset-0 bg-panel/40" />
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex shrink-0 items-center gap-1.5 px-3",
        active ? "bg-panel text-fg shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function ResultFooter({ result, connId, database }: { result: QueryResult; connId: string; database: string | null }) {
  const [busy, setBusy] = useState(false);
  const exportResult = async () => {
    const path = await save({
      defaultPath: "result.csv",
      filters: [
        { name: "CSV", extensions: ["csv"] },
        { name: "JSON", extensions: ["json"] },
        { name: "SQL INSERT", extensions: ["sql"] },
        { name: "Excel", extensions: ["xlsx"] },
      ],
    });
    if (!path) return;
    const ext = path.split(".").pop()?.toLowerCase();
    const format = ext === "json" || ext === "sql" || ext === "xlsx" ? ext : "csv";
    setBusy(true);
    try {
      const n = await api.exportData({ connId, query: result.statement, database, format, path });
      toast.success(`Exported ${n.toLocaleString()} rows`, { description: path });
    } catch (e) {
      toast.error("Export failed", { description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-3">
      {result.truncated && (
        <span className="flex items-center gap-1 text-warn" title="Rows were capped by the max rows setting">
          <AlertTriangle className="size-3" /> truncated
        </span>
      )}
      <span className="tabular-nums">{fmtMs(result.elapsedMs)}</span>
      <Button size="sm" variant="ghost" className="h-5" onClick={exportResult} loading={busy} title="Export the full result (re-runs the query)">
        <Download className="size-3" /> Export
      </Button>
    </span>
  );
}

function MessagesView({ run }: { run: RunState }) {
  return (
    <div className="selectable h-full overflow-auto p-2 font-mono text-xs">
      {run.messages.map((m, i) => (
        <div key={i} className="flex gap-2 border-b border-line/50 px-1 py-1.5">
          {m.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-ok" /> : <XCircle className="mt-px size-3.5 shrink-0 text-danger" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-fg/90" title={m.statement}>{m.statement.replace(/\s+/g, " ")}</div>
            <div className={clsx("mt-0.5 whitespace-pre-wrap", m.ok ? "text-muted" : "text-danger")}>
              {m.ok ? describe(m) : m.error}
            </div>
            {m.ok && m.message && <div className="mt-0.5 whitespace-pre-wrap text-info">{m.message}</div>}
          </div>
          <span className="shrink-0 text-faint tabular-nums">{fmtMs(m.elapsedMs)}</span>
        </div>
      ))}
    </div>
  );
}

function describe(m: RunMessage): string {
  const parts: string[] = [];
  if (m.rows !== undefined) parts.push(`${m.rows.toLocaleString()} row${m.rows === 1 ? "" : "s"} returned${m.truncated ? " (truncated)" : ""}`);
  if (m.rowsAffected != null) parts.push(`${m.rowsAffected.toLocaleString()} row${m.rowsAffected === 1 ? "" : "s"} affected`);
  if (!parts.length) parts.push("OK");
  return parts.join(" · ");
}

function RunningTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="flex items-center gap-1.5 px-3 text-[11px] text-accent">
      <Spinner className="size-3 text-accent" /> Running… {fmtMs(now - startedAt)}
    </span>
  );
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-raised px-1 font-mono text-[10px] text-fg">{children}</kbd>;
}
