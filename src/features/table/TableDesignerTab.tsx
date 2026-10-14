// Table designer: edit columns / indexes / foreign keys / options of a table (or create one)
// and apply the generated CREATE / ALTER script.
import clsx from "clsx";
import { Lock, RefreshCw, Save, Table2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Empty, ErrorBox, Field, Input, Spinner, Textarea, Toolbar } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import { dialectOf, type TableRef, type TableStructure } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { useTabs } from "../../store/tabs";
import type { Tab } from "../../tabs/types";
import { confirmDialog } from "../connections/dialogs";
import { openQuery } from "../connections/openers";
import { defaultColumnType, generateAlterTable, generateCreateTable, isCommentOnly, toExecutableScript, toScript } from "./ddlGen";
import { ColumnsEditor } from "./designer/ColumnsEditor";
import { ForeignKeysEditor, type RefTable } from "./designer/ForeignKeysEditor";
import { IndexesEditor } from "./designer/IndexesEditor";
import { fromStructure, newColumn, toDesignStructure, validate, type DesignState } from "./designer/model";
import { SqlPreview } from "./designer/SqlPreview";
import { defaultSchema } from "./sqlDialect";

type DesignTab = Extract<Tab, { type: "table-design" }>;
type Sub = "columns" | "indexes" | "fks" | "options" | "sql";

function newTableState(dialect: ReturnType<typeof dialectOf>): DesignState {
  return {
    name: "new_table",
    comment: "",
    columns: [newColumn("id", defaultColumnType(dialect), { isPrimaryKey: true, nullable: false, autoIncrement: true })],
    indexes: [],
    foreignKeys: [],
  };
}

export default function TableDesignerTab({ tab }: { tab: DesignTab }) {
  const conn = useConnections((s) => s.connections.find((c) => c.id === tab.connId));
  const dialect = conn ? dialectOf(conn.kind) : "none";
  const readOnly = !!conn?.readOnly;
  const table = tab.table ?? null;
  const isNew = !table;
  const database = table?.database ?? tab.database ?? null;
  const schema = table?.schema ?? tab.schema ?? (conn ? defaultSchema(conn.kind) : null);
  const tableKey = table ? `${table.database ?? ""}.${table.schema ?? ""}.${table.name}` : "";

  const [original, setOriginal] = useState<TableStructure | null>(null);
  const [state, setState] = useState<DesignState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub>("columns");
  const [selectedCol, setSelectedCol] = useState<string | null>(null);
  const [refTables, setRefTables] = useState<RefTable[] | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setSaveError(null);
    if (!table) {
      setOriginal(null);
      setState(dialect === "none" ? null : newTableState(dialect));
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const s = await api.tableStructure(tab.connId, table);
      setOriginal(s);
      setState(fromStructure(s, table.name));
    } catch (e) {
      setLoadError(errMsg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.connId, tableKey, dialect]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isNew && state) setTimeout(() => nameInput.current?.select(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, !!state]);

  const loadRefs = useCallback(async () => {
    setRefLoading(true);
    setRefError(null);
    try {
      const snap = await api.schemaSnapshot(tab.connId, database, schema);
      setRefTables(
        snap.tables
          .filter((t) => t.table)
          .map((t) => {
            const cols = [...t.columns].sort((a, b) => a.ordinal - b.ordinal);
            return {
              schema: t.table!.schema ?? null,
              name: t.table!.name,
              columns: cols.map((c) => c.name),
              primaryKey: t.indexes.find((i) => i.primary)?.columns ?? cols.filter((c) => c.isPrimaryKey).map((c) => c.name),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e) {
      setRefError(errMsg(e));
    } finally {
      setRefLoading(false);
    }
  }, [tab.connId, database, schema]);

  useEffect(() => {
    if (sub === "fks" && refTables === null && !refLoading && !refError) loadRefs();
  }, [sub, refTables, refLoading, refError, loadRefs]);

  const update = useCallback((fn: (s: DesignState) => DesignState) => setState((s) => (s ? fn(s) : s)), []);

  const ref: TableRef = table ?? { database, schema, name: state?.name.trim() || "new_table" };
  const statements = useMemo(() => {
    if (!state || dialect === "none") return [];
    const design = toDesignStructure(state, ref);
    if (isNew) return state.name.trim() ? generateCreateTable(dialect, { database, schema, name: state.name.trim() }, design) : [];
    return original ? generateAlterTable(dialect, original, design, table!) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, original, dialect, isNew, database, schema, tableKey]);

  const script = useMemo(() => toScript(statements), [statements]);
  const changeCount = statements.filter((s) => !isCommentOnly(s)).length;
  const problems = useMemo(() => (state ? validate(state) : []), [state]);
  const dirty = isNew ? !!state : changeCount > 0;

  useEffect(() => {
    if (!!tab.dirty !== dirty) useTabs.getState().update(tab.id, { dirty });
  }, [dirty, tab.dirty, tab.id]);

  const save = async () => {
    if (!state || saving || readOnly) return;
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    const exec = toExecutableScript(statements);
    if (!exec) return;
    const destructive = /\bDROP\s+(TABLE|COLUMN)\b/i.test(exec);
    const ok = await confirmDialog({
      title: isNew ? `Create table ${state.name.trim()}` : `Alter table ${table!.name}`,
      message: destructive
        ? <span className="text-warn">This script drops columns or tables. Data in them will be lost.</span>
        : "The following SQL will be executed:",
      code: script,
      confirmLabel: "Execute",
      danger: destructive,
    });
    if (!ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.execute(tab.connId, exec, { database, schema });
      const newName = state.name.trim();
      toast.success(isNew ? `Created table ${newName}` : `Table ${newName} updated`);
      if (isNew || newName !== table!.name) {
        useTabs.getState().update(tab.id, { table: { database, schema, name: newName }, title: `Design ${newName}` } as Partial<Tab>);
      } else {
        await load();
      }
    } catch (e) {
      setSaveError(errMsg(e));
      setSub("sql");
      toast.error("Failed to apply changes");
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (dirty && !isNew && !(await confirmDialog({ title: "Discard changes?", message: "All unsaved edits to this table will be lost.", confirmLabel: "Discard", danger: true }))) return;
    setSaveError(null);
    if (original && table) setState(fromStructure(original, table.name));
    else setState(newTableState(dialect));
  };

  const reload = async () => {
    if (dirty && !isNew && !(await confirmDialog({ title: "Reload structure?", message: "Unsaved edits will be lost.", confirmLabel: "Reload", danger: true }))) return;
    setRefTables(null);
    setRefError(null);
    load();
  };

  if (conn && dialect === "none") {
    return <Empty icon={<Table2 className="size-8" />} title="Table designer unavailable">The designer supports PostgreSQL, MySQL, SQLite and SQL Server.</Empty>;
  }
  if (loadError) {
    return (
      <div className="flex h-full flex-col">
        <ErrorBox error={loadError} />
        <div className="px-3"><Button onClick={load}><RefreshCw className="size-3.5" /> Retry</Button></div>
      </div>
    );
  }
  if (!state || loading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const subs: { id: Sub; label: string; count?: number }[] = [
    { id: "columns", label: "Columns", count: state.columns.filter((c) => !c.dropped).length },
    { id: "indexes", label: "Indexes", count: state.indexes.filter((i) => !i.dropped).length },
    { id: "fks", label: "Foreign Keys", count: state.foreignKeys.filter((f) => !f.dropped).length },
    { id: "options", label: "Options" },
    { id: "sql", label: "SQL Preview", count: changeCount },
  ];

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      }}
    >
      <Toolbar className="gap-1.5">
        <span className="pl-1 text-xs text-muted">Table</span>
        <input
          ref={nameInput}
          spellCheck={false}
          value={state.name}
          onChange={(e) => update((s) => ({ ...s, name: e.target.value }))}
          className={clsx(
            "h-6 w-52 rounded-md border bg-app px-2 font-mono text-xs text-fg focus:border-accent focus:outline-none",
            state.name.trim() ? "border-line" : "border-danger",
          )}
        />
        <div className="mx-1 h-4 w-px bg-line" />
        <Button size="sm" variant="primary" loading={saving} disabled={readOnly || !changeCount || problems.length > 0}
          title={readOnly ? "Connection is read-only" : problems[0] ?? "Save (⌘S)"} onClick={save}>
          <Save className="size-3.5" /> {isNew ? "Create" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={discard}><Undo2 className="size-3.5" /> Discard</Button>
        {!isNew && <Button size="sm" variant="ghost" disabled={saving} onClick={reload}><RefreshCw className="size-3.5" /> Reload</Button>}
        <div className="flex-1" />
        {readOnly && <Badge tone="warn"><Lock className="mr-1 size-3" /> read-only connection</Badge>}
        <span className="truncate text-[11px] text-faint">
          {[conn?.name, database, schema].filter(Boolean).join(" / ")}
        </span>
        {changeCount > 0 && <Badge tone="warn">{changeCount} pending</Badge>}
      </Toolbar>

      <div className="flex h-8 shrink-0 items-end gap-0.5 border-b border-line bg-app px-2">
        {subs.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={clsx(
              "flex h-7 items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-xs",
              sub === s.id ? "border-line bg-panel text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {s.label}
            {s.count !== undefined && (
              <span className={clsx("rounded px-1 text-[10px]", s.id === "sql" && s.count > 0 ? "bg-warn/20 text-warn" : "bg-hover text-faint")}>{s.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {sub === "columns" && (
          <ColumnsEditor dialect={dialect} state={state} original={original} update={update}
            selectedId={selectedCol} onSelect={setSelectedCol} readOnly={false} />
        )}
        {sub === "indexes" && <IndexesEditor dialect={dialect} state={state} original={original} update={update} readOnly={false} />}
        {sub === "fks" && (
          <ForeignKeysEditor state={state} original={original} update={update} readOnly={false}
            refTables={refTables} refLoading={refLoading} refError={refError} onReloadRefs={loadRefs} />
        )}
        {sub === "options" && (
          <div className="max-w-xl space-y-3 p-4">
            <Field label="Table name">
              <Input value={state.name} onChange={(e) => update((s) => ({ ...s, name: e.target.value }))} className="font-mono" />
            </Field>
            <Field label="Comment" hint={dialect === "sqlite" ? "SQLite does not support table comments" : undefined}>
              <Textarea rows={4} disabled={dialect === "sqlite"} value={state.comment} className="font-sans! text-[13px]!"
                onChange={(e) => update((s) => ({ ...s, comment: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-[110px_1fr] gap-y-1 pt-2 text-xs">
              <span className="text-muted">Connection</span><span>{conn?.name ?? tab.connId}</span>
              {database && <><span className="text-muted">Database</span><span className="font-mono">{database}</span></>}
              {schema && <><span className="text-muted">Schema</span><span className="font-mono">{schema}</span></>}
              <span className="text-muted">Dialect</span><span>{dialect}</span>
            </div>
          </div>
        )}
        {sub === "sql" && (
          <SqlPreview
            script={script}
            problems={problems}
            saveError={saveError}
            onOpenInQuery={() => openQuery(tab.connId, { database, schema, initialSql: script })}
          />
        )}
      </div>
      {readOnly && (
        <div className="shrink-0 border-t border-line bg-warn/10 px-3 py-1 text-[11px] text-warn">
          This connection is read-only: you can preview the generated SQL but not apply it.
        </div>
      )}
    </div>
  );
}
