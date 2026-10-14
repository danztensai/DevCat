// Pure row-level diff of two result sets keyed by primary key, plus DML
// script generation (target dialect) to make the target match the source.
import type { CellValue, QueryResult } from "../../lib/types";
import { literal, qualify, quoteIdent, terminator, type SqlDialect } from "./sqlDialect";

export type Row = Record<string, CellValue>;

export interface RowDiff {
  key: Row;
  source?: Row;
  target?: Row;
  /** changed column names (updates only) */
  changed: string[];
}

export interface DataDiff {
  keyColumns: string[];
  columns: string[];
  inserts: RowDiff[];
  updates: RowDiff[];
  deletes: RowDiff[];
  identical: number;
  duplicateKeys: number;
}

export function resultToRows(r: QueryResult): Row[] {
  const names = r.columns.map((c) => c.name);
  return r.rows.map((row) => {
    const o: Row = {};
    names.forEach((n, i) => { o[n] = row[i] ?? null; });
    return o;
  });
}

/** Loose normalization so equivalent values from different drivers compare equal. */
export function normValue(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "\u0000null";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  const s = v.trim();
  if (s !== "" && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return String(Number(s));
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]00:?00)?$/);
  if (iso) {
    const frac = (iso[3] ?? "").replace(/0+$/, "");
    return `${iso[1]} ${iso[2]}${frac === "." ? "" : frac}`;
  }
  if (s === "true" || s === "t") return "1";
  if (s === "false" || s === "f") return "0";
  return v;
}

const keyString = (r: Row, keys: string[]) => keys.map((k) => normValue(r[k])).join("\u0001");

export function diffRows(source: Row[], target: Row[], keyColumns: string[], columns: string[]): DataDiff {
  const tmap = new Map<string, Row>();
  let duplicateKeys = 0;
  for (const r of target) {
    const k = keyString(r, keyColumns);
    if (tmap.has(k)) duplicateKeys++;
    tmap.set(k, r);
  }
  const seen = new Set<string>();
  const inserts: RowDiff[] = [], updates: RowDiff[] = [], deletes: RowDiff[] = [];
  let identical = 0;
  const pick = (r: Row) => Object.fromEntries(keyColumns.map((k) => [k, r[k]])) as Row;
  for (const s of source) {
    const k = keyString(s, keyColumns);
    if (seen.has(k)) { duplicateKeys++; continue; }
    seen.add(k);
    const t = tmap.get(k);
    if (!t) { inserts.push({ key: pick(s), source: s, changed: [] }); continue; }
    const changed = columns.filter((c) => !keyColumns.includes(c) && normValue(s[c]) !== normValue(t[c]));
    if (changed.length) updates.push({ key: pick(s), source: s, target: t, changed });
    else identical++;
  }
  for (const [k, t] of tmap) if (!seen.has(k)) deletes.push({ key: pick(t), target: t, changed: [] });
  return { keyColumns, columns, inserts, updates, deletes, identical, duplicateKeys };
}

export interface DataScriptOptions {
  dialect: SqlDialect;
  table: string;
  schema?: string | null;
  includeInserts: boolean;
  includeUpdates: boolean;
  includeDeletes: boolean;
  /** Wrap in a transaction. */
  transaction: boolean;
  /** MSSQL: allow explicit values for identity columns. */
  identityInsert?: boolean;
}

export function generateDataSql(diff: DataDiff, o: DataScriptOptions): string {
  const d = o.dialect;
  const q = (s: string) => quoteIdent(d, s);
  const t = qualify(d, o.table, o.schema);
  const end = d === "mssql" ? ";" : terminator(d);
  const where = (key: Row) => diff.keyColumns.map((k) => (key[k] === null ? `${q(k)} IS NULL` : `${q(k)} = ${literal(d, key[k])}`)).join(" AND ");
  const out: string[] = [];
  out.push(`-- Data sync for ${o.table}: ${o.includeInserts ? diff.inserts.length : 0} insert(s), ${o.includeUpdates ? diff.updates.length : 0} update(s), ${o.includeDeletes ? diff.deletes.length : 0} delete(s)`);
  if (o.transaction) out.push(d === "mssql" ? "BEGIN TRANSACTION;" : d === "mysql" ? "START TRANSACTION;" : "BEGIN;");
  if (o.includeDeletes && diff.deletes.length) {
    out.push("", "-- Delete rows missing from source");
    for (const r of diff.deletes) out.push(`DELETE FROM ${t} WHERE ${where(r.key)}${end}`);
  }
  if (o.includeUpdates && diff.updates.length) {
    out.push("", "-- Update changed rows");
    for (const r of diff.updates) {
      out.push(`UPDATE ${t} SET ${r.changed.map((c) => `${q(c)} = ${literal(d, r.source![c])}`).join(", ")} WHERE ${where(r.key)}${end}`);
    }
  }
  if (o.includeInserts && diff.inserts.length) {
    out.push("", "-- Insert rows missing from target");
    if (d === "mssql" && o.identityInsert) out.push(`SET IDENTITY_INSERT ${t} ON;`);
    const cols = diff.columns;
    for (const r of diff.inserts) {
      out.push(`INSERT INTO ${t} (${cols.map(q).join(", ")}) VALUES (${cols.map((c) => literal(d, r.source![c])).join(", ")})${end}`);
    }
    if (d === "mssql" && o.identityInsert) out.push(`SET IDENTITY_INSERT ${t} OFF;`);
  }
  if (o.transaction) out.push("", d === "mssql" ? "COMMIT TRANSACTION;" : "COMMIT;");
  return out.join("\n") + "\n";
}
