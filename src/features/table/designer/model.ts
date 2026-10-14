// Editable model for the table designer. Each row has a stable `id` and `origName`
// (null = new) so the DDL generator can detect renames; existing rows removed by the
// user stay in the list with `dropped` set so they can be shown struck through / restored.
import type { ColumnDef, ForeignKeyDef, IndexDef, TableRef, TableStructure } from "../../../lib/types";
import { columnChanged, foreignKeyChanged, indexChanged, type DesignStructure } from "../ddlGen";
import type { Dialect } from "../../../lib/types";

export interface DColumn {
  id: string;
  origName: string | null;
  name: string;
  type: string;
  length: string;
  nullable: boolean;
  default: string;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  comment: string;
  dropped?: boolean;
}

export interface DIndex {
  id: string;
  origName: string | null;
  name: string;
  columns: string[];
  unique: boolean;
  method: string;
  dropped?: boolean;
}

export interface DForeignKey {
  id: string;
  origName: string | null;
  name: string;
  columns: string[];
  refSchema: string | null;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
  dropped?: boolean;
}

export interface DesignState {
  name: string;
  comment: string;
  columns: DColumn[];
  indexes: DIndex[];
  foreignKeys: DForeignKey[];
}

export type RowStatus = "clean" | "new" | "modified" | "dropped";

let seq = 0;
export const uid = () => `d${++seq}`;

/** Split "varchar(255)" into ["varchar", "255"]; types with trailing modifiers stay whole. */
export function splitType(t: string): [string, string] {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(t.trim());
  return m ? [m[1], m[2].trim()] : [t.trim(), ""];
}

export function composeType(type: string, length: string): string {
  const t = type.trim();
  const l = length.trim();
  return l ? `${t}(${l})` : t;
}

/** Sensible default length when picking a type that usually needs one. */
export function defaultLength(type: string): string {
  const t = type.toLowerCase();
  if (t === "varchar" || t === "nvarchar" || t === "character varying" || t === "varbinary") return "255";
  if (t === "char" || t === "nchar" || t === "binary") return "1";
  if (t === "decimal" || t === "numeric") return "10,2";
  return "";
}

export function fromStructure(s: TableStructure, tableName: string): DesignState {
  const cols = [...s.columns].sort((a, b) => a.ordinal - b.ordinal);
  return {
    name: tableName,
    comment: s.comment ?? "",
    columns: cols.map((c) => {
      const [type, length] = splitType(c.dataType);
      return {
        id: uid(), origName: c.name, name: c.name, type, length, nullable: c.nullable, default: c.default ?? "",
        isPrimaryKey: c.isPrimaryKey, autoIncrement: c.autoIncrement, comment: c.comment ?? "",
      };
    }),
    indexes: s.indexes.filter((i) => !i.primary).map((i) => ({
      id: uid(), origName: i.name, name: i.name, columns: [...i.columns], unique: i.unique, method: i.method ?? "",
    })),
    foreignKeys: s.foreignKeys.map((f) => ({
      id: uid(), origName: f.name, name: f.name, columns: [...f.columns], refSchema: f.refSchema ?? null,
      refTable: f.refTable, refColumns: [...f.refColumns], onUpdate: f.onUpdate ?? "", onDelete: f.onDelete ?? "",
    })),
  };
}

export function newColumn(name: string, type: string, extra: Partial<DColumn> = {}): DColumn {
  return {
    id: uid(), origName: null, name, type, length: defaultLength(type), nullable: true, default: "",
    isPrimaryKey: false, autoIncrement: false, comment: "", ...extra,
  };
}

const toColumnDef = (c: DColumn, i: number): ColumnDef & { origName: string | null } => ({
  name: c.name.trim(),
  dataType: composeType(c.type, c.length),
  nullable: c.nullable,
  default: c.default.trim() || null,
  isPrimaryKey: c.isPrimaryKey,
  autoIncrement: c.autoIncrement,
  comment: c.comment.trim() || null,
  ordinal: i + 1,
  origName: c.origName,
});

const toIndexDef = (i: DIndex): IndexDef & { origName: string | null } => ({
  name: i.name.trim(), columns: i.columns, unique: i.unique, primary: false, method: i.method.trim() || null, origName: i.origName,
});

const toFkDef = (f: DForeignKey): ForeignKeyDef & { origName: string | null } => ({
  name: f.name.trim(), columns: f.columns, refSchema: f.refSchema, refTable: f.refTable, refColumns: f.refColumns,
  onUpdate: f.onUpdate || null, onDelete: f.onDelete || null, origName: f.origName,
});

/** The edited structure (dropped rows removed) in the shape ddlGen expects. */
export function toDesignStructure(s: DesignState, table: TableRef): DesignStructure {
  return {
    table: { ...table, name: s.name.trim() || table.name },
    comment: s.comment.trim() || null,
    columns: s.columns.filter((c) => !c.dropped).map(toColumnDef),
    indexes: s.indexes.filter((i) => !i.dropped).map(toIndexDef),
    foreignKeys: s.foreignKeys.filter((f) => !f.dropped).map(toFkDef),
  };
}

/** Rename map (original name -> current name) for kept columns. */
export function renameMap(s: DesignState): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of s.columns) if (c.origName && !c.dropped) m.set(c.origName, c.name);
  return m;
}

export function columnStatus(d: Dialect, c: DColumn, original: TableStructure | null): RowStatus {
  if (c.dropped) return "dropped";
  if (!c.origName) return "new";
  const o = original?.columns.find((x) => x.name === c.origName);
  if (!o) return "new";
  return columnChanged(d, o, toColumnDef(c, 0)) ? "modified" : "clean";
}

export function indexStatus(i: DIndex, original: TableStructure | null, renames: Map<string, string>): RowStatus {
  if (i.dropped) return "dropped";
  const o = i.origName ? original?.indexes.find((x) => x.name === i.origName) : null;
  if (!o) return "new";
  return o.name !== i.name.trim() || indexChanged(o, toIndexDef(i), renames) ? "modified" : "clean";
}

export function fkStatus(f: DForeignKey, original: TableStructure | null, renames: Map<string, string>): RowStatus {
  if (f.dropped) return "dropped";
  const o = f.origName ? original?.foreignKeys.find((x) => x.name === f.origName) : null;
  if (!o) return "new";
  return o.name !== f.name.trim() || foreignKeyChanged(o, toFkDef(f), renames) ? "modified" : "clean";
}

/** Validation problems that block saving. */
export function validate(s: DesignState): string[] {
  const errs: string[] = [];
  if (!s.name.trim()) errs.push("Table name is required");
  const cols = s.columns.filter((c) => !c.dropped);
  if (!cols.length) errs.push("A table needs at least one column");
  const seen = new Set<string>();
  cols.forEach((c, i) => {
    const n = c.name.trim();
    if (!n) errs.push(`Column ${i + 1} has no name`);
    else if (seen.has(n.toLowerCase())) errs.push(`Duplicate column "${n}"`);
    seen.add(n.toLowerCase());
    if (!c.type.trim()) errs.push(`Column "${n || i + 1}" has no type`);
  });
  s.indexes.filter((i) => !i.dropped).forEach((i) => {
    if (!i.name.trim()) errs.push("An index has no name");
    if (!i.columns.length) errs.push(`Index "${i.name}" has no columns`);
  });
  s.foreignKeys.filter((f) => !f.dropped).forEach((f) => {
    if (!f.name.trim()) errs.push("A foreign key has no name");
    if (!f.refTable) errs.push(`Foreign key "${f.name}" has no referenced table`);
    else if (!f.columns.length || f.columns.length !== f.refColumns.length) errs.push(`Foreign key "${f.name}" needs matching column lists`);
  });
  return errs;
}

export const STATUS_ROW: Record<RowStatus, string> = {
  clean: "",
  new: "bg-ok/[0.07] shadow-[inset_2px_0_0_var(--color-ok)]",
  modified: "bg-warn/[0.07] shadow-[inset_2px_0_0_var(--color-warn)]",
  dropped: "bg-danger/[0.07] shadow-[inset_2px_0_0_var(--color-danger)] line-through text-faint [&_input]:line-through",
};
