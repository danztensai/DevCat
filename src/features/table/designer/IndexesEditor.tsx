import clsx from "clsx";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { IconButton } from "../../../components/ui";
import type { Dialect, TableStructure } from "../../../lib/types";
import { indexMethods } from "../ddlGen";
import { CellCheck, CellInput, ColumnsPicker, EditorBar, gridKeyNav, Td, Th } from "./cells";
import { indexStatus, renameMap, STATUS_ROW, uid, type DesignState, type DIndex } from "./model";

interface Props {
  dialect: Dialect;
  state: DesignState;
  original: TableStructure | null;
  update: (fn: (s: DesignState) => DesignState) => void;
  readOnly: boolean;
}

const autoName = (table: string, cols: string[], unique: boolean) =>
  `${table || "t"}_${cols.length ? cols.join("_") : "col"}_${unique ? "key" : "idx"}`;

export function IndexesEditor({ dialect, state, original, update, readOnly }: Props) {
  const methodsId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const columns = state.columns.filter((c) => !c.dropped).map((c) => c.name).filter(Boolean);
  const renames = renameMap(state);
  const sel = state.indexes.find((i) => i.id === selectedId) ?? null;
  const methods = indexMethods(dialect);

  const patch = (id: string, p: Partial<DIndex>) =>
    update((s) => ({
      ...s,
      indexes: s.indexes.map((i) => {
        if (i.id !== id) return i;
        const next = { ...i, ...p };
        // Keep generated names in sync while the user hasn't customised them.
        if (!i.origName && (p.columns || p.unique !== undefined) && i.name === autoName(s.name, i.columns, i.unique)) {
          next.name = autoName(s.name, next.columns, next.unique);
        }
        return next;
      }),
    }));

  const add = () => {
    const idx: DIndex = { id: uid(), origName: null, name: autoName(state.name, [], false), columns: [], unique: false, method: "" };
    update((s) => ({ ...s, indexes: [...s.indexes, idx] }));
    setSelectedId(idx.id);
  };

  const remove = () => {
    if (!sel) return;
    if (!sel.origName) {
      update((s) => ({ ...s, indexes: s.indexes.filter((i) => i.id !== sel.id) }));
      setSelectedId(null);
    } else patch(sel.id, { dropped: !sel.dropped });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar right={<span className="pr-1 text-[11px] text-faint">Primary key is set on the Columns tab</span>}>
        <IconButton title="Add index" disabled={readOnly} onClick={add}><Plus className="size-3.5" /></IconButton>
        <IconButton title={sel?.dropped ? "Restore index" : "Remove index"} disabled={readOnly || !sel} onClick={remove}>
          {sel?.dropped ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
        </IconButton>
      </EditorBar>
      <div className="min-h-0 flex-1 overflow-auto">
        <datalist id={methodsId}>{methods.map((m) => <option key={m} value={m} />)}</datalist>
        <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]" onKeyDown={(e) => gridKeyNav(e)}>
          <colgroup>
            <col className="w-[30%]" />
            <col />
            <col className="w-16" />
            {methods.length > 0 && <col className="w-36" />}
          </colgroup>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Columns</Th>
              <Th>Unique</Th>
              {methods.length > 0 && <Th>Method</Th>}
            </tr>
          </thead>
          <tbody>
            {state.indexes.map((ix, i) => {
              const status = indexStatus(ix, original, renames);
              const ro = readOnly || !!ix.dropped;
              return (
                <tr key={ix.id} onMouseDown={() => setSelectedId(ix.id)} onFocus={() => setSelectedId(ix.id)}
                  className={clsx(STATUS_ROW[status], ix.id === selectedId && "!bg-accent/10")}>
                  <Td><CellInput row={i} field="name" disabled={ro} value={ix.name} onChange={(e) => patch(ix.id, { name: e.target.value })} /></Td>
                  <Td><ColumnsPicker row={i} field="cols" disabled={ro} value={ix.columns} options={columns} onChange={(v) => patch(ix.id, { columns: v })} /></Td>
                  <Td><CellCheck row={i} field="unique" disabled={ro} checked={ix.unique} onChange={(v) => patch(ix.id, { unique: v })} /></Td>
                  {methods.length > 0 && (
                    <Td><CellInput row={i} field="method" disabled={ro} list={methodsId} value={ix.method} placeholder="default" onChange={(e) => patch(ix.id, { method: e.target.value })} /></Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!state.indexes.length && <div className="px-3 py-6 text-center text-xs text-faint">No indexes</div>}
        {!readOnly && (
          <button onClick={add} className="flex h-7 w-full items-center gap-1.5 px-3 text-left text-[12px] text-faint hover:bg-hover hover:text-fg">
            <Plus className="size-3.5" /> Add index
          </button>
        )}
      </div>
    </div>
  );
}
