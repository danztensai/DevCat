import clsx from "clsx";
import { AlertTriangle, Database, Play, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Badge, Button, Checkbox, Empty, ErrorBox, Input, Select, Spinner } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { CellValue, TableRef } from "../../lib/types";
import { listTables, useAsync, type Target } from "../transfer/shared";
import { diffRows, generateDataSql, resultToRows, type DataDiff, type Row, type RowDiff } from "./dataDiff";
import { ScriptPanel } from "./ScriptPanel";
import type { SqlDialect } from "./sqlDialect";

const PAGE = 5000;

async function fetchAll(connId: string, table: TableRef, sortCols: string[], cap: number, onProgress: (n: number) => void): Promise<{ rows: Row[]; total?: number | null; capped: boolean }> {
  const rows: Row[] = [];
  let total: number | null | undefined;
  for (let offset = 0; offset < cap; offset += PAGE) {
    const page = await api.tableData(connId, { table, offset, limit: Math.min(PAGE, cap - offset), filter: null, sort: sortCols.map((c) => ({ column: c, desc: false })) });
    if (total === undefined) total = page.total;
    const got = resultToRows(page.result);
    rows.push(...got);
    onProgress(rows.length);
    if (got.length < Math.min(PAGE, cap - offset)) return { rows, total, capped: false };
  }
  return { rows, total, capped: true };
}

export function DataCompare({ source, target, targetDialect }: { source: Target; target: Target; targetDialect: SqlDialect }) {
  const srcTables = useAsync(source.connId ? () => listTables(source.connId, source.database, source.schema) : null, [source.connId, source.database, source.schema]);
  const tgtTables = useAsync(target.connId ? () => listTables(target.connId, target.database, target.schema) : null, [target.connId, target.database, target.schema]);
  const [srcName, setSrcName] = useState("");
  const [tgtName, setTgtName] = useState("");
  const [keyCols, setKeyCols] = useState("");
  const [cap, setCap] = useState(50000);
  const [state, setState] = useState<{ phase: "idle" | "running" | "done" | "error"; msg?: string; srcN?: number; tgtN?: number }>({ phase: "idle" });
  const [diff, setDiff] = useState<DataDiff | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [opts, setOpts] = useState({ inserts: true, updates: true, deletes: false, transaction: true });
  const [view, setView] = useState<"inserts" | "updates" | "deletes">("updates");

  // Auto-match target table name
  useEffect(() => {
    if (!srcName || !tgtTables.data) return;
    const m = tgtTables.data.find((t) => t.name.toLowerCase() === srcName.toLowerCase());
    if (m) setTgtName(m.name);
  }, [srcName, tgtTables.data]);

  // Auto-detect key columns from source structure
  const srcRef = srcTables.data?.find((t) => t.name === srcName);
  const tgtRef = tgtTables.data?.find((t) => t.name === tgtName);
  useEffect(() => {
    if (!srcRef) return;
    let alive = true;
    api.tableStructure(source.connId, fill(srcRef, source)).then((s) => {
      if (alive) setKeyCols(s.columns.filter((c) => c.isPrimaryKey).map((c) => c.name).join(", "));
    }).catch(() => { /* leave as is */ });
    return () => { alive = false; };
  }, [srcRef, source]);

  const run = async () => {
    if (!srcRef || !tgtRef) return;
    const keys = keyCols.split(",").map((s) => s.trim()).filter(Boolean);
    if (!keys.length) {
      setState({ phase: "error", msg: "Key columns are required (the table has no primary key detected). Enter one or more columns that uniquely identify rows." });
      return;
    }
    setDiff(null);
    setState({ phase: "running", srcN: 0, tgtN: 0 });
    try {
      const [ss, ts] = await Promise.all([
        api.tableStructure(source.connId, fill(srcRef, source)),
        api.tableStructure(target.connId, fill(tgtRef, target)),
      ]);
      const tcols = new Set(ts.columns.map((c) => c.name.toLowerCase()));
      const columns = ss.columns.filter((c) => tcols.has(c.name.toLowerCase())).map((c) => c.name);
      const missing = keys.filter((k) => !columns.some((c) => c.toLowerCase() === k.toLowerCase()));
      if (missing.length) throw new Error(`Key column(s) not present in both tables: ${missing.join(", ")}`);
      const [a, b] = await Promise.all([
        fetchAll(source.connId, fill(srcRef, source), keys, cap, (n) => setState((s) => ({ ...s, srcN: n }))),
        fetchAll(target.connId, fill(tgtRef, target), keys, cap, (n) => setState((s) => ({ ...s, tgtN: n }))),
      ]);
      // Align target column names to source casing
      const canon = new Map(columns.map((c) => [c.toLowerCase(), c]));
      const recase = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [canon.get(k.toLowerCase()) ?? k, v])) as Row;
      const d = diffRows(a.rows.map(recase), b.rows.map(recase), keys.map((k) => canon.get(k.toLowerCase()) ?? k), columns);
      const w: string[] = [];
      if (a.capped || b.capped) w.push(`Row cap of ${cap.toLocaleString()} reached — only the first ${cap.toLocaleString()} rows (ordered by key) were compared. Deletes are disabled to avoid false positives.`);
      if (d.duplicateKeys) w.push(`${d.duplicateKeys} duplicate key value(s) found; key columns may not be unique.`);
      const dropped = ss.columns.length - columns.length;
      if (dropped) w.push(`${dropped} source column(s) missing in the target are ignored.`);
      setWarnings(w);
      if (a.capped || b.capped) setOpts((o) => ({ ...o, deletes: false }));
      setDiff(d);
      setView(d.updates.length ? "updates" : d.inserts.length ? "inserts" : "deletes");
      setState({ phase: "done", srcN: a.rows.length, tgtN: b.rows.length });
    } catch (e) {
      setState({ phase: "error", msg: errMsg(e) });
    }
  };

  const capped = warnings.some((w) => w.startsWith("Row cap"));
  const script = useMemo(() => diff && tgtRef ? generateDataSql(diff, {
    dialect: targetDialect, table: tgtRef.name, schema: target.schema ?? tgtRef.schema,
    includeInserts: opts.inserts, includeUpdates: opts.updates, includeDeletes: opts.deletes && !capped, transaction: opts.transaction,
  }) : "", [diff, tgtRef, targetDialect, target.schema, opts, capped]);
  const [edited, setEdited] = useState<string | null>(null);
  useEffect(() => setEdited(null), [script]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b border-line bg-panel px-3 py-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Source table</span>
          <Select value={srcName} onChange={(e) => setSrcName(e.target.value)} className="w-56" disabled={!srcTables.data}>
            <option value="">{srcTables.loading ? "Loading…" : srcTables.error ? "Error loading tables" : "Select table…"}</option>
            {srcTables.data?.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Target table</span>
          <Select value={tgtName} onChange={(e) => setTgtName(e.target.value)} className="w-56" disabled={!tgtTables.data}>
            <option value="">{tgtTables.loading ? "Loading…" : tgtTables.error ? "Error loading tables" : "Select table…"}</option>
            {tgtTables.data?.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Key columns</span>
          <Input value={keyCols} onChange={(e) => setKeyCols(e.target.value)} placeholder="id" className="w-44 font-mono text-xs" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Row cap</span>
          <Input type="number" min={1000} step={10000} value={cap} onChange={(e) => setCap(Math.max(1, Number(e.target.value) || 50000))} className="w-28" />
        </label>
        <Button variant="primary" onClick={run} disabled={!srcRef || !tgtRef} loading={state.phase === "running"}>
          <Play className="size-3.5" />Compare data
        </Button>
        {state.phase === "running" && (
          <span className="flex items-center gap-2 pb-1.5 text-xs text-muted">
            <Spinner className="size-3.5" />source {state.srcN?.toLocaleString()} · target {state.tgtN?.toLocaleString()} rows
          </span>
        )}
      </div>
      {state.phase === "error" && <ErrorBox error={state.msg ?? "Error"} />}
      {!diff && state.phase !== "error" && state.phase !== "running" && (
        <Empty icon={<Database className="size-8" />} title="Compare table data">
          Pick a source and target table with the same key. Rows are matched by key and the differences turned into an INSERT / UPDATE / DELETE script for the target.
        </Empty>
      )}
      {diff && (
        <Group orientation="vertical" className="min-h-0 flex-1">
          <Panel defaultSize="55%" minSize="20%">
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
                <Badge>{state.srcN?.toLocaleString()} source rows</Badge>
                <Badge>{state.tgtN?.toLocaleString()} target rows</Badge>
                <span className="text-faint">·</span>
                <Badge tone="default">{diff.identical.toLocaleString()} identical</Badge>
                {warnings.map((w) => (
                  <span key={w} className="flex items-center gap-1 text-warn"><AlertTriangle className="size-3.5" />{w}</span>
                ))}
              </div>
              <div className="flex items-center gap-1 border-b border-line px-2">
                {([
                  ["inserts", "To insert", diff.inserts.length, "text-ok"],
                  ["updates", "To update", diff.updates.length, "text-warn"],
                  ["deletes", "To delete", diff.deletes.length, "text-danger"],
                ] as const).map(([k, label, n, cls]) => (
                  <button key={k} onClick={() => setView(k)}
                    className={clsx("border-b-2 px-2.5 py-1.5 text-xs", view === k ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
                    {label} <span className={clsx("font-mono", cls)}>{n.toLocaleString()}</span>
                  </button>
                ))}
                <div className="flex-1" />
                <Checkbox label="Inserts" checked={opts.inserts} onChange={(v) => setOpts({ ...opts, inserts: v })} />
                <Checkbox label="Updates" checked={opts.updates} onChange={(v) => setOpts({ ...opts, updates: v })} />
                <span title={capped ? "Disabled: row cap reached" : undefined} className={clsx(capped && "pointer-events-none opacity-50")}>
                  <Checkbox label="Deletes" checked={opts.deletes && !capped} onChange={(v) => setOpts({ ...opts, deletes: v })} />
                </span>
                <Checkbox label="Transaction" checked={opts.transaction} onChange={(v) => setOpts({ ...opts, transaction: v })} />
              </div>
              <RowList rows={diff[view]} kind={view} columns={diff.columns} keys={diff.keyColumns} />
            </div>
          </Panel>
          <Separator className="h-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
          <Panel minSize="15%">
            <ScriptPanel
              title="Data sync script"
              script={edited ?? script}
              onChange={setEdited}
              dirty={edited !== null}
              onRegenerate={() => setEdited(null)}
              target={target}
              fileName={`data-sync-${tgtRef?.name ?? "table"}.sql`}
            />
          </Panel>
        </Group>
      )}
    </div>
  );
}

function fill(t: TableRef, tgt: Target): TableRef {
  return { name: t.name, database: t.database ?? tgt.database, schema: t.schema ?? tgt.schema };
}

const fmt = (v: CellValue | undefined) => (v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v));

function RowList({ rows, kind, columns, keys }: { rows: RowDiff[]; kind: "inserts" | "updates" | "deletes"; columns: string[]; keys: string[] }) {
  const LIMIT = 1000;
  const shown = rows.slice(0, LIMIT);
  if (!rows.length) return <Empty icon={<Table2 className="size-6" />} title={`Nothing to ${kind.slice(0, -1)}`} />;
  const cols = kind === "updates" ? [...keys, ...columns.filter((c) => !keys.includes(c) && rows.some((r) => r.changed.includes(c)))] : columns;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="selectable w-max min-w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>{cols.map((c) => <th key={c} className="border-b border-r border-line px-2 py-1 text-left font-medium text-muted">{c}</th>)}</tr>
        </thead>
        <tbody className="font-mono text-[11.5px]">
          {shown.map((r, i) => {
            const row = r.source ?? r.target!;
            return (
              <tr key={i} className="border-b border-line/40 hover:bg-hover">
                {cols.map((c) => {
                  const changed = kind === "updates" && r.changed.includes(c);
                  return (
                    <td key={c} className={clsx("max-w-72 truncate border-r border-line/40 px-2 py-0.5",
                      keys.includes(c) && "text-accent",
                      kind === "inserts" && "text-ok", kind === "deletes" && "text-danger")}>
                      {changed ? (
                        <span><span className="text-danger line-through">{fmt(r.target![c])}</span> <span className="text-ok">{fmt(r.source![c])}</span></span>
                      ) : kind === "updates" && !keys.includes(c) ? <span className="text-faint">=</span> : fmt(row[c])}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > LIMIT && <div className="p-2 text-center text-xs text-faint">Showing first {LIMIT.toLocaleString()} of {rows.length.toLocaleString()} rows. All rows are included in the script.</div>}
    </div>
  );
}
