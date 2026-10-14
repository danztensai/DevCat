import { DiffEditor } from "@monaco-editor/react";
import clsx from "clsx";
import { ArrowRight, CheckSquare, Eye, GitCompareArrows, KeyRound, Link2, ListTree, Minus, Plus, Search, Square, Table2, Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Badge, Empty, Input } from "../../components/ui";
import type { ColumnDef } from "../../lib/types";
import type { ColumnDiff, FkDiff, IndexDiff, SchemaDiff, TableDiff, TableStatus, ViewDiff } from "./diff";
import { diffSummary } from "./diff";
import { ScriptPanel } from "./ScriptPanel";
import type { SqlDialect } from "./sqlDialect";
import { generateSyncSql } from "./syncSql";
import type { Target } from "../transfer/shared";

export interface StructureOptions { dropColumns: boolean }

const STATUS_META: Record<TableStatus, { label: string; short: string; cls: string; tone: "ok" | "danger" | "warn" | "default" }> = {
  onlySource: { label: "Only in source", short: "create", cls: "text-ok", tone: "ok" },
  onlyTarget: { label: "Only in target", short: "drop", cls: "text-danger", tone: "danger" },
  different: { label: "Different", short: "alter", cls: "text-warn", tone: "warn" },
  identical: { label: "Identical", short: "same", cls: "text-faint", tone: "default" },
};

function StatusIcon({ s, className }: { s: TableStatus | ColumnDiff["status"]; className?: string }) {
  const c = clsx("size-3.5 shrink-0", className);
  switch (s) {
    case "onlySource": return <Plus className={clsx(c, "text-ok")} />;
    case "onlyTarget": return <Minus className={clsx(c, "text-danger")} />;
    case "different": case "changed": return <Pencil className={clsx(c, "text-warn")} />;
    default: return <span className={clsx(c, "inline-block")} />;
  }
}

export function StructureCompare({ diff, source, target, sourceDialect, targetDialect, sourceLabel, targetLabel, options }: {
  diff: SchemaDiff;
  source: Target;
  target: Target;
  sourceDialect: SqlDialect;
  targetDialect: SqlDialect;
  sourceLabel: string;
  targetLabel: string;
  options: StructureOptions;
}) {
  const summary = useMemo(() => diffSummary(diff), [diff]);
  const [filters, setFilters] = useState<Record<TableStatus, boolean>>({ onlySource: true, onlyTarget: true, different: true, identical: false });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);

  // Default selection: everything that would create/alter. Drops are opt-in.
  useEffect(() => {
    const all = [...diff.tables, ...diff.views];
    setSelected(new Set(all.filter((x) => x.status === "onlySource" || x.status === "different").map((x) => x.id)));
    setActive(all.find((x) => x.status !== "identical")?.id ?? null);
  }, [diff]);

  const visible = useCallback(<T extends { status: TableStatus; name: string }>(xs: T[]) =>
    xs.filter((x) => filters[x.status] && x.name.toLowerCase().includes(search.toLowerCase())), [filters, search]);
  const tables = visible(diff.tables);
  const views = visible(diff.views);

  // Script (auto-regenerated unless hand-edited)
  const generate = useCallback(() => generateSyncSql(diff, {
    sourceDialect, targetDialect,
    sourceSchema: source.schema, targetSchema: target.schema,
    selected, dropExtra: true, dropColumns: options.dropColumns,
    header: `DevCat schema sync\nSource: ${sourceLabel}\nTarget: ${targetLabel}\nGenerated: ${new Date().toISOString()}`,
  }), [diff, sourceDialect, targetDialect, source.schema, target.schema, selected, options.dropColumns, sourceLabel, targetLabel]);
  const [script, setScript] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setScript(generate()); }, [generate, dirty]);

  const toggle = (id: string, on: boolean) => {
    const s = new Set(selected);
    if (on) s.add(id); else s.delete(id);
    setSelected(s);
  };
  const shownIds = [...tables, ...views].filter((x) => x.status !== "identical").map((x) => x.id);
  const allOn = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const toggleAll = () => {
    const s = new Set(selected);
    shownIds.forEach((id) => (allOn ? s.delete(id) : s.add(id)));
    setSelected(s);
  };

  const activeTable = diff.tables.find((t) => t.id === active);
  const activeView = diff.views.find((v) => v.id === active);

  return (
    <Group orientation="vertical" className="min-h-0 flex-1">
      <Panel defaultSize="58%" minSize="20%">
        <Group orientation="horizontal" className="h-full">
          <Panel defaultSize="32%" minSize="18%">
            <div className="flex h-full flex-col bg-panel">
              <div className="flex flex-wrap items-center gap-1 border-b border-line p-1.5">
                {(Object.keys(STATUS_META) as TableStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilters((f) => ({ ...f, [s]: !f[s] }))}
                    className={clsx(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] border",
                      filters[s] ? "border-line bg-hover text-fg" : "border-transparent text-faint hover:text-muted",
                    )}
                    title={`${filters[s] ? "Hide" : "Show"} ${STATUS_META[s].label.toLowerCase()}`}
                  >
                    <StatusIcon s={s} className="size-3" />
                    {STATUS_META[s].label}
                    <span className={clsx("font-mono", STATUS_META[s].cls)}>{summary[s]}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 border-b border-line px-1.5 py-1">
                <button onClick={toggleAll} className="flex size-6 items-center justify-center text-muted hover:text-fg" title={allOn ? "Deselect all" : "Select all"}>
                  {allOn ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />}
                </button>
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1.5 size-3.5 text-faint" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter objects" className="h-6 border-none bg-transparent pl-7 text-xs" />
                </div>
                <span className="px-1 text-[11px] text-faint">{selected.size} selected</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto py-1">
                {!tables.length && !views.length && <div className="p-4 text-center text-xs text-faint">No objects match the current filters.</div>}
                {tables.length > 0 && <SectionHeader icon={<Table2 className="size-3.5" />} label="Tables" count={tables.length} />}
                {tables.map((t) => (
                  <ItemRow key={t.id} item={t} active={active === t.id} checked={selected.has(t.id)} onToggle={toggle} onClick={() => setActive(t.id)} detail={tableBrief(t)} />
                ))}
                {views.length > 0 && <SectionHeader icon={<Eye className="size-3.5" />} label="Views" count={views.length} />}
                {views.map((v) => (
                  <ItemRow key={v.id} item={v} active={active === v.id} checked={selected.has(v.id)} onToggle={toggle} onClick={() => setActive(v.id)} />
                ))}
              </div>
            </div>
          </Panel>
          <Separator className="w-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
          <Panel minSize="30%">
            <div className="h-full overflow-auto bg-app">
              {activeTable ? <TableDetail t={activeTable} sourceLabel={sourceLabel} targetLabel={targetLabel} />
                : activeView ? <ViewDetail v={activeView} sourceLabel={sourceLabel} targetLabel={targetLabel} />
                  : <Empty icon={<ListTree className="size-8" />} title="Select an object">Pick a table or view on the left to see its differences.</Empty>}
            </div>
          </Panel>
        </Group>
      </Panel>
      <Separator className="h-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
      <Panel minSize="15%">
        <ScriptPanel
          script={script}
          onChange={(s) => { setScript(s); setDirty(true); }}
          dirty={dirty}
          onRegenerate={() => { setDirty(false); setScript(generate()); }}
          target={target}
          fileName={`sync-${target.database ?? "target"}${target.schema ? "-" + target.schema : ""}.sql`}
        />
      </Panel>
    </Group>
  );
}

function tableBrief(t: TableDiff) {
  if (t.status !== "different") return null;
  const add = t.columns.filter((c) => c.status === "onlySource").length;
  const del = t.columns.filter((c) => c.status === "onlyTarget").length;
  const ch = t.columns.filter((c) => c.status === "changed").length;
  const idx = t.indexes.filter((i) => i.status !== "same").length;
  const fk = t.foreignKeys.filter((f) => f.status !== "same").length;
  return (
    <span className="flex gap-1.5 font-mono text-[10.5px]">
      {add > 0 && <span className="text-ok">+{add}</span>}
      {del > 0 && <span className="text-danger">−{del}</span>}
      {ch > 0 && <span className="text-warn">~{ch}</span>}
      {idx > 0 && <span className="text-info">{idx} idx</span>}
      {fk > 0 && <span className="text-info">{fk} fk</span>}
      {t.pkChanged && <span className="text-warn">pk</span>}
    </span>
  );
}

function SectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
      {icon}{label}<span className="font-normal text-faint">{count}</span>
    </div>
  );
}

function ItemRow({ item, active, checked, onToggle, onClick, detail }: {
  item: TableDiff | ViewDiff; active: boolean; checked: boolean; onToggle: (id: string, on: boolean) => void; onClick: () => void; detail?: React.ReactNode;
}) {
  const disabled = item.status === "identical";
  return (
    <div
      onClick={onClick}
      className={clsx("flex h-6 cursor-pointer items-center gap-1.5 px-2 text-[13px]", active ? "bg-accent/15 text-fg" : "hover:bg-hover")}
    >
      <input
        type="checkbox"
        className="accent-[var(--color-accent)]"
        checked={checked && !disabled}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onToggle(item.id, e.target.checked)}
      />
      <StatusIcon s={item.status} />
      <span className={clsx("min-w-0 flex-1 truncate", disabled && "text-muted")}>{item.name}</span>
      {detail}
      <span className={clsx("shrink-0 text-[10.5px]", STATUS_META[item.status].cls)}>{STATUS_META[item.status].short}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail views

function colCells(c: ColumnDef | undefined, changes: string[], side: "s" | "t") {
  if (!c) return <><td colSpan={4} className="px-2 text-faint">—</td></>;
  const hl = (k: string) => (changes.includes(k) ? (side === "s" ? "text-ok font-medium" : "text-danger line-through decoration-danger/50") : "");
  return (
    <>
      <td className={clsx("px-2", hl("pk"))}>
        <span className="inline-flex items-center gap-1">
          {c.isPrimaryKey && <KeyRound className="size-3 text-warn" />}
          {c.name}
        </span>
      </td>
      <td className={clsx("px-2 font-mono text-[11.5px] text-muted", hl("type"), hl("autoIncrement"))}>{c.dataType}{c.autoIncrement ? " ⟳" : ""}</td>
      <td className={clsx("px-2 text-[11.5px] text-muted", hl("nullable"))}>{c.nullable ? "NULL" : "NOT NULL"}</td>
      <td className={clsx("max-w-40 truncate px-2 font-mono text-[11.5px] text-muted", hl("default"))} title={c.default ?? ""}>{c.default ?? ""}</td>
    </>
  );
}

const rowTone = (s: ColumnDiff["status"]) =>
  s === "onlySource" ? "bg-ok/10" : s === "onlyTarget" ? "bg-danger/10" : s === "changed" ? "bg-warn/10" : "";

function TableDetail({ t, sourceLabel, targetLabel }: { t: TableDiff; sourceLabel: string; targetLabel: string }) {
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <Table2 className="size-4 text-accent" />
        <span className="text-[15px] font-semibold">{t.name}</span>
        <Badge tone={STATUS_META[t.status].tone}>{STATUS_META[t.status].label}</Badge>
        {t.pkChanged && <Badge tone="warn">primary key differs</Badge>}
      </div>
      <SideTable title="Columns" sourceLabel={sourceLabel} targetLabel={targetLabel}>
        {t.columns.map((c) => (
          <tr key={c.name} className={clsx("h-6 border-b border-line/40", rowTone(c.status))}>
            {colCells(c.source, c.changes, "s")}
            <td className="w-6 text-center"><StatusIcon s={c.status} className="mx-auto" /></td>
            {colCells(c.target, c.changes, "t")}
          </tr>
        ))}
      </SideTable>
      {t.indexes.length > 0 && (
        <SideTable title="Indexes" sourceLabel={sourceLabel} targetLabel={targetLabel} narrow>
          {t.indexes.map((i) => <IdxRow key={i.name} i={i} />)}
        </SideTable>
      )}
      {t.foreignKeys.length > 0 && (
        <SideTable title="Foreign keys" sourceLabel={sourceLabel} targetLabel={targetLabel} narrow>
          {t.foreignKeys.map((f) => <FkRow key={f.name} f={f} />)}
        </SideTable>
      )}
    </div>
  );
}

function SideTable({ title, sourceLabel, targetLabel, children, narrow }: { title: string; sourceLabel: string; targetLabel: string; children: React.ReactNode; narrow?: boolean }) {
  const span = narrow ? 1 : 4;
  return (
    <div className="mb-4 overflow-hidden rounded-md border border-line">
      <table className="selectable w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-panel text-left text-[11px] text-muted">
            <th colSpan={span} className="px-2 py-1 font-semibold"><span className="uppercase tracking-wider">{title}</span> · source <span className="text-faint">({sourceLabel})</span></th>
            <th className="w-6"><ArrowRight className="mx-auto size-3 text-faint" /></th>
            <th colSpan={span} className="px-2 py-1 font-semibold">target <span className="text-faint">({targetLabel})</span></th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function IdxRow({ i }: { i: IndexDiff }) {
  const cell = (x?: IndexDiff["source"]) => x
    ? <td className="px-2"><span className="font-medium">{x.name}</span> <span className="font-mono text-[11.5px] text-muted">({x.columns.join(", ")}){x.unique ? " UNIQUE" : ""}{x.method ? ` ${x.method}` : ""}</span></td>
    : <td className="px-2 text-faint">—</td>;
  const st = i.status === "same" ? "same" : i.status;
  return (
    <tr className={clsx("h-6 border-b border-line/40", rowTone(st))}>
      {cell(i.source)}
      <td className="w-6"><StatusIcon s={st} className="mx-auto" /></td>
      {cell(i.target)}
    </tr>
  );
}

function FkRow({ f }: { f: FkDiff }) {
  const cell = (x?: FkDiff["source"]) => x
    ? (
      <td className="px-2">
        <span className="inline-flex items-center gap-1"><Link2 className="size-3 text-info" /><span className="font-medium">{x.name}</span></span>{" "}
        <span className="font-mono text-[11.5px] text-muted">
          ({x.columns.join(", ")}) → {x.refTable}({x.refColumns.join(", ")})
          {x.onDelete ? ` ON DELETE ${x.onDelete}` : ""}{x.onUpdate ? ` ON UPDATE ${x.onUpdate}` : ""}
        </span>
      </td>
    )
    : <td className="px-2 text-faint">—</td>;
  return (
    <tr className={clsx("h-6 border-b border-line/40", rowTone(f.status))}>
      {cell(f.source)}
      <td className="w-6"><StatusIcon s={f.status} className="mx-auto" /></td>
      {cell(f.target)}
    </tr>
  );
}

function ViewDetail({ v, sourceLabel, targetLabel }: { v: ViewDiff; sourceLabel: string; targetLabel: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-3 pb-2">
        <Eye className="size-4 text-accent" />
        <span className="text-[15px] font-semibold">{v.name}</span>
        <Badge tone={STATUS_META[v.status].tone}>{STATUS_META[v.status].label}</Badge>
        <div className="flex-1" />
        <span className="flex items-center gap-1 text-[11px] text-faint">{targetLabel}<GitCompareArrows className="size-3" />{sourceLabel}</span>
      </div>
      <div className="min-h-[200px] flex-1 border-t border-line">
        <DiffEditor
          language="sql"
          theme="devcat"
          original={v.targetDef ?? ""}
          modified={v.sourceDef ?? ""}
          options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12, automaticLayout: true, scrollBeyondLastLine: false, wordWrap: "on" }}
        />
      </div>
    </div>
  );
}
