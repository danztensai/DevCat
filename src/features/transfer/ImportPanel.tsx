import clsx from "clsx";
import { ArrowRight, Eye, Play, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox, ErrorBox, Input, Select, Spinner } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { ConnectionKind } from "../../lib/types";
import type { Job } from "./JobLog";
import { DELIMITERS, PathField, Row, Section, Segmented } from "./form";
import { SQL_KINDS, TargetPicker, basename, listTables, lsGet, lsSet, useAsync, type Target } from "./shared";

type Format = "csv" | "json" | "jsonl";
const KINDS: ConnectionKind[] = [...SQL_KINDS, "mongodb"];
const SKIP = "";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function detectFormat(p: string): Format {
  const ext = p.split(".").pop()?.toLowerCase();
  return ext === "json" ? "json" : ext === "jsonl" || ext === "ndjson" ? "jsonl" : "csv";
}

function detectDelimiter(p: string): string | null {
  return /\.(tsv|tab)$/i.test(p) ? "\t" : null;
}

export function ImportPanel({ initial, job }: { initial: Target; job: Job }) {
  const [path, setPath] = useState("");
  const [format, setFormat] = useState<Format>("csv");
  const [header, setHeader] = useState(true);
  const [delimiter, setDelimiter] = useState(() => lsGet("transfer:importDelimiter", ","));
  const [emptyAsNull, setEmptyAsNull] = useState(true);
  const [skipRows, setSkipRows] = useState(0);
  const [mode, setMode] = useState<"append" | "truncate">("append");
  const [tgt, setTgt] = useState<Target>(initial);
  const [table, setTable] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [previewState, setPreviewState] = useState<{ loading: boolean; error?: string }>({ loading: false });

  const tables = useAsync(tgt.connId ? () => listTables(tgt.connId, tgt.database, tgt.schema) : null, [tgt.connId, tgt.database, tgt.schema]);
  const tableRef = tables.data?.find((t) => t.name === table);
  const structure = useAsync(tgt.connId && tableRef ? () => api.tableStructure(tgt.connId, { ...tableRef, database: tableRef.database ?? tgt.database, schema: tableRef.schema ?? tgt.schema }) : null, [tgt.connId, tableRef]);
  const targetCols = useMemo(() => structure.data?.columns.map((c) => c.name) ?? [], [structure.data]);

  const loadPreview = useCallback(async () => {
    if (!path) return;
    setPreviewState({ loading: true });
    try {
      const p = await api.importPreview(format, path, { delimiter, header, skipRows, limit: 50 });
      setPreview(p);
      setPreviewState({ loading: false });
    } catch (e) {
      setPreview(null);
      setPreviewState({ loading: false, error: errMsg(e) });
    }
  }, [path, format, delimiter, header, skipRows]);
  useEffect(() => { loadPreview(); }, [loadPreview]);

  // Suggest a table with the file's base name
  useEffect(() => {
    if (!path || !tables.data || table) return;
    const base = norm(basename(path).replace(/\.[^.]+$/, ""));
    const m = tables.data.find((t) => norm(t.name) === base);
    if (m) setTable(m.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tables.data]);

  const autoMatch = useCallback(() => {
    if (!preview) return;
    const m: Record<string, string> = {};
    for (const c of preview.columns) {
      const hit = targetCols.find((t) => t === c) ?? targetCols.find((t) => norm(t) === norm(c));
      m[c] = hit ?? SKIP;
    }
    setMapping(m);
  }, [preview, targetCols]);
  useEffect(() => { autoMatch(); }, [autoMatch]);

  const mapped = Object.entries(mapping).filter(([, v]) => v);
  const dupTargets = new Set(mapped.map(([, v]) => v).filter((v, i, a) => a.indexOf(v) !== i));
  const canRun = !!path && !!tableRef && mapped.length > 0 && dupTargets.size === 0 && !job.job.running;

  const run = async () => {
    if (!tableRef) return;
    const jobId = job.start(`Import ${basename(path)} → ${table} (${mode})`);
    try {
      const n = await api.importData(tgt.connId, { ...tableRef, database: tableRef.database ?? tgt.database, schema: tableRef.schema ?? tgt.schema }, format, path, {
        delimiter, header, skipRows, emptyAsNull, mode, mapping: Object.fromEntries(mapped), jobId,
      });
      job.finish(true, `Imported ${n.toLocaleString()} rows into ${table}.`);
    } catch (e) {
      job.finish(false, `Import failed: ${errMsg(e)}`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Source file">
          <Row label="File">
            <PathField value={path} onChange={(p) => { setPath(p); setFormat(detectFormat(p)); const d = detectDelimiter(p); if (d) setDelimiter(d); setTable(""); }} mode="open" dirKey="import"
              filters={[{ name: "Data files", extensions: ["csv", "tsv", "txt", "json", "jsonl", "ndjson"] }]} />
          </Row>
          <Row label="Format">
            <Segmented value={format} onChange={setFormat} options={[{ value: "csv", label: "CSV" }, { value: "json", label: "JSON" }, { value: "jsonl", label: "JSON Lines" }]} />
          </Row>
          {format === "csv" && (
            <>
              <Row label="Delimiter">
                <Select value={delimiter} onChange={(e) => { setDelimiter(e.target.value); lsSet("transfer:importDelimiter", e.target.value); }}>
                  {DELIMITERS.map((d) => <option key={d.label} value={d.value}>{d.label}</option>)}
                </Select>
              </Row>
              <Row label="Skip lines" hint="Lines to skip before the header / first row.">
                <Input type="number" min={0} value={skipRows} onChange={(e) => setSkipRows(Math.max(0, Number(e.target.value) || 0))} className="w-24" />
              </Row>
              <Row label=""><Checkbox label="First row is a header" checked={header} onChange={setHeader} /></Row>
            </>
          )}
          <Row label=""><Checkbox label="Treat empty values as NULL" checked={emptyAsNull} onChange={setEmptyAsNull} /></Row>
        </Section>
        <Section title="Target">
          <TargetPicker value={tgt} onChange={(t) => { setTgt(t); setTable(""); }} kinds={KINDS} />
          <div className="mt-2">
            <Row label="Table">
              <Select value={table} onChange={(e) => setTable(e.target.value)} disabled={!tables.data}>
                <option value="">{tables.loading ? "Loading…" : tables.error ? "Error loading tables" : "Select table…"}</option>
                {tables.data?.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </Select>
            </Row>
            <Row label="Mode">
              <Segmented value={mode} onChange={setMode} options={[{ value: "append", label: "Append" }, { value: "truncate", label: "Empty table first" }]} />
            </Row>
            {mode === "truncate" && <div className="pl-[142px] text-[11px] text-warn">All existing rows in {table || "the table"} will be deleted before importing.</div>}
          </div>
        </Section>
      </div>

      <Section
        title="Column mapping"
        right={<div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={loadPreview} disabled={!path}><Eye className="size-3.5" />Reload preview</Button>
          <Button size="sm" variant="ghost" onClick={autoMatch} disabled={!preview || !targetCols.length}><Wand2 className="size-3.5" />Auto-match</Button>
        </div>}
      >
        {previewState.loading && <div className="flex items-center gap-2 text-xs text-muted"><Spinner className="size-3.5" />Reading file…</div>}
        {previewState.error && <ErrorBox error={previewState.error} />}
        {!path && <div className="text-xs text-faint">Choose a file to preview its columns.</div>}
        {preview && (
          <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
            <div className="max-h-80 overflow-auto rounded-md border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-panel">
                  <tr className="text-left text-[11px] text-muted">
                    <th className="px-2 py-1 font-medium">File column</th><th className="w-6" /><th className="px-2 py-1 font-medium">Target column</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.columns.map((c) => (
                    <tr key={c} className="border-t border-line/50">
                      <td className="px-2 py-0.5 font-mono text-xs">{c}</td>
                      <td><ArrowRight className={clsx("mx-auto size-3", mapping[c] ? "text-accent" : "text-faint")} /></td>
                      <td className="px-1 py-0.5">
                        <Select
                          value={mapping[c] ?? SKIP}
                          onChange={(e) => setMapping({ ...mapping, [c]: e.target.value })}
                          className={clsx("h-6 text-xs", mapping[c] && dupTargets.has(mapping[c]) && "border-danger", !mapping[c] && "text-faint")}
                          disabled={!targetCols.length}
                        >
                          <option value={SKIP}>— skip —</option>
                          {targetCols.map((t) => <option key={t} value={t}>{t}</option>)}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="min-w-0">
              <div className="mb-1 text-[11px] text-muted">Preview (first {Math.min(preview.rows.length, 20)} rows)</div>
              <div className="max-h-80 overflow-auto rounded-md border border-line">
                <table className="selectable w-max min-w-full text-[12px]">
                  <thead className="sticky top-0 bg-panel">
                    <tr>{preview.columns.map((c) => <th key={c} className="border-b border-r border-line px-2 py-1 text-left font-medium text-muted">{c}</th>)}</tr>
                  </thead>
                  <tbody className="font-mono text-[11.5px]">
                    {preview.rows.slice(0, 20).map((r, i) => (
                      <tr key={i} className="border-b border-line/40">
                        {preview.columns.map((_, j) => {
                          const v = r[j];
                          return <td key={j} className={clsx("max-w-60 truncate border-r border-line/40 px-2 py-0.5", v === null || v === undefined || v === "" ? "text-faint" : "")}>
                            {v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center justify-end gap-3">
          {dupTargets.size > 0 && <span className="text-xs text-danger">Each target column can only be mapped once.</span>}
          {preview && <span className="text-xs text-muted">{mapped.length} of {preview.columns.length} columns mapped</span>}
          <Button variant="primary" onClick={run} disabled={!canRun} loading={job.job.running}><Play className="size-3.5" />Import</Button>
        </div>
      </Section>
    </div>
  );
}
