// Aggregation pipeline builder: ordered stage list, each stage a small Monaco editor.
import Editor from "@monaco-editor/react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Layers, Play, Plus, StepForward, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { toast } from "sonner";
import { Button, Empty, ErrorBox, IconButton, Select, Spinner } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { TableRef } from "../../lib/types";
import { lsGet, lsSet } from "../transfer/shared";
import { collRef, parseRelaxed } from "./ejson";
import { DocumentsView, JsonView, TableView, type Doc } from "./views";

interface Stage { id: string; op: string; body: string; enabled: boolean }

const TEMPLATES: Record<string, string> = {
  $match: '{\n  "field": "value"\n}',
  $group: '{\n  "_id": "$field",\n  "count": { "$sum": 1 }\n}',
  $project: '{\n  "_id": 0,\n  "field": 1\n}',
  $sort: '{\n  "field": -1\n}',
  $limit: "10",
  $skip: "0",
  $lookup: '{\n  "from": "otherCollection",\n  "localField": "field",\n  "foreignField": "_id",\n  "as": "joined"\n}',
  $unwind: '{\n  "path": "$field",\n  "preserveNullAndEmptyArrays": true\n}',
  $addFields: '{\n  "newField": "$field"\n}',
  $count: '"count"',
  $sample: '{ "size": 10 }',
  $facet: '{\n  "byField": [ { "$sortByCount": "$field" } ]\n}',
  $replaceRoot: '{ "newRoot": "$field" }',
  $sortByCount: '"$field"',
  $out: '"outputCollection"',
};
const OPS = Object.keys(TEMPLATES);

const uid = () => Math.random().toString(36).slice(2, 9);

function stageError(s: Stage): string | null {
  try { parseRelaxed(s.body); return null; } catch (e) { return (e as Error).message; }
}

export function AggregationView({ connId, table, readOnly }: { connId: string; table: TableRef; readOnly?: boolean }) {
  const storeKey = `mongo:agg:${connId}:${table.database ?? ""}:${table.name}`;
  const [stages, setStages] = useState<Stage[]>(() => lsGet<Stage[]>(storeKey, [{ id: uid(), op: "$match", body: "{\n  \n}", enabled: true }]));
  const [addOp, setAddOp] = useState("$match");
  const [maxRows, setMaxRows] = useState(200);
  const [view, setView] = useState<"documents" | "table" | "json">("documents");
  const [result, setResult] = useState<{ docs: Doc[]; ms: number; truncated: boolean; upTo: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { lsSet(storeKey, stages); }, [storeKey, stages]);

  const update = (id: string, patch: Partial<Stage>) => setStages((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => setStages((ss) => {
    const a = [...ss];
    const j = i + d;
    if (j < 0 || j >= a.length) return ss;
    [a[i], a[j]] = [a[j], a[i]];
    return a;
  });

  const pipelineText = (upTo = stages.length - 1) =>
    "[\n" + stages.slice(0, upTo + 1).filter((s) => s.enabled).map((s) => `  { ${JSON.stringify(s.op)}: ${s.body.trim().replace(/\n/g, "\n  ")} }`).join(",\n") + "\n]";
  const shell = useMemo(() => `${collRef(table.name)}.aggregate(${pipelineText()})`, [stages, table.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (upTo = stages.length - 1) => {
    const active = stages.slice(0, upTo + 1).filter((s) => s.enabled);
    const bad = active.map((s, i) => [i, stageError(s)] as const).find(([, e]) => e);
    if (bad) { setError(`Stage ${bad[0] + 1} (${active[bad[0]].op}): ${bad[1]}`); return; }
    const writes = active.some((s) => s.op === "$out" || s.op === "$merge");
    if (writes && readOnly) { setError("$out / $merge are not allowed on a read-only connection."); return; }
    setRunning(true);
    setError(null);
    try {
      // Wrap the output so every document comes back whole in one column.
      const stagesText = active.map((s) => `{ ${JSON.stringify(s.op)}: ${s.body} }`);
      if (!writes) stagesText.push('{ "$project": { "_id": 0, "__doc": "$$ROOT" } }');
      const t0 = performance.now();
      const [r] = await api.execute(connId, `${collRef(table.name)}.aggregate([${stagesText.join(",\n")}])`, { database: table.database, maxRows });
      const idx = r?.columns.findIndex((c) => c.name === "__doc") ?? -1;
      const docs = idx >= 0 ? r.rows.map((row) => row[idx] as Doc) : [];
      setResult({ docs, ms: r?.elapsedMs ?? Math.round(performance.now() - t0), truncated: !!r?.truncated, upTo });
      if (writes) toast.success("Pipeline with $out/$merge executed");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel defaultSize="45%" minSize="25%">
        <div className="flex h-full flex-col bg-panel">
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
            <Layers className="size-3.5 text-accent" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Pipeline</span>
            <span className="text-[11px] text-faint">{stages.filter((s) => s.enabled).length}/{stages.length} stages</span>
            <div className="flex-1" />
            <Select value={addOp} onChange={(e) => setAddOp(e.target.value)} className="h-6 w-32 text-xs">
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
            <Button size="sm" onClick={() => setStages((ss) => [...ss, { id: uid(), op: addOp, body: TEMPLATES[addOp], enabled: true }])}><Plus className="size-3.5" />Add stage</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {!stages.length && <Empty title="Empty pipeline">Add a stage to get started.</Empty>}
            {stages.map((s, i) => {
              const err = stageError(s);
              const lines = Math.min(14, Math.max(2, s.body.split("\n").length));
              return (
                <div key={s.id} className={clsx("mb-2 rounded-md border bg-app", err ? "border-danger/50" : "border-line", !s.enabled && "opacity-50")}>
                  <div className="flex h-7 items-center gap-1 border-b border-line px-1.5">
                    <span className="w-5 text-center font-mono text-[10.5px] text-faint">{i + 1}</span>
                    <Select value={s.op} onChange={(e) => update(s.id, { op: e.target.value })} className="h-5 w-32 border-none bg-transparent px-1 font-mono text-xs text-accent">
                      {[...new Set([...OPS, s.op])].map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                    {err && <span className="truncate text-[10.5px] text-danger" title={err}>{err}</span>}
                    <div className="flex-1" />
                    <IconButton title="Run up to this stage" onClick={() => run(i)} disabled={running}><StepForward className="size-3.5" /></IconButton>
                    <IconButton title={s.enabled ? "Disable stage" : "Enable stage"} onClick={() => update(s.id, { enabled: !s.enabled })}>{s.enabled ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}</IconButton>
                    <IconButton title="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="size-3.5" /></IconButton>
                    <IconButton title="Move down" onClick={() => move(i, 1)} disabled={i === stages.length - 1}><ArrowDown className="size-3.5" /></IconButton>
                    <IconButton title="Remove stage" onClick={() => setStages((ss) => ss.filter((x) => x.id !== s.id))}><Trash2 className="size-3.5" /></IconButton>
                  </div>
                  <div style={{ height: lines * 18 + 10 }}>
                    <Editor
                      language="json"
                      theme="devcat"
                      value={s.body}
                      onChange={(v) => update(s.id, { body: v ?? "" })}
                      options={{
                        minimap: { enabled: false }, fontSize: 12, lineNumbers: "off", folding: false, glyphMargin: false,
                        lineDecorationsWidth: 6, scrollBeyondLastLine: false, automaticLayout: true, renderLineHighlight: "none",
                        overviewRulerLanes: 0, scrollbar: { vertical: "auto", alwaysConsumeMouseWheel: false }, padding: { top: 5 },
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-line p-2">
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(shell).then(() => toast.success("Pipeline copied as shell code"))}><Copy className="size-3.5" />Copy code</Button>
            <div className="flex-1" />
            <span className="text-[11px] text-muted">Preview</span>
            <Select value={String(maxRows)} onChange={(e) => setMaxRows(Number(e.target.value))} className="h-6 w-20 text-xs">
              {[20, 50, 200, 1000, 5000].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            <Button size="sm" variant="primary" onClick={() => run()} loading={running} disabled={!stages.length}><Play className="size-3.5" />Run</Button>
          </div>
        </div>
      </Panel>
      <Separator className="w-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
      <Panel minSize="25%">
        <div className="flex h-full flex-col">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
            <div className="flex rounded-md border border-line p-0.5">
              {(["documents", "table", "json"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={clsx("h-5 rounded px-2 text-xs capitalize", view === v ? "bg-hover text-fg" : "text-muted hover:text-fg")}>{v}</button>
              ))}
            </div>
            {result && (
              <span className="text-[11px] text-muted">
                {result.docs.length.toLocaleString()}{result.truncated ? "+" : ""} document(s) · {result.ms} ms
                {result.upTo < stages.length - 1 && ` · through stage ${result.upTo + 1}`}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {error && <ErrorBox error={error} />}
            {running && !result && <div className="flex h-full items-center justify-center gap-2 text-muted"><Spinner />Running…</div>}
            {!error && !running && !result && <Empty icon={<Layers className="size-8" />} title="Run the pipeline to preview results">Use ▶ on a stage to preview the output up to that stage.</Empty>}
            {result && !error && (
              result.docs.length === 0 ? <Empty title="No documents" /> :
                view === "documents" ? <DocumentsView docs={result.docs} offset={0} expand={1} actions={{}} /> :
                  view === "table" ? <TableView docs={result.docs} offset={0} actions={{}} /> : <JsonView docs={result.docs} />
            )}
          </div>
        </div>
      </Panel>
    </Group>
  );
}
