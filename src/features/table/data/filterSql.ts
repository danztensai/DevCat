// Quick-filter conditions -> SQL WHERE expression.
import type { CellValue, ColumnInfo, Dialect } from "../../../lib/types";
import { isNumericType } from "../../grid/format";
import { quoteIdent, sqlLiteral } from "../sqlDialect";

export const OPERATORS = ["=", "!=", "<", ">", "<=", ">=", "LIKE", "NOT LIKE", "IN", "NOT IN", "IS NULL", "IS NOT NULL", "BETWEEN"] as const;
export type Operator = (typeof OPERATORS)[number];

export interface Condition { column: string; op: Operator; value: string; value2: string }

export const needsValue = (op: Operator) => op !== "IS NULL" && op !== "IS NOT NULL";

function lit(d: Dialect, v: string, numeric: boolean): string {
  const t = v.trim();
  if (numeric && /^-?\d+(\.\d+)?$/.test(t)) return t;
  return sqlLiteral(d, v);
}

export function conditionSql(d: Dialect, c: Condition, columns: ColumnInfo[]): string | null {
  if (!c.column) return null;
  const col = columns.find((x) => x.name === c.column);
  const numeric = !!col && isNumericType(col.typeName);
  const id = quoteIdent(d, c.column);
  switch (c.op) {
    case "IS NULL": case "IS NOT NULL": return `${id} ${c.op}`;
    case "IN": case "NOT IN": {
      const items = c.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!items.length) return null;
      return `${id} ${c.op} (${items.map((s) => lit(d, s, numeric)).join(", ")})`;
    }
    case "BETWEEN":
      if (!c.value.trim() || !c.value2.trim()) return null;
      return `${id} BETWEEN ${lit(d, c.value, numeric)} AND ${lit(d, c.value2, numeric)}`;
    case "LIKE": case "NOT LIKE": {
      const v = c.value.includes("%") || c.value.includes("_") ? c.value : `%${c.value}%`;
      return `${id} ${c.op} ${sqlLiteral(d, v)}`;
    }
    default:
      return `${id} ${c.op === "!=" ? "<>" : c.op} ${lit(d, c.value, numeric)}`;
  }
}

export function buildWhere(d: Dialect, conds: Condition[], join: "AND" | "OR", columns: ColumnInfo[]): string {
  const parts = conds.map((c) => conditionSql(d, c, columns)).filter((x): x is string => !!x);
  return parts.length > 1 && join === "OR" ? parts.map((p) => `(${p})`).join(" OR ") : parts.join(` ${join} `);
}

/** `col = value` (or IS NULL) for "filter by this value". */
export function equalsSql(d: Dialect, column: string, v: CellValue): string {
  const id = quoteIdent(d, column);
  if (v === null) return `${id} IS NULL`;
  if (typeof v === "number") return `${id} = ${v}`;
  return `${id} = ${sqlLiteral(d, v)}`;
}
