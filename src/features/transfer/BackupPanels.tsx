import { AlertTriangle, ArrowRight, DatabaseBackup, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, Input } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import { useConnections } from "../../store/connections";
import type { Job } from "./JobLog";
import { PathField, Row, Section, Segmented } from "./form";
import type { ConnectionKind } from "../../lib/types";
import { SQL_KINDS, TableChecklist, TargetPicker, basename, listTables, lsGet, lsSet, safeFileName, useAsync, type Target } from "./shared";

const BACKUP_KINDS: ConnectionKind[] = [...SQL_KINDS, "mongodb"];

const today = () => new Date().toISOString().slice(0, 10);

export function BackupPanel({ initial, job }: { initial: Target; job: Job }) {
  const [src, setSrc] = useState<Target>(initial);
  const [scope, setScope] = useState<"all" | "subset">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [opts, setOpts] = useState(() => ({ includeStructure: true, includeData: true, dropIfExists: true, includeViews: true, ...lsGet("transfer:backupOpts", {}) }));
  const isMongo = useConnections((s) => s.connections.find((c) => c.id === src.connId)?.kind === "mongodb");
  const [path, setPath] = useState("");
  useEffect(() => setPath(""), [isMongo]);
  const tables = useAsync(src.connId && scope === "subset" ? () => listTables(src.connId, src.database, src.schema) : null, [src.connId, src.database, src.schema, scope]);
  useEffect(() => setSelected(new Set()), [src.connId, src.database, src.schema]);
  const set = (k: keyof typeof opts, v: boolean) => { const n = { ...opts, [k]: v }; setOpts(n); lsSet("transfer:backupOpts", n); };

  const canRun = !!src.connId && !!path && (opts.includeStructure || opts.includeData) && (scope === "all" || selected.size > 0) && !job.job.running;
  const run = async () => {
    const jobId = job.start(`Backup ${[src.database, src.schema].filter(Boolean).join(".") || "database"} → ${path}`);
    try {
      const msg = await api.backupDatabase(src.connId, src.database, src.schema, path, {
        ...opts,
        structureOnly: opts.includeStructure && !opts.includeData,
        ...(scope === "subset" ? { tables: [...selected] } : {}),
        jobId,
      });
      job.finish(true, msg || "Backup complete.");
    } catch (e) {
      job.finish(false, `Backup failed: ${errMsg(e)}`);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Section title="Database">
        <TargetPicker value={src} onChange={setSrc} kinds={BACKUP_KINDS} />
        <div className="mt-3"><Segmented value={scope} onChange={setScope} options={[{ value: "all", label: isMongo ? "All collections" : "All tables" }, { value: "subset", label: isMongo ? "Selected collections" : "Selected tables" }]} /></div>
        {scope === "subset" && (
          <TableChecklist className="mt-2 h-56" tables={tables.data ?? []} loading={tables.loading} error={tables.error} selected={selected} onChange={setSelected} />
        )}
      </Section>
      <Section title="Options">
        {isMongo ? (
          <p className="pb-2 text-xs text-muted">MongoDB backups write one <span className="font-mono">&lt;collection&gt;.jsonl</span> file per collection into the chosen folder.</p>
        ) : (
          <Row label="Content">
            <div className="flex flex-col gap-1.5">
              <Checkbox label="Structure (CREATE statements)" checked={opts.includeStructure} onChange={(v) => set("includeStructure", v)} />
              <Checkbox label="Data (INSERT statements)" checked={opts.includeData} onChange={(v) => set("includeData", v)} />
              <Checkbox label="Views" checked={opts.includeViews} onChange={(v) => set("includeViews", v)} />
              <Checkbox label="Add DROP … IF EXISTS before CREATE" checked={opts.dropIfExists} onChange={(v) => set("dropIfExists", v)} />
            </div>
          </Row>
        )}
        <Row label={isMongo ? "Output folder" : "Output file"}>
          <PathField value={path} onChange={setPath} mode={isMongo ? "folder" : "save"} dirKey="backup"
            defaultName={`${safeFileName(src.database ?? "backup")}${src.schema ? "-" + safeFileName(src.schema) : ""}-${today()}.sql`}
            filters={[{ name: "SQL script", extensions: ["sql"] }]} />
        </Row>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={run} disabled={!canRun} loading={job.job.running}><DatabaseBackup className="size-3.5" />Back up</Button>
        </div>
      </Section>
    </div>
  );
}

export function RestorePanel({ initial, job }: { initial: Target; job: Job }) {
  const [tgt, setTgt] = useState<Target>(initial);
  const [path, setPath] = useState("");
  const [continueOnError, setContinueOnError] = useState(false);
  const [dropExisting, setDropExisting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const conn = useConnections((s) => s.connections.find((c) => c.id === tgt.connId));
  const isMongo = conn?.kind === "mongodb";
  const canRun = !!tgt.connId && !!path && !job.job.running && !conn?.readOnly;

  const run = async () => {
    setConfirm(false);
    const jobId = job.start(`Restore ${basename(path)} → ${conn?.name ?? tgt.connId}${tgt.database ? "/" + tgt.database : ""}`);
    try {
      const msg = await api.restoreDatabase(tgt.connId, tgt.database, path, { continueOnError, schema: tgt.schema, ...(isMongo ? { dropExisting } : {}), jobId });
      job.finish(true, msg || "Restore complete.");
    } catch (e) {
      job.finish(false, `Restore failed: ${errMsg(e)}`);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Section title={isMongo ? "Backup folder" : "Script"}>
        <Row label={isMongo ? "Folder" : "SQL file"} hint={isMongo ? "A folder of <collection>.jsonl files written by Backup." : undefined}>
          <PathField value={path} onChange={setPath} mode={isMongo ? "folder" : "open"} dirKey="backup" filters={[{ name: "SQL script", extensions: ["sql", "txt"] }]} />
        </Row>
        <Row label="">
          <div className="flex flex-col gap-1.5">
            <Checkbox label="Continue on error" checked={continueOnError} onChange={setContinueOnError} />
            {isMongo && <Checkbox label="Empty collections before loading" checked={dropExisting} onChange={setDropExisting} />}
          </div>
        </Row>
      </Section>
      <Section title="Target database">
        <TargetPicker value={tgt} onChange={(t) => { if (t.connId !== tgt.connId) setPath(""); setTgt(t); }} kinds={BACKUP_KINDS} />
        {conn?.readOnly && <div className="mt-2 text-xs text-warn">This connection is marked read-only.</div>}
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={() => setConfirm(true)} disabled={!canRun} loading={job.job.running}><RotateCcw className="size-3.5" />Restore</Button>
        </div>
      </Section>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Run restore script?" width={440}
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={run} autoFocus><Play className="size-3.5" />Run script</Button></>}>
        <div className="flex gap-3 text-[13px]">
          <AlertTriangle className="size-5 shrink-0 text-warn" />
          <div className="space-y-2">
            <p><span className="font-mono text-xs">{basename(path)}</span> will be executed against <b>{conn?.name}</b>{tgt.database ? <> / <b>{tgt.database}</b></> : null}.</p>
            <p className="text-muted">Scripts may drop and recreate objects. This cannot be undone.</p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export function CopyPanel({ initial, job }: { initial: Target; job: Job }) {
  const [src, setSrc] = useState<Target>(initial);
  const [dst, setDst] = useState<Target>(() => lsGet<Target>("transfer:copyTarget", { connId: "", database: null, schema: null }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [opts, setOpts] = useState(() => ({ createTables: true, dropExisting: false, truncate: false, indexes: true, foreignKeys: false, continueOnError: false, batchSize: 1000, ...lsGet("transfer:copyOpts", {}) }));
  const [confirm, setConfirm] = useState(false);
  const tables = useAsync(src.connId ? () => listTables(src.connId, src.database, src.schema) : null, [src.connId, src.database, src.schema]);
  useEffect(() => setSelected(new Set()), [src.connId, src.database, src.schema]);
  const set = <K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => { const n = { ...opts, [k]: v }; setOpts(n); lsSet("transfer:copyOpts", n); };
  const setTarget = (t: Target) => { setDst(t); lsSet("transfer:copyTarget", t); };
  const same = src.connId === dst.connId && src.database === dst.database && src.schema === dst.schema;
  const canRun = !!src.connId && !!dst.connId && selected.size > 0 && !same && !job.job.running;

  const run = async () => {
    setConfirm(false);
    const chosen = (tables.data ?? []).filter((t) => selected.has(t.name)).map((t) => ({ ...t, database: t.database ?? src.database, schema: t.schema ?? src.schema }));
    const jobId = job.start(`Copy ${chosen.length} table(s) → ${[dst.database, dst.schema].filter(Boolean).join(".") || "target"}`);
    try {
      const n = await api.transferTables(src.connId, dst.connId, chosen, dst.database, dst.schema, { ...opts, jobId });
      job.finish(true, `Copied ${n.toLocaleString()} rows across ${chosen.length} table(s).`);
    } catch (e) {
      job.finish(false, `Transfer failed: ${errMsg(e)}`);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
      <Section title="Source">
        <TargetPicker value={src} onChange={setSrc} />
        <TableChecklist className="mt-2 h-64" tables={tables.data ?? []} loading={tables.loading} error={tables.error} selected={selected} onChange={setSelected}
          emptyText={src.connId ? "No tables found" : "Choose a connection"} />
      </Section>
      <div className="hidden items-center lg:flex"><ArrowRight className="size-5 text-faint" /></div>
      <Section title="Target">
        <TargetPicker value={dst} onChange={setTarget} />
        {same && dst.connId && <div className="mt-2 text-xs text-warn">Source and target are identical.</div>}
        <div className="mt-3">
          <Row label="Options">
            <div className="flex flex-col gap-1.5">
              <Checkbox label="Create tables that don't exist" checked={opts.createTables} onChange={(v) => set("createTables", v)} />
              <Checkbox label="Drop existing tables first" checked={opts.dropExisting} onChange={(v) => set("dropExisting", v)} />
              <Checkbox label="Empty existing tables first" checked={opts.truncate && !opts.dropExisting} onChange={(v) => set("truncate", v)} />
              <Checkbox label="Create indexes" checked={opts.indexes} onChange={(v) => set("indexes", v)} />
              <Checkbox label="Add foreign keys after copying" checked={opts.foreignKeys} onChange={(v) => set("foreignKeys", v)} />
              <Checkbox label="Skip tables that fail" checked={opts.continueOnError} onChange={(v) => set("continueOnError", v)} />
            </div>
          </Row>
          <Row label="Batch size">
            <Input type="number" min={1} max={100000} value={opts.batchSize} onChange={(e) => set("batchSize", Math.max(1, Number(e.target.value) || 1000))} className="w-28" />
          </Row>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={() => (opts.dropExisting || opts.truncate ? setConfirm(true) : run())} disabled={!canRun} loading={job.job.running}>
            <Play className="size-3.5" />Start transfer
          </Button>
        </div>
      </Section>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Overwrite target tables?" width={440}
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={run} autoFocus>Continue</Button></>}>
        <div className="flex gap-3 text-[13px]">
          <AlertTriangle className="size-5 shrink-0 text-warn" />
          <p>{opts.dropExisting ? "Existing tables in the target with the same names will be dropped and recreated." : "Existing rows in the target tables will be deleted."} {selected.size} table(s) affected.</p>
        </div>
      </Dialog>
    </div>
  );
}
