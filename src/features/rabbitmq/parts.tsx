// Shared building blocks for the RabbitMQ console.
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { Component, useMemo, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Dialog, IconButton, Spinner } from "../../components/ui";
import { fmtTime } from "./format";

// ---------------------------------------------------------------------------
// Data table (virtualized, sortable)

export interface Col<T> {
  id: string;
  header: string;
  width: number;
  align?: "left" | "right" | "center";
  /** Sort key passed to the API (dotted path); omit for unsortable columns. */
  sort?: string;
  render: (row: T) => ReactNode;
  title?: (row: T) => string;
}

export interface SortState { key: string; desc: boolean }

export function DataTable<T>({ rows, cols, rowKey, onRowClick, selectedKey, sort, onSort, empty, loading }: {
  rows: T[];
  cols: Col<T>[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  selectedKey?: string | null;
  sort?: SortState | null;
  onSort?: (s: SortState) => void;
  empty?: ReactNode;
  loading?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 26, overscan: 12 });
  const template = cols.map((c, i) => (i === cols.length - 1 ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(" ");
  const minWidth = cols.reduce((s, c) => s + c.width, 0);

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
      <div style={{ minWidth }}>
        <div className="sticky top-0 z-10 grid h-7 items-center border-b border-line bg-raised text-[11px] font-medium uppercase tracking-wide text-muted" style={{ gridTemplateColumns: template }}>
          {cols.map((c) => {
            const active = sort && c.sort && sort.key === c.sort;
            return (
              <div
                key={c.id}
                className={clsx(
                  "flex items-center gap-1 truncate px-2",
                  c.align === "right" && "justify-end",
                  c.align === "center" && "justify-center",
                  c.sort && onSort && "cursor-pointer hover:text-fg",
                  active && "text-fg",
                )}
                onClick={() => c.sort && onSort?.({ key: c.sort, desc: active ? !sort!.desc : c.align === "right" })}
              >
                {c.header}
                {active && (sort!.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
              </div>
            );
          })}
        </div>
        {rows.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted">{loading ? <Spinner /> : empty ?? "Nothing here"}</div>
        ) : (
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((vi) => {
              const r = rows[vi.index];
              const k = rowKey(r);
              return (
                <div
                  key={k}
                  className={clsx(
                    "absolute left-0 right-0 grid h-[26px] items-center border-b border-line/50 text-xs",
                    onRowClick && "cursor-pointer",
                    selectedKey === k ? "bg-accent/10" : "hover:bg-hover/60",
                  )}
                  style={{ gridTemplateColumns: template, transform: `translateY(${vi.start}px)` }}
                  onClick={() => onRowClick?.(r)}
                >
                  {cols.map((c) => (
                    <div
                      key={c.id}
                      title={c.title?.(r)}
                      className={clsx(
                        "truncate px-2",
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center",
                      )}
                    >
                      {c.render(r)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function Pager({ page, pageCount, filtered, total, onPage, loading }: {
  page: number; pageCount: number; filtered: number; total: number; onPage: (p: number) => void; loading?: boolean;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-panel px-2 text-[11px] text-muted">
      <span>
        {filtered.toLocaleString()} {filtered !== total && <>of {total.toLocaleString()} </>}items
      </span>
      {loading && <Spinner className="size-3" />}
      <div className="flex-1" />
      <IconButton title="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-3.5" /></IconButton>
      <span className="tabular-nums">Page {page} / {Math.max(1, pageCount)}</span>
      <IconButton title="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}><ChevronRight className="size-3.5" /></IconButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status / feedback

/** Keeps a crashing view from blanking the whole tab. */
export class ViewBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: string | null; key: string }> {
  state = { error: null as string | null, key: this.props.resetKey };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { key: string }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null;
  }
  render() {
    if (this.state.error) {
      return <ErrorBanner error={`This view crashed: ${this.state.error}`} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

export function ErrorBanner({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="selectable flex items-start gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words font-mono">{error}</div>
      {onRetry && <Button size="sm" variant="danger" onClick={onRetry}><RefreshCw className="size-3" />Retry</Button>}
    </div>
  );
}

export function Confirm({ open, title, children, confirmLabel = "Confirm", danger = true, onConfirm, onClose }: {
  open: boolean; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => Promise<unknown> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try { await onConfirm(); onClose(); } catch { /* caller toasts */ } finally { setBusy(false); }
          }}
        >{confirmLabel}</Button>
      </>}
    >
      <div className="text-[13px] leading-relaxed text-fg/90">{children}</div>
    </Dialog>
  );
}

export function QueueTypeBadge({ type }: { type?: string }) {
  const t = type ?? "classic";
  return <Badge tone={t === "quorum" ? "info" : t === "stream" ? "accent" : "default"}>{t}</Badge>;
}

export function StateDot({ state }: { state?: string }) {
  const s = state ?? "unknown";
  const tone = s === "running" ? "bg-ok" : s === "idle" ? "bg-faint" : s === "flow" || s === "blocked" || s === "blocking" ? "bg-warn" : "bg-danger";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx("size-1.5 rounded-full", tone)} />
      <span className="text-muted">{s}</span>
    </span>
  );
}

/** Small D / AD / Excl / Args feature chips like the management UI. */
export function Features({ durable, autoDelete, exclusive, internal, args }: {
  durable?: boolean; autoDelete?: boolean; exclusive?: boolean; internal?: boolean; args?: Record<string, unknown>;
}) {
  const n = args ? Object.keys(args).filter((k) => k !== "x-queue-type").length : 0;
  const chip = "rounded border border-line px-1 text-[10px] leading-4 text-muted";
  return (
    <span className="inline-flex gap-1">
      {durable && <span className={chip} title="Durable">D</span>}
      {autoDelete && <span className={chip} title="Auto-delete">AD</span>}
      {exclusive && <span className={chip} title="Exclusive">Excl</span>}
      {internal && <span className={chip} title="Internal">I</span>}
      {n > 0 && <span className={clsx(chip, "text-info")} title={Object.entries(args!).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}>Args {n}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cards, bars, key-value tables

export function StatCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "danger" }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-panel px-3 py-2">
      <div className="truncate text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx("mt-0.5 truncate text-xl font-semibold tabular-nums", tone === "warn" && "text-warn", tone === "danger" && "text-danger")}>{value}</div>
      {sub && <div className="truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/** Usage bar; tone escalates at 75% / 90% or on an alarm. */
export function UsageBar({ label, used, total, fmt, alarm, text }: {
  label: string; used?: number; total?: number; fmt: (n: number) => string; alarm?: boolean;
  /** Replaces the default "used / total" readout. */
  text?: string;
}) {
  const pct = used != null && total ? Math.min(100, (used / total) * 100) : 0;
  const tone = alarm || pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warn" : "bg-ok";
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className={clsx("text-muted", alarm && "font-medium text-danger")}>{label}{alarm && " · ALARM"}</span>
        <span className="truncate tabular-nums text-fg/80">
          {text ?? <>{used != null ? fmt(used) : "–"}{total ? ` / ${fmt(total)}` : ""}</>}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-hover">
        <div className={clsx("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="selectable grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <div className="text-muted">{k}</div>
          <div className="min-w-0 break-words font-mono text-fg/90">{v ?? "–"}</div>
        </div>
      ))}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-md border border-line bg-panel", className)}>
      <div className="flex h-8 items-center gap-2 border-b border-line px-3">
        <div className="text-xs font-semibold text-fg/90">{title}</div>
        <div className="flex-1" />
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** Right-hand detail panel with a header, actions and a tab strip. */
export function DetailPanel<K extends string>({ title, badges, actions, tabs, tab, onTab, onClose, children }: {
  title: ReactNode; badges?: ReactNode; actions?: ReactNode;
  tabs: { id: K; label: ReactNode }[]; tab: K; onTab: (t: K) => void;
  onClose: () => void; children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-[min(680px,58%)] min-w-[420px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex min-h-10 items-center gap-2 border-b border-line px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="selectable truncate font-mono text-[13px] font-semibold" title={typeof title === "string" ? title : undefined}>{title}</div>
          {badges && <div className="mt-0.5 flex flex-wrap items-center gap-1">{badges}</div>}
        </div>
        {actions}
        <IconButton title="Close" onClick={onClose}><X className="size-4" /></IconButton>
      </div>
      <div className="flex h-8 shrink-0 items-end gap-0.5 border-b border-line px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={clsx(
              "-mb-px h-7 rounded-t px-2.5 text-xs",
              t.id === tab ? "border border-b-0 border-line bg-app text-fg" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-app p-3">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time series

/** Fixed categorical order, validated for CVD separation on the panel surface. */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"] as const;

export interface SeriesDef { key: string; label: string; color: string; dashed?: boolean }
export type Point = { t: number } & Record<string, number>;

const WINDOW_MS = 10 * 60 * 1000;

/**
 * Merge management-API samples (10s resolution, keyed by server timestamp) with
 * live values recorded at each poll. Live points newer than the latest sample fill
 * the gap between sample boundaries; once a sample covers them they are dropped.
 */
export function useTimeSeries(
  resetKey: string,
  input: { at: number; sampled: Record<string, Map<number, number>>; live: Record<string, number> } | null,
): Point[] {
  // Internal maps are private: recharts freezes the point objects it is given,
  // so every render hands out fresh copies.
  type Vals = Record<string, number>;
  const store = useRef<{ key: string; sampled: Map<number, Vals>; live: Map<number, Vals> }>({ key: resetKey, sampled: new Map(), live: new Map() });
  return useMemo(() => {
    const s = store.current;
    if (s.key !== resetKey) { s.key = resetKey; s.sampled.clear(); s.live.clear(); }
    if (!input) return [];
    let newest = 0;
    for (const [k, m] of Object.entries(input.sampled)) {
      for (const [t, v] of m) {
        newest = Math.max(newest, t);
        const p = s.sampled.get(t) ?? {};
        p[k] = v;
        s.sampled.set(t, p);
      }
    }
    for (const t of [...s.live.keys()]) if (t <= newest) s.live.delete(t);
    if (input.at > newest + 1000) s.live.set(input.at, { ...input.live });
    const cutoff = input.at - WINDOW_MS;
    for (const m of [s.sampled, s.live]) for (const t of [...m.keys()]) if (t < cutoff) m.delete(t);
    return [...s.sampled, ...s.live]
      .map(([t, v]) => ({ ...v, t }) as Point)
      .sort((a, b) => a.t - b.t);
  }, [resetKey, input]);
}

export function TimeChart({ data, series, fmt, height = 180, empty = "Collecting samples…" }: {
  data: Point[]; series: SeriesDef[]; fmt: (v: number) => string; height?: number; empty?: string;
}) {
  if (data.length < 2) {
    return <div className="flex items-center justify-center text-xs text-faint" style={{ height }}>{empty}</div>;
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            stroke="var(--color-faint)" tick={{ fontSize: 10, fill: "var(--color-muted)" }} tickLine={false} axisLine={{ stroke: "var(--color-line)" }}
            minTickGap={40}
          />
          <YAxis
            width={48} tickFormatter={(v: number) => fmt(v)} allowDecimals
            stroke="var(--color-faint)" tick={{ fontSize: 10, fill: "var(--color-muted)" }} tickLine={false} axisLine={false}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }}
            contentStyle={{ background: "var(--color-raised)", border: "1px solid var(--color-line)", borderRadius: 6, fontSize: 11, color: "var(--color-fg)" }}
            labelStyle={{ color: "var(--color-muted)", marginBottom: 2 }}
            itemStyle={{ color: "var(--color-fg)", padding: 0 }}
            labelFormatter={(t) => fmtTime(Number(t))}
            formatter={(v, name) => [fmt(Number(v)), String(name)]}
          />
          <Legend
            iconType="plainline" iconSize={12} verticalAlign="top" align="right" height={20} itemSorter={null}
            wrapperStyle={{ fontSize: 11 }}
            formatter={(v) => <span style={{ color: "var(--color-muted)" }}>{v}</span>}
          />
          {series.map((s) => (
            <Line
              key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              dot={false} activeDot={{ r: 4, stroke: "var(--color-panel)", strokeWidth: 2 }}
              isAnimationActive={false} connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
