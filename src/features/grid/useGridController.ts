// State behind a DataGrid: view order (client sort), cell selection and pending edits.
// Parents that need toolbar buttons (add/delete/commit) create the controller themselves
// with useGridController() and pass it to <DataGrid controller={ctl} />.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CellValue, ColumnInfo, RowChange, SortSpec } from "../../lib/types";
import { compareValues } from "./format";

export interface CellPos { r: number; c: number }
/** Rectangular selection in view coordinates. */
export interface GridSelection { anchor: CellPos; focus: CellPos }

interface Edits {
  /** existing data row -> column -> new value */
  updates: Map<number, Map<number, CellValue>>;
  deleted: Set<number>;
  /** new rows; columns absent from the map use the column default */
  inserted: Map<number, CellValue>[];
}

const emptyEdits = (): Edits => ({ updates: new Map(), deleted: new Set(), inserted: [] });

export interface GridControllerOptions {
  columns: ColumnInfo[];
  rows: CellValue[][];
  primaryKey?: string[];
  editable?: boolean;
  /** Controlled sort. When `onSortChange` is given the grid does not sort client-side. */
  sort?: SortSpec[];
  onSortChange?: (sort: SortSpec[]) => void;
}

export type GridController = ReturnType<typeof useGridController>;

export function useGridController(o: GridControllerOptions) {
  const { columns, rows } = o;
  const [edits, setEdits] = useState<Edits>(emptyEdits);
  const [sel, setSel] = useState<GridSelection | null>(null);
  const [localSort, setLocalSort] = useState<SortSpec[]>([]);

  // New data invalidates pending edits and selection.
  useEffect(() => { setEdits(emptyEdits()); setSel(null); }, [rows, columns]);

  const pkIdx = useMemo(() => (o.primaryKey ?? []).map((k) => columns.findIndex((c) => c.name === k)), [o.primaryKey, columns]);
  const canEdit = !!o.editable && pkIdx.length > 0 && pkIdx.every((i) => i >= 0);

  const serverSort = !!o.onSortChange;
  const sort = serverSort ? o.sort ?? [] : localSort;

  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (!serverSort && localSort.length) {
      const specs = localSort.map((s) => ({ i: columns.findIndex((c) => c.name === s.column), desc: s.desc })).filter((s) => s.i >= 0);
      idx.sort((a, b) => {
        for (const s of specs) {
          const d = compareValues(rows[a][s.i], rows[b][s.i]);
          if (d) return s.desc ? -d : d;
        }
        return a - b;
      });
    }
    for (let i = 0; i < edits.inserted.length; i++) idx.push(rows.length + i);
    return idx;
  }, [rows, columns, localSort, serverSort, edits.inserted.length]);

  const setSort = useCallback((next: SortSpec[]) => {
    if (o.onSortChange) o.onSortChange(next);
    else setLocalSort(next);
  }, [o.onSortChange]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Value at a data index (after edits). `undefined` = unset column of a new row. */
  const value = useCallback((d: number, c: number): CellValue | undefined => {
    if (d >= rows.length) return edits.inserted[d - rows.length]?.get(c);
    const u = edits.updates.get(d);
    if (u && u.has(c)) return u.get(c) as CellValue;
    return rows[d]?.[c];
  }, [rows, edits]);

  const isModified = useCallback((d: number, c: number) => d < rows.length && !!edits.updates.get(d)?.has(c), [rows, edits]);
  const isInserted = useCallback((d: number) => d >= rows.length, [rows]);
  const isDeleted = useCallback((d: number) => edits.deleted.has(d), [edits]);

  const setCell = useCallback((d: number, c: number, v: CellValue) => {
    setEdits((e) => {
      if (d >= rows.length) {
        const inserted = e.inserted.slice();
        const m = new Map(inserted[d - rows.length]);
        m.set(c, v);
        inserted[d - rows.length] = m;
        return { ...e, inserted };
      }
      const updates = new Map(e.updates);
      const m = new Map(updates.get(d));
      if (sameValue(rows[d][c], v)) m.delete(c); else m.set(c, v);
      if (m.size) updates.set(d, m); else updates.delete(d);
      return { ...e, updates };
    });
  }, [rows]);

  const addRow = useCallback((values?: Map<number, CellValue>) => {
    setEdits((e) => ({ ...e, inserted: [...e.inserted, values ?? new Map()] }));
  }, []);

  /** Duplicate rows (data indexes) as new rows, skipping primary key columns. */
  const duplicateRows = useCallback((ds: number[]) => {
    setEdits((e) => {
      const add = ds.map((d) => {
        const m = new Map<number, CellValue>();
        columns.forEach((_, c) => {
          if (pkIdx.includes(c)) return;
          const v = d >= rows.length ? e.inserted[d - rows.length]?.get(c) : (e.updates.get(d)?.has(c) ? e.updates.get(d)!.get(c) : rows[d][c]);
          if (v !== undefined) m.set(c, v as CellValue);
        });
        return m;
      });
      return { ...e, inserted: [...e.inserted, ...add] };
    });
  }, [columns, rows, pkIdx]);

  /** Mark existing rows deleted (toggle) and drop new rows outright. */
  const deleteRows = useCallback((ds: number[]) => {
    setEdits((e) => {
      const deleted = new Set(e.deleted);
      const existing = ds.filter((d) => d < rows.length);
      const allDeleted = existing.length > 0 && existing.every((d) => deleted.has(d));
      for (const d of existing) { if (allDeleted) deleted.delete(d); else deleted.add(d); }
      const dropNew = new Set(ds.filter((d) => d >= rows.length).map((d) => d - rows.length));
      const inserted = e.inserted.filter((_, i) => !dropNew.has(i));
      return { ...e, deleted, inserted };
    });
    if (ds.some((d) => d >= rows.length)) setSel(null);
  }, [rows]);

  const discard = useCallback(() => setEdits(emptyEdits()), []);

  const pendingCount = edits.updates.size + edits.deleted.size + edits.inserted.length;

  const buildChanges = useCallback((): RowChange[] => {
    const keyOf = (d: number) => Object.fromEntries(pkIdx.map((i) => [columns[i].name, rows[d][i]]));
    const out: RowChange[] = [];
    for (const d of [...edits.deleted].sort((a, b) => a - b)) out.push({ op: "delete", key: keyOf(d) });
    for (const [d, m] of edits.updates) {
      if (edits.deleted.has(d)) continue;
      out.push({ op: "update", key: keyOf(d), values: Object.fromEntries([...m].map(([c, v]) => [columns[c].name, v])) });
    }
    for (const m of edits.inserted) {
      out.push({ op: "insert", values: Object.fromEntries([...m].map(([c, v]) => [columns[c].name, v])) });
    }
    return out;
  }, [edits, pkIdx, columns, rows]);

  const rowCount = order.length;

  /** Normalized selection rectangle. */
  const range = useMemo(() => {
    if (!sel) return null;
    return {
      r0: Math.min(sel.anchor.r, sel.focus.r), r1: Math.max(sel.anchor.r, sel.focus.r),
      c0: Math.min(sel.anchor.c, sel.focus.c), c1: Math.max(sel.anchor.c, sel.focus.c),
    };
  }, [sel]);

  /** Data indexes of rows touched by the selection. */
  const selectedDataRows = useCallback((): number[] => {
    if (!range) return [];
    const out: number[] = [];
    for (let r = range.r0; r <= range.r1 && r < order.length; r++) out.push(order[r]);
    return out;
  }, [range, order]);

  /** Values of the selected block (or the whole grid). */
  const selectedBlock = useCallback((all = false) => {
    const r0 = all || !range ? 0 : range.r0, r1 = all || !range ? order.length - 1 : range.r1;
    const c0 = all || !range ? 0 : range.c0, c1 = all || !range ? columns.length - 1 : range.c1;
    const cols = columns.slice(c0, c1 + 1);
    const out: CellValue[][] = [];
    for (let r = r0; r <= r1; r++) {
      const d = order[r];
      const row: CellValue[] = [];
      for (let c = c0; c <= c1; c++) row.push(value(d, c) ?? null);
      out.push(row);
    }
    return { columns: cols, rows: out };
  }, [range, order, columns, value]);

  const selectAll = useCallback(() => {
    if (!order.length || !columns.length) return;
    setSel({ anchor: { r: 0, c: 0 }, focus: { r: order.length - 1, c: columns.length - 1 } });
  }, [order.length, columns.length]);

  return {
    columns, rows, canEdit, pkIdx, sort, setSort,
    order, rowCount, value, isModified, isInserted, isDeleted,
    setCell, addRow, duplicateRows, deleteRows, discard, buildChanges, pendingCount,
    sel, setSel, range, selectedDataRows, selectedBlock, selectAll,
  };
}

function sameValue(a: CellValue, b: CellValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b) && typeof a === typeof b;
}
