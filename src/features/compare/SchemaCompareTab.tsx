import clsx from "clsx";
import { ArrowLeftRight, GitCompareArrows, Rows3, Settings2, TableProperties } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Checkbox, Empty, ErrorBox, IconButton, Spinner, Toolbar } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import { dialectOf } from "../../lib/types";
import { useConnections } from "../../store/connections";
import type { Tab } from "../../tabs/types";
import { TargetPicker, lsGet, lsSet, type Target } from "../transfer/shared";
import { DataCompare } from "./DataCompare";
import { DEFAULT_DIFF_OPTIONS, diffSchemas, type SchemaDiff } from "./diff";
import type { SqlDialect } from "./sqlDialect";
import { StructureCompare } from "./StructureCompare";

type CompareTab = Extract<Tab, { type: "schema-compare" }>;

interface Prefs {
  ignoreCase: boolean; ignoreTypeSize: boolean; compareDefaults: boolean; compareIndexes: boolean; compareForeignKeys: boolean; dropColumns: boolean;
}
const DEFAULT_PREFS: Prefs = { ...DEFAULT_DIFF_OPTIONS, dropColumns: true };

const empty = (connId?: string): Target => ({ connId: connId ?? "", database: null, schema: null });

export default function SchemaCompareTab({ tab }: { tab: CompareTab }) {
  const connections = useConnections((s) => s.connections);
  const last = lsGet<{ source?: Target; target?: Target }>("compare:last", {});
  const [source, setSource] = useState<Target>(() => tab.sourceConnId ? empty(tab.sourceConnId) : last.source ?? empty());
  const [target, setTarget] = useState<Target>(() => tab.targetConnId ? empty(tab.targetConnId) : last.target ?? empty());
  const [mode, setMode] = useState<"structure" | "data">("structure");
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...lsGet<Partial<Prefs>>("compare:prefs", {}) }));
  const [showOpts, setShowOpts] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<{ src: Awaited<ReturnType<typeof api.schemaSnapshot>>; tgt: Awaited<ReturnType<typeof api.schemaSnapshot>>; source: Target; target: Target } | null>(null);

  const srcConn = connections.find((c) => c.id === source.connId);
  const tgtConn = connections.find((c) => c.id === target.connId);
  const srcDialect = srcConn ? (dialectOf(srcConn.kind) as SqlDialect) : null;
  const tgtDialect = tgtConn ? (dialectOf(tgtConn.kind) as SqlDialect) : null;
  const label = (c: typeof srcConn, t: Target) => [c?.name, t.database, t.schema].filter(Boolean).join(" / ");

  const setPref = (k: keyof Prefs, v: boolean) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    lsSet("compare:prefs", next);
  };

  const remember = (s: Target, t: Target) => lsSet("compare:last", { source: s, target: t });
  const updateSource = (t: Target) => { setSource(t); remember(t, target); };
  const updateTarget = (t: Target) => { setTarget(t); remember(source, t); };
  const swap = () => { setSource(target); setTarget(source); remember(target, source); setSnaps(null); };

  const compare = async () => {
    if (!source.connId || !target.connId) return;
    setRunning(true);
    setError(null);
    try {
      const [src, tgt] = await Promise.all([
        api.schemaSnapshot(source.connId, source.database, source.schema),
        api.schemaSnapshot(target.connId, target.database, target.schema),
      ]);
      setSnaps({ src, tgt, source, target });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  };

  const diff: SchemaDiff | null = useMemo(() => snaps && srcDialect && tgtDialect ? diffSchemas(snaps.src, snaps.tgt, {
    crossDialect: srcDialect !== tgtDialect,
    ignoreCase: prefs.ignoreCase, ignoreTypeSize: prefs.ignoreTypeSize, compareDefaults: prefs.compareDefaults,
    compareIndexes: prefs.compareIndexes, compareForeignKeys: prefs.compareForeignKeys,
  }) : null, [snaps, srcDialect, tgtDialect, prefs]);

  const sameSide = source.connId && source.connId === target.connId && source.database === target.database && source.schema === target.schema;
  const stale = snaps && (snaps.source !== source || snaps.target !== target);

  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <GitCompareArrows className="ml-1 size-4 text-accent" />
        <div className="ml-1 flex rounded-md border border-line p-0.5">
          {([["structure", "Structure", TableProperties], ["data", "Data", Rows3]] as const).map(([m, l, Icon]) => (
            <button key={m} onClick={() => setMode(m)}
              className={clsx("flex h-5 items-center gap-1 rounded px-2 text-xs", mode === m ? "bg-hover text-fg" : "text-muted hover:text-fg")}>
              <Icon className="size-3.5" />{l}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {mode === "structure" && (
          <>
            <IconButton title="Comparison options" active={showOpts} onClick={() => setShowOpts((v) => !v)}><Settings2 className="size-3.5" /></IconButton>
            <Button variant="primary" size="sm" onClick={compare} loading={running} disabled={!source.connId || !target.connId}>
              <GitCompareArrows className="size-3.5" />{snaps ? "Re-compare" : "Compare"}
            </Button>
          </>
        )}
      </Toolbar>

      <div className="flex shrink-0 items-stretch gap-2 border-b border-line bg-panel px-3 py-2">
        <div className="min-w-0 flex-1"><TargetPicker label="Source" value={source} onChange={updateSource} /></div>
        <div className="flex items-end pb-0.5">
          <IconButton title="Swap source and target" onClick={swap}><ArrowLeftRight className="size-4" /></IconButton>
        </div>
        <div className="min-w-0 flex-1"><TargetPicker label="Target" value={target} onChange={updateTarget} /></div>
      </div>

      {mode === "structure" && showOpts && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-panel px-3 py-1.5">
          <Checkbox label="Ignore name case" checked={prefs.ignoreCase} onChange={(v) => setPref("ignoreCase", v)} />
          <Checkbox label="Ignore type length/precision" checked={prefs.ignoreTypeSize} onChange={(v) => setPref("ignoreTypeSize", v)} />
          <Checkbox label="Compare defaults" checked={prefs.compareDefaults} onChange={(v) => setPref("compareDefaults", v)} />
          <Checkbox label="Compare indexes" checked={prefs.compareIndexes} onChange={(v) => setPref("compareIndexes", v)} />
          <Checkbox label="Compare foreign keys" checked={prefs.compareForeignKeys} onChange={(v) => setPref("compareForeignKeys", v)} />
          <Checkbox label="Drop columns missing in source" checked={prefs.dropColumns} onChange={(v) => setPref("dropColumns", v)} />
        </div>
      )}

      {(sameSide || (srcDialect && tgtDialect && srcDialect !== tgtDialect) || stale) && (
        <div className="shrink-0 border-b border-line bg-warn/10 px-3 py-1 text-xs text-warn">
          {sameSide ? "Source and target are the same database/schema." :
            stale ? "Selection changed since the last comparison — click Re-compare." :
              `Cross-dialect comparison (${srcDialect} → ${tgtDialect}): types are compared by family and the script is translated to ${tgtDialect}.`}
        </div>
      )}

      {mode === "structure" ? (
        <>
          {error && <ErrorBox error={error} />}
          {running && !snaps && <div className="flex flex-1 items-center justify-center gap-2 text-muted"><Spinner />Reading schemas…</div>}
          {!running && !snaps && !error && (
            <Empty icon={<GitCompareArrows className="size-8" />} title="Compare two schemas">
              Choose a source (desired state) and a target, then click Compare. You'll get a list of differences and a synchronization script for the target.
            </Empty>
          )}
          {diff && snaps && srcDialect && tgtDialect && (
            <StructureCompare
              diff={diff}
              source={snaps.source}
              target={snaps.target}
              sourceDialect={srcDialect}
              targetDialect={tgtDialect}
              sourceLabel={label(connections.find((c) => c.id === snaps.source.connId), snaps.source)}
              targetLabel={label(connections.find((c) => c.id === snaps.target.connId), snaps.target)}
              options={{ dropColumns: prefs.dropColumns }}
            />
          )}
        </>
      ) : source.connId && target.connId && tgtDialect ? (
        <DataCompare source={source} target={target} targetDialect={tgtDialect} />
      ) : (
        <Empty icon={<Rows3 className="size-8" />} title="Compare table data">Choose source and target connections first.</Empty>
      )}
    </div>
  );
}
