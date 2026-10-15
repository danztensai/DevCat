import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { ArrowDown, ArrowUp, EllipsisVertical } from "lucide-react";
import { useContextMenu, type MenuItem } from "../connections/ContextMenu";
import { useMemo, useRef, useState } from "react";
import type { K8sObject } from "./api";
import { useNow } from "./format";
import type { CellCtx, Column, KindDef } from "./resources";

const ROW_H = 28;

export function matchesSearch(o: K8sObject, def: KindDef, ctx: CellCtx, q: string): boolean {
  if (!q) return true;
  const hay = [o.metadata.name, o.metadata.namespace ?? ""];
  for (const c of def.columns) if (c.search) hay.push(String(c.value(o, ctx)));
  for (const [k, v] of Object.entries(o.metadata.labels ?? {})) hay.push(`${k}=${v}`);
  const s = hay.join("\n").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => s.includes(t));
}

export default function ResourceTable({
  def, items, ctx, search, selectedUid, onSelect, onActivate, hideNamespace, sortDefault, menuFor,
}: {
  def: KindDef;
  items: K8sObject[];
  ctx: Omit<CellCtx, "now">;
  search: string;
  selectedUid?: string | null;
  onSelect: (o: K8sObject) => void;
  /** double click */
  onActivate?: (o: K8sObject) => void;
  hideNamespace?: boolean;
  sortDefault?: { id: string; desc: boolean };
  /** Row actions for the ⋮ button and right-click. */
  menuFor?: (o: K8sObject) => MenuItem[];
}) {
  const menu = useContextMenu();
  const now = useNow();
  const fullCtx: CellCtx = { ...ctx, now };
  const [sort, setSort] = useState<{ id: string; desc: boolean }>(sortDefault ?? (def.key === "events" ? { id: "last", desc: false } : { id: "name", desc: false }));
  const columns = useMemo(() => def.columns.filter((c) => !(hideNamespace && c.id === "namespace")), [def, hideNamespace]);
  const template = columns.map((c) => c.width).join(" ") + (menuFor ? " 24px" : "");

  // Sorting / filtering ignore the ticking clock so rows don't jump every second.
  const metrics = ctx.metrics;
  const rows = useMemo(() => {
    const c: CellCtx = { metrics, now: Date.now() };
    const filtered = items.filter((o) => matchesSearch(o, def, c, search));
    const col: Column | undefined = columns.find((x) => x.id === sort.id) ?? columns[0];
    const keyed = filtered.map((o) => [col.value(o, c), o] as const);
    keyed.sort((a, b) => {
      const [x, y] = [a[0], b[0]];
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return (sort.desc ? -r : r) || a[1].metadata.name.localeCompare(b[1].metadata.name);
    });
    return keyed.map((k) => k[1]);
  }, [items, def, columns, search, sort, metrics]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12 });

  const toggleSort = (id: string) => setSort((s) => (s.id === id ? { id, desc: !s.desc } : { id, desc: false }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth: "100%", width: "max-content" }}>
          <div
            className="sticky top-0 z-10 grid h-7 items-center gap-x-3 border-b border-line bg-panel px-3 text-[11px] font-semibold uppercase tracking-wide text-muted"
            style={{ gridTemplateColumns: template, minWidth: "100%" }}
          >
            {columns.map((c) => (
              <button
                key={c.id}
                onClick={() => toggleSort(c.id)}
                className={clsx("flex min-w-0 items-center gap-1 truncate hover:text-fg", c.align === "right" && "justify-end", sort.id === c.id && "text-fg")}
              >
                <span className="truncate">{c.header}</span>
                {sort.id === c.id && (sort.desc ? <ArrowDown className="size-3 shrink-0" /> : <ArrowUp className="size-3 shrink-0" />)}
              </button>
            ))}
            {menuFor && <span />}
          </div>
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((vr) => {
              const o = rows[vr.index];
              const selected = o.metadata.uid === selectedUid;
              return (
                <div
                  key={o.metadata.uid}
                  onClick={() => onSelect(o)}
                  onDoubleClick={() => onActivate?.(o)}
                  onContextMenu={menuFor ? (e) => { onSelect(o); menu.show(e, menuFor(o)); } : undefined}
                  className={clsx(
                    "absolute left-0 grid w-full cursor-default items-center gap-x-3 border-b border-line/40 px-3 text-[12.5px]",
                    selected ? "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]" : vr.index % 2 ? "bg-app/30 hover:bg-hover" : "hover:bg-hover",
                    o.metadata.deletionTimestamp && "opacity-60",
                  )}
                  style={{ top: vr.start, height: ROW_H, gridTemplateColumns: template }}
                >
                  {columns.map((c) => (
                    <div key={c.id} className={clsx("flex min-w-0 items-center overflow-hidden whitespace-nowrap", c.align === "right" && "justify-end")}>
                      {c.render ? c.render(o, fullCtx) : <span className="truncate">{String(c.value(o, fullCtx))}</span>}
                    </div>
                  ))}
                  {menuFor && (
                    <button
                      title="Actions"
                      aria-label="Actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        menu.show({ clientX: rect.right - 192, clientY: rect.bottom + 2 }, menuFor(o));
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
                    >
                      <EllipsisVertical className="size-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center border-t border-line px-3 text-[11px] text-muted">
        {rows.length === items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : `${rows.length} of ${items.length} items`}
      </div>
      {menu.element}
    </div>
  );
}
