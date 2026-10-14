import clsx from "clsx";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { IconButton, Spinner } from "../../../components/ui";
import type { TableStructure } from "../../../lib/types";
import { FK_ACTIONS } from "../ddlGen";
import { CellInput, ColumnsPicker, EditorBar, gridKeyNav, Td, Th } from "./cells";
import { fkStatus, renameMap, STATUS_ROW, uid, type DesignState, type DForeignKey } from "./model";

export interface RefTable { schema: string | null; name: string; columns: string[]; primaryKey: string[] }

interface Props {
  state: DesignState;
  original: TableStructure | null;
  update: (fn: (s: DesignState) => DesignState) => void;
  readOnly: boolean;
  refTables: RefTable[] | null;
  refLoading: boolean;
  refError: string | null;
  onReloadRefs: () => void;
}

const selectCls =
  "h-[26px] w-full min-w-0 bg-transparent px-1 font-mono text-[12px] text-inherit outline-none focus:bg-app focus:shadow-[inset_0_0_0_1px_var(--color-accent)] disabled:text-faint";

export function ForeignKeysEditor({ state, original, update, readOnly, refTables, refLoading, refError, onReloadRefs }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const columns = state.columns.filter((c) => !c.dropped).map((c) => c.name).filter(Boolean);
  const renames = renameMap(state);
  const sel = state.foreignKeys.find((f) => f.id === selectedId) ?? null;

  const patch = (id: string, p: Partial<DForeignKey>) =>
    update((s) => ({ ...s, foreignKeys: s.foreignKeys.map((f) => (f.id === id ? { ...f, ...p } : f)) }));

  const add = () => {
    const taken = new Set(state.foreignKeys.map((f) => f.name));
    let n = 1;
    while (taken.has(`fk_${state.name}_${n}`)) n++;
    const fk: DForeignKey = {
      id: uid(), origName: null, name: `fk_${state.name || "t"}_${n}`, columns: [], refSchema: null, refTable: "",
      refColumns: [], onUpdate: "", onDelete: "",
    };
    update((s) => ({ ...s, foreignKeys: [...s.foreignKeys, fk] }));
    setSelectedId(fk.id);
  };

  const remove = () => {
    if (!sel) return;
    if (!sel.origName) {
      update((s) => ({ ...s, foreignKeys: s.foreignKeys.filter((f) => f.id !== sel.id) }));
      setSelectedId(null);
    } else patch(sel.id, { dropped: !sel.dropped });
  };

  const pickRefTable = (fk: DForeignKey, key: string) => {
    const t = refTables?.find((r) => refKey(r) === key);
    if (!t) return patch(fk.id, { refTable: "", refSchema: null, refColumns: [] });
    const p: Partial<DForeignKey> = { refTable: t.name, refSchema: t.schema, refColumns: t.primaryKey.length ? [...t.primaryKey] : [] };
    if (!fk.origName && /^fk_.*_\d+$/.test(fk.name)) p.name = `fk_${state.name}_${t.name}`;
    patch(fk.id, p);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar
        right={
          <span className="flex items-center gap-2 pr-1 text-[11px] text-faint">
            {refLoading && <><Spinner className="size-3" /> loading tables…</>}
            {refError && <button className="text-danger hover:underline" title={refError} onClick={onReloadRefs}>Could not load tables — retry</button>}
          </span>
        }
      >
        <IconButton title="Add foreign key" disabled={readOnly} onClick={add}><Plus className="size-3.5" /></IconButton>
        <IconButton title={sel?.dropped ? "Restore foreign key" : "Remove foreign key"} disabled={readOnly || !sel} onClick={remove}>
          {sel?.dropped ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
        </IconButton>
      </EditorBar>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]" onKeyDown={(e) => gridKeyNav(e)}>
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[17%]" />
            <col className="w-[20%]" />
            <col className="w-[17%]" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Columns</Th>
              <Th>Referenced table</Th>
              <Th>Referenced columns</Th>
              <Th>On update</Th>
              <Th>On delete</Th>
            </tr>
          </thead>
          <tbody>
            {state.foreignKeys.map((fk, i) => {
              const status = fkStatus(fk, original, renames);
              const ro = readOnly || !!fk.dropped;
              const current = refKey({ schema: fk.refSchema, name: fk.refTable });
              const ref = refTables?.find((r) => refKey(r) === current) ?? refTables?.find((r) => r.name === fk.refTable);
              return (
                <tr key={fk.id} onMouseDown={() => setSelectedId(fk.id)} onFocus={() => setSelectedId(fk.id)}
                  className={clsx(STATUS_ROW[status], fk.id === selectedId && "!bg-accent/10")}>
                  <Td><CellInput row={i} field="name" disabled={ro} value={fk.name} onChange={(e) => patch(fk.id, { name: e.target.value })} /></Td>
                  <Td><ColumnsPicker row={i} field="cols" disabled={ro} value={fk.columns} options={columns} onChange={(v) => patch(fk.id, { columns: v })} /></Td>
                  <Td>
                    <select data-row={i} data-field="ref" disabled={ro} className={selectCls}
                      value={ref ? refKey(ref) : fk.refTable ? current : ""} onChange={(e) => pickRefTable(fk, e.target.value)}>
                      <option value="">{refTables ? "choose…" : fk.refTable || "choose…"}</option>
                      {fk.refTable && !ref && <option value={current}>{fk.refTable}</option>}
                      {refTables?.map((r) => <option key={refKey(r)} value={refKey(r)}>{r.schema ? `${r.schema}.${r.name}` : r.name}</option>)}
                    </select>
                  </Td>
                  <Td>
                    <ColumnsPicker row={i} field="refcols" disabled={ro} value={fk.refColumns} options={ref?.columns ?? []}
                      onChange={(v) => patch(fk.id, { refColumns: v })} />
                  </Td>
                  <Td><ActionSelect row={i} field="upd" disabled={ro} value={fk.onUpdate} onChange={(v) => patch(fk.id, { onUpdate: v })} /></Td>
                  <Td><ActionSelect row={i} field="del" disabled={ro} value={fk.onDelete} onChange={(v) => patch(fk.id, { onDelete: v })} /></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!state.foreignKeys.length && <div className="px-3 py-6 text-center text-xs text-faint">No foreign keys</div>}
        {!readOnly && (
          <button onClick={add} className="flex h-7 w-full items-center gap-1.5 px-3 text-left text-[12px] text-faint hover:bg-hover hover:text-fg">
            <Plus className="size-3.5" /> Add foreign key
          </button>
        )}
      </div>
    </div>
  );
}

const refKey = (r: { schema: string | null; name: string }) => `${r.schema ?? ""}\u0000${r.name}`;

function ActionSelect({ value, onChange, disabled, row, field }: { value: string; onChange: (v: string) => void; disabled?: boolean; row: number; field: string }) {
  const v = value || "NO ACTION";
  const known = FK_ACTIONS.find((a) => a.toLowerCase() === v.toLowerCase());
  return (
    <select data-row={row} data-field={field} disabled={disabled} className={selectCls}
      value={known ?? v}
      onChange={(e) => onChange(e.target.value === "NO ACTION" ? "" : e.target.value)}>
      {!known && <option value={v}>{v}</option>}
      {FK_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
}
