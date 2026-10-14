// Pure schema diff between two SchemaSnapshots. "Source" is the desired state;
// "target" is what will be altered by the sync script.
import type { ColumnDef, ForeignKeyDef, IndexDef, SchemaSnapshot, TableRef, TableStructure } from "../../lib/types";
import { normalizeDefault, typesEqual } from "./sqlDialect";

export type ItemStatus = "onlySource" | "onlyTarget" | "changed" | "same";

export interface ColumnDiff {
  name: string;
  status: ItemStatus;
  source?: ColumnDef;
  target?: ColumnDef;
  /** Which attributes differ: "type" | "nullable" | "default" | "pk" | "autoIncrement" */
  changes: string[];
}

export interface IndexDiff {
  name: string;
  status: ItemStatus;
  source?: IndexDef;
  target?: IndexDef;
}

export interface FkDiff {
  name: string;
  status: ItemStatus;
  source?: ForeignKeyDef;
  target?: ForeignKeyDef;
}

export type TableStatus = "onlySource" | "onlyTarget" | "different" | "identical";

export interface TableDiff {
  /** Stable id used for selection. */
  id: string;
  name: string;
  status: TableStatus;
  source?: TableStructure;
  target?: TableStructure;
  columns: ColumnDiff[];
  indexes: IndexDiff[];
  foreignKeys: FkDiff[];
  pkChanged: boolean;
}

export interface ViewDiff {
  id: string;
  name: string;
  status: TableStatus;
  sourceRef?: TableRef;
  targetRef?: TableRef;
  sourceDef?: string;
  targetDef?: string;
}

export interface SchemaDiff {
  tables: TableDiff[];
  views: ViewDiff[];
}

export interface DiffOptions {
  /** Source and target are different dialects: compare types by family. */
  crossDialect?: boolean;
  ignoreCase?: boolean;
  ignoreTypeSize?: boolean;
  compareDefaults?: boolean;
  compareIndexes?: boolean;
  compareForeignKeys?: boolean;
  /** Ignore column ordering differences (always true currently; ordinal is not diffed). */
}

export const DEFAULT_DIFF_OPTIONS: Required<DiffOptions> = {
  crossDialect: false,
  ignoreCase: true,
  ignoreTypeSize: false,
  compareDefaults: true,
  compareIndexes: true,
  compareForeignKeys: true,
};

const keyOf = (s: string, ignoreCase: boolean) => (ignoreCase ? s.toLowerCase() : s);

function pairBy<T>(a: T[], b: T[], key: (x: T) => string): [string, T | undefined, T | undefined][] {
  const ma = new Map<string, T>(), mb = new Map<string, T>();
  a.forEach((x) => ma.set(key(x), x));
  b.forEach((x) => mb.set(key(x), x));
  const out: [string, T | undefined, T | undefined][] = [];
  for (const [k, v] of ma) out.push([k, v, mb.get(k)]);
  for (const [k, v] of mb) if (!ma.has(k)) out.push([k, undefined, v]);
  return out;
}

export function diffColumn(s: ColumnDef, t: ColumnDef, o: Required<DiffOptions>): string[] {
  const ch: string[] = [];
  if (!typesEqual(s.dataType, t.dataType, o.crossDialect, o.ignoreTypeSize)) ch.push("type");
  if (s.nullable !== t.nullable) ch.push("nullable");
  if (o.compareDefaults && !o.crossDialect && normalizeDefault(s.default) !== normalizeDefault(t.default)) ch.push("default");
  if (s.isPrimaryKey !== t.isPrimaryKey) ch.push("pk");
  if (s.autoIncrement !== t.autoIncrement) ch.push("autoIncrement");
  return ch;
}

const idxSig = (i: IndexDef, ic: boolean) => `${i.unique ? "u" : ""}:${i.columns.map((c) => keyOf(c, ic)).join(",")}`;
const fkSig = (f: ForeignKeyDef, ic: boolean) =>
  `${f.columns.map((c) => keyOf(c, ic)).join(",")}->${keyOf(f.refTable, ic)}(${f.refColumns.map((c) => keyOf(c, ic)).join(",")})`;

/** Pair items by name, then pair leftovers by structural signature (names often differ between servers). */
function pairNamed<T extends { name: string }>(a: T[], b: T[], sig: (x: T) => string, ic: boolean) {
  const pairs = pairBy(a, b, (x) => keyOf(x.name, ic));
  const onlyA = pairs.filter((p) => p[1] && !p[2]);
  const onlyB = pairs.filter((p) => !p[1] && p[2]);
  const matched = pairs.filter((p) => p[1] && p[2]);
  const usedB = new Set<number>();
  for (const pa of onlyA) {
    const j = onlyB.findIndex((pb, i) => !usedB.has(i) && sig(pb[2]!) === sig(pa[1]!));
    if (j >= 0) {
      usedB.add(j);
      matched.push([pa[0], pa[1], onlyB[j][2]]);
    } else matched.push(pa);
  }
  onlyB.forEach((pb, i) => !usedB.has(i) && matched.push(pb));
  return matched;
}

export function diffTable(source: TableStructure | undefined, target: TableStructure | undefined, opts: DiffOptions = {}): Omit<TableDiff, "id" | "name"> {
  const o = { ...DEFAULT_DIFF_OPTIONS, ...opts };
  const ic = o.ignoreCase;
  const sc = source?.columns ?? [], tc = target?.columns ?? [];
  const columns: ColumnDiff[] = pairBy(sc, tc, (c) => keyOf(c.name, ic)).map(([, s, t]) => {
    if (s && !t) return { name: s.name, status: "onlySource", source: s, changes: [] };
    if (!s && t) return { name: t.name, status: "onlyTarget", target: t, changes: [] };
    const changes = diffColumn(s!, t!, o);
    return { name: s!.name, status: changes.length ? "changed" : "same", source: s, target: t, changes };
  });
  // keep source order, then target-only columns in their order
  const ord = (c: ColumnDiff) => (c.source ? c.source.ordinal : 100000 + (c.target?.ordinal ?? 0));
  columns.sort((a, b) => ord(a) - ord(b));

  const nonPk = (xs: IndexDef[]) => xs.filter((i) => !i.primary);
  const indexes: IndexDiff[] = !o.compareIndexes ? [] :
    pairNamed(nonPk(source?.indexes ?? []), nonPk(target?.indexes ?? []), (i) => idxSig(i, ic), ic).map(([, s, t]) => ({
      name: (s ?? t)!.name,
      status: s && t ? (idxSig(s, ic) === idxSig(t, ic) ? "same" : "changed") : s ? "onlySource" : "onlyTarget",
      source: s, target: t,
    }));

  const foreignKeys: FkDiff[] = !o.compareForeignKeys ? [] :
    pairNamed(source?.foreignKeys ?? [], target?.foreignKeys ?? [], (f) => fkSig(f, ic), ic).map(([, s, t]) => ({
      name: (s ?? t)!.name,
      status: s && t
        ? fkSig(s, ic) === fkSig(t, ic) && (s.onDelete ?? "") .toUpperCase() === (t.onDelete ?? "").toUpperCase()
          && (s.onUpdate ?? "").toUpperCase() === (t.onUpdate ?? "").toUpperCase() ? "same" : "changed"
        : s ? "onlySource" : "onlyTarget",
      source: s, target: t,
    }));

  const pkCols = (t?: TableStructure) => (t?.columns ?? []).filter((c) => c.isPrimaryKey).map((c) => keyOf(c.name, ic)).sort().join(",");
  const pkChanged = !!source && !!target && pkCols(source) !== pkCols(target);

  let status: TableStatus;
  if (source && !target) status = "onlySource";
  else if (!source && target) status = "onlyTarget";
  else {
    const differs = pkChanged
      || columns.some((c) => c.status !== "same")
      || indexes.some((i) => i.status !== "same")
      || foreignKeys.some((f) => f.status !== "same");
    status = differs ? "different" : "identical";
  }
  return { status, source, target, columns, indexes, foreignKeys, pkChanged };
}

const normSql = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").replace(/\s*([(),;=])\s*/g, "$1").trim().replace(/;$/, "").toLowerCase();

export function diffSchemas(source: SchemaSnapshot, target: SchemaSnapshot, opts: DiffOptions = {}): SchemaDiff {
  const o = { ...DEFAULT_DIFF_OPTIONS, ...opts };
  const ic = o.ignoreCase;
  const tname = (t: TableStructure) => t.table?.name ?? "";
  const tables: TableDiff[] = pairBy(source.tables, target.tables, (t) => keyOf(tname(t), ic)).map(([k, s, t]) => ({
    id: `t:${k}`,
    name: tname((s ?? t)!),
    ...diffTable(s, t, o),
  }));
  tables.sort((a, b) => a.name.localeCompare(b.name));

  const views: ViewDiff[] = pairBy(source.views, target.views, (v) => keyOf(v[0].name, ic)).map(([k, s, t]) => ({
    id: `v:${k}`,
    name: (s ?? t)![0].name,
    status: s && t ? (o.crossDialect || normSql(s[1]) === normSql(t[1]) ? "identical" : "different") : s ? "onlySource" : "onlyTarget",
    sourceRef: s?.[0], targetRef: t?.[0], sourceDef: s?.[1], targetDef: t?.[1],
  }));
  views.sort((a, b) => a.name.localeCompare(b.name));
  return { tables, views };
}

export function diffSummary(d: SchemaDiff) {
  const count = (xs: { status: TableStatus }[], s: TableStatus) => xs.filter((x) => x.status === s).length;
  const all = [...d.tables, ...d.views];
  return {
    onlySource: count(all, "onlySource"),
    onlyTarget: count(all, "onlyTarget"),
    different: count(all, "different"),
    identical: count(all, "identical"),
  };
}
