// Monaco SQL script viewer with Copy / Save / Execute-on-target actions.
import Editor from "@monaco-editor/react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Copy, Play, RotateCcw, Save, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { QueryResult } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { saveContent } from "../transfer/files";

export function ScriptPanel({ script, onChange, target, fileName, title = "Sync script", onRegenerate, dirty }: {
  script: string;
  onChange: (s: string) => void;
  target: { connId: string; database: string | null; schema: string | null };
  fileName: string;
  title?: string;
  onRegenerate?: () => void;
  /** script was hand-edited */
  dirty?: boolean;
}) {
  const conn = useConnections((s) => s.connections.find((c) => c.id === target.connId));
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ ok: boolean; results?: QueryResult[]; error?: string } | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      toast.success("Script copied to clipboard");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const saveFile = async () => {
    try {
      const p = await saveContent({ defaultName: fileName, filters: [{ name: "SQL script", extensions: ["sql"] }], content: script, dirKey: "compare-sql", mime: "text/plain" });
      if (p) toast.success(p === "download" ? "Script downloaded" : `Saved to ${p}`);
    } catch (e) {
      toast.error(`Save failed: ${errMsg(e)}`);
    }
  };
  const execute = async () => {
    setConfirm(false);
    setRunning(true);
    setResults(null);
    try {
      const res = await api.execute(target.connId, script, { database: target.database, schema: target.schema });
      setResults({ ok: true, results: res });
      toast.success(`Executed ${res.length} statement${res.length === 1 ? "" : "s"} on ${conn?.name ?? "target"}`);
    } catch (e) {
      setResults({ ok: false, error: errMsg(e) });
      toast.error("Execution failed");
    } finally {
      setRunning(false);
    }
  };

  const lines = script.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).length;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</span>
        {dirty && <span className="text-[11px] text-warn">· edited</span>}
        <div className="flex-1" />
        {onRegenerate && (
          <Button size="sm" variant="ghost" onClick={onRegenerate} title="Regenerate from current selection (discards edits)">
            <RotateCcw className="size-3.5" />Regenerate
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={copy} disabled={!lines}><Copy className="size-3.5" />Copy</Button>
        <Button size="sm" variant="ghost" onClick={saveFile} disabled={!lines}><Save className="size-3.5" />Save .sql</Button>
        <Button size="sm" variant="primary" onClick={() => setConfirm(true)} disabled={!lines || !target.connId || conn?.readOnly} loading={running}
          title={conn?.readOnly ? "Target connection is read-only" : undefined}>
          <Play className="size-3.5" />Execute on target
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          language="sql"
          theme="devcat"
          value={script}
          onChange={(v) => onChange(v ?? "")}
          options={{ minimap: { enabled: false }, fontSize: 12, lineNumbersMinChars: 3, scrollBeyondLastLine: false, wordWrap: "off", automaticLayout: true, renderWhitespace: "none" }}
        />
      </div>
      {results && (
        <div className="max-h-40 shrink-0 overflow-auto border-t border-line bg-app font-mono text-[11.5px]">
          {results.error && (
            <div className="selectable flex gap-2 p-2 text-danger"><XCircle className="mt-0.5 size-3.5 shrink-0" /><span className="whitespace-pre-wrap">{results.error}</span></div>
          )}
          {results.results?.map((r, i) => (
            <div key={i} className="flex items-start gap-2 border-b border-line/50 px-2 py-1">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" />
              <span className="min-w-0 flex-1 truncate text-fg/80" title={r.statement}>{r.statement.replace(/\s+/g, " ")}</span>
              <span className="shrink-0 text-muted">
                {r.rowsAffected != null ? `${r.rowsAffected} rows` : r.message ?? ""} · {r.elapsedMs} ms
              </span>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Execute script on target?"
        width={460}
        footer={<>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={execute} autoFocus><Play className="size-3.5" />Execute</Button>
        </>}
      >
        <div className="flex gap-3 text-[13px]">
          <AlertTriangle className="size-5 shrink-0 text-warn" />
          <div className="space-y-2">
            <p>This will run <b>{lines}</b> line{lines === 1 ? "" : "s"} of SQL against:</p>
            <div className={clsx("rounded border border-line bg-app px-2 py-1.5 font-mono text-xs")}>
              {conn?.name ?? target.connId}{target.database ? ` / ${target.database}` : ""}{target.schema ? ` / ${target.schema}` : ""}
            </div>
            <p className="text-muted">Schema changes may not be reversible. Review the script and make sure you have a backup.</p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
