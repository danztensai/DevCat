import clsx from "clsx";
import { ArrowDown, ArrowUp, KeyRound, Plus, RotateCcw, Rows3, Trash2 } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { IconButton } from "../../../components/ui";
import type { Dialect, TableStructure } from "../../../lib/types";
import { defaultColumnType, typeSuggestions } from "../ddlGen";
import { CellCheck, CellInput, EditorBar, gridKeyNav, Td, Th } from "./cells";
import { columnStatus, defaultLength, newColumn, STATUS_ROW, type DColumn, type DesignState } from "./model";

interface Props {
  dialect: Dialect;
  state: DesignState;
  original: TableStructure | null;
  update: (fn: (s: DesignState) => DesignState) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  readOnly: boolean;
}

/** Replace a column name inside index / FK column lists after a rename. */
function renameRefs(s: DesignState, from: string, to: string): DesignState {
  if (!from || from === to) return s;
  const map = (cols: string[]) => cols.map((c) => (c === from ? to : c));
  return {
    ...s,
    indexes: s.indexes.map((i) => (i.columns.includes(from) ? { ...i, columns: map(i.columns) } : i)),
    foreignKeys: s.foreignKeys.map((f) => (f.columns.includes(from) ? { ...f, columns: map(f.columns) } : f)),
  };
}

export function ColumnsEditor({ dialect, state, original, update, selectedId, onSelect, readOnly }: Props) {
  const listId = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const focusNext = useRef<string | null>(null);
  const cols = state.columns;
  const selIdx = cols.findIndex((c) => c.id === selectedId);
  const sel = selIdx >= 0 ? cols[selIdx] : null;
  const hasComments = dialect !== "sqlite";

  useEffect(() => {
    if (!focusNext.current) return;
    const idx = cols.findIndex((c) => c.id === focusNext.current);
    focusNext.current = null;
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${idx}"][data-field="name"]`);
    el?.focus();
    el?.select();
  }, [cols]);

  const patch = (id: string, p: Partial<DColumn>) =>
    update((s) => {
      const prev = s.columns.find((c) => c.id === id);
      let next: DesignState = { ...s, columns: s.columns.map((c) => (c.id === id ? { ...c, ...p } : c)) };
      if (prev && p.name !== undefined) next = renameRefs(next, prev.name, p.name);
      return next;
    });

  const add = (at?: number) => {
    const taken = new Set(cols.map((c) => c.name));
    let n = cols.length + 1;
    while (taken.has(`column${n}`)) n++;
    const c = newColumn(`column${n}`, dialect === "sqlite" ? "TEXT" : dialect === "postgres" ? "text" : "varchar");
    update((s) => {
      const columns = [...s.columns];
      columns.splice(at ?? columns.length, 0, c);
      return { ...s, columns };
    });
    focusNext.current = c.id;
    onSelect(c.id);
  };

  const remove = () => {
    if (!sel) return;
    if (!sel.origName) {
      update((s) => ({ ...s, columns: s.columns.filter((c) => c.id !== sel.id) }));
      onSelect(cols[selIdx + 1]?.id ?? cols[selIdx - 1]?.id ?? null);
    } else patch(sel.id, { dropped: !sel.dropped });
  };

  const move = (dir: -1 | 1) => {
    if (selIdx < 0) return;
    const to = selIdx + dir;
    if (to < 0 || to >= cols.length) return;
    update((s) => {
      const columns = [...s.columns];
      [columns[selIdx], columns[to]] = [columns[to], columns[selIdx]];
      return { ...s, columns };
    });
  };

  const setType = (c: DColumn, type: string) => {
    const p: Partial<DColumn> = { type };
    if (!c.length && defaultLength(type)) p.length = defaultLength(type);
    patch(c.id, p);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar
        right={<span className="pr-1 text-[11px] text-faint">{cols.filter((c) => !c.dropped).length} columns · Alt+↑/↓ to reorder</span>}
      >
        <IconButton title="Add column" disabled={readOnly} onClick={() => add()}><Plus className="size-3.5" /></IconButton>
        <IconButton title="Insert column above selected" disabled={readOnly || !sel} onClick={() => add(selIdx)}><Rows3 className="size-3.5" /></IconButton>
        <IconButton title={sel?.dropped ? "Restore column" : "Remove column"} disabled={readOnly || !sel} onClick={remove}>
          {sel?.dropped ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
        </IconButton>
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton title="Move up" disabled={readOnly || selIdx <= 0} onClick={() => move(-1)}><ArrowUp className="size-3.5" /></IconButton>
        <IconButton title="Move down" disabled={readOnly || selIdx < 0 || selIdx >= cols.length - 1} onClick={() => move(1)}><ArrowDown className="size-3.5" /></IconButton>
      </EditorBar>
      <div className="min-h-0 flex-1 overflow-auto">
        <datalist id={listId}>{typeSuggestions(dialect).map((t) => <option key={t} value={t} />)}</datalist>
        <table
          ref={tableRef}
          className="w-full table-fixed border-separate border-spacing-0 text-[12px]"
          onKeyDown={(e) => {
            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !readOnly) {
              e.preventDefault();
              move(e.key === "ArrowUp" ? -1 : 1);
              return;
            }
            gridKeyNav(e, (r) => onSelect(cols[r]?.id ?? null));
          }}
        >
          <colgroup>
            <col className="w-9" />
            <col className="w-8" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
            <col className="w-20" />
            <col className="w-16" />
            <col className="w-[16%]" />
            <col className="w-12" />
            {hasComments && <col />}
          </colgroup>
          <thead>
            <tr>
              <Th className="text-right">#</Th>
              <Th title="Primary key">PK</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Length</Th>
              <Th title="NOT NULL">Not null</Th>
              <Th>Default</Th>
              <Th title="Auto increment / identity">A.I.</Th>
              {hasComments && <Th>Comment</Th>}
            </tr>
          </thead>
          <tbody>
            {cols.map((c, i) => {
              const status = columnStatus(dialect, c, original);
              const ro = readOnly || !!c.dropped;
              return (
                <tr
                  key={c.id}
                  onMouseDown={() => onSelect(c.id)}
                  onFocus={() => onSelect(c.id)}
                  className={clsx(STATUS_ROW[status], c.id === selectedId && "!bg-accent/10")}
                >
                  <Td className="pr-1.5 text-right font-mono text-[11px] text-faint">{i + 1}</Td>
                  <Td>
                    <button
                      type="button"
                      title={c.isPrimaryKey ? "Primary key (click to remove)" : "Make primary key"}
                      disabled={ro}
                      data-row={i}
                      data-field="pk"
                      onClick={() => patch(c.id, c.isPrimaryKey ? { isPrimaryKey: false } : { isPrimaryKey: true, nullable: false })}
                      className="flex h-[26px] w-full items-center justify-center hover:bg-hover disabled:pointer-events-none"
                    >
                      <KeyRound className={clsx("size-3.5", c.isPrimaryKey ? "text-accent" : "text-line")} />
                    </button>
                  </Td>
                  <Td>
                    <CellInput row={i} field="name" disabled={ro} value={c.name} onChange={(e) => patch(c.id, { name: e.target.value })}
                      className={clsx(!c.name.trim() && "shadow-[inset_0_0_0_1px_var(--color-danger)]")} />
                  </Td>
                  <Td>
                    <CellInput row={i} field="type" disabled={ro} list={listId} value={c.type} placeholder={defaultColumnType(dialect)}
                      onChange={(e) => setType(c, e.target.value)} />
                  </Td>
                  <Td><CellInput row={i} field="length" disabled={ro} value={c.length} onChange={(e) => patch(c.id, { length: e.target.value })} /></Td>
                  <Td>
                    <CellCheck row={i} field="notnull" disabled={ro} checked={!c.nullable} onChange={(v) => patch(c.id, { nullable: !v })} />
                  </Td>
                  <Td>
                    <CellInput row={i} field="default" disabled={ro} value={c.default} placeholder={c.nullable ? "NULL" : ""}
                      onChange={(e) => patch(c.id, { default: e.target.value })} />
                  </Td>
                  <Td>
                    <CellCheck row={i} field="ai" disabled={ro} checked={c.autoIncrement} onChange={(v) => patch(c.id, { autoIncrement: v })} />
                  </Td>
                  {hasComments && (
                    <Td><CellInput row={i} field="comment" disabled={ro} value={c.comment} className="font-sans" onChange={(e) => patch(c.id, { comment: e.target.value })} /></Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!readOnly && (
          <button
            onClick={() => add()}
            className="flex h-7 w-full items-center gap-1.5 px-3 text-left text-[12px] text-faint hover:bg-hover hover:text-fg"
          >
            <Plus className="size-3.5" /> Add column
          </button>
        )}
      </div>
    </div>
  );
}
