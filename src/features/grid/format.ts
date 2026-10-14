// Cell value formatting / parsing helpers for the DataGrid.
import type { CellValue } from "../../lib/types";

export type CellKind = "null" | "number" | "bool" | "json" | "binary" | "text" | "unset";

const NUMERIC = /^(int|integer|smallint|bigint|tinyint|mediumint|serial|bigserial|smallserial|int[248]|float[48]?|real|double|decimal|numeric|number|money|smallmoney|bit)\b/i;
const BINARY = /(bytea|blob|binary|varbinary|image)/i;
const JSONISH = /^(json|jsonb|object|array|document)\b/i;

export const isNumericType = (t: string) => NUMERIC.test(t.trim());
export const isBinaryType = (t: string) => BINARY.test(t);
export const isJsonType = (t: string) => JSONISH.test(t.trim());

export function cellKind(v: CellValue, typeName: string): CellKind {
  if (v === null) return "null";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "object") return "json";
  if (isBinaryType(typeName)) return "binary";
  return "text";
}

const MAX_RENDER = 300;

/** Short single-line text for a grid cell. */
export function displayText(v: CellValue, kind: CellKind): string {
  switch (kind) {
    case "null": return "NULL";
    case "bool": return v ? "true" : "false";
    case "number": return String(v);
    case "json": {
      const s = JSON.stringify(v);
      return s.length > MAX_RENDER ? s.slice(0, MAX_RENDER) + "…" : s;
    }
    case "binary": {
      const s = String(v);
      const bytes = s.startsWith("\\x") ? Math.floor((s.length - 2) / 2) : Math.floor((s.length * 3) / 4);
      return `‹binary ${formatBytes(bytes)}›`;
    }
    default: {
      const s = String(v);
      const line = s.length > MAX_RENDER ? s.slice(0, MAX_RENDER) + "…" : s;
      return line.replace(/\r?\n/g, "↵ ");
    }
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Full text used for editing / copying. */
export function editText(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

/** Plain text for clipboard export (TSV/CSV). */
export function plainText(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Whether editing this value should use the multi-line popup editor. */
export function needsPopup(v: CellValue, typeName: string): boolean {
  if (v !== null && typeof v === "object") return true;
  if (isJsonType(typeName)) return true;
  return typeof v === "string" && (v.length > 120 || v.includes("\n"));
}

/** Convert edited text back to a value, guided by the original value / column type. */
export function parseInput(text: string, original: CellValue | undefined, typeName: string): CellValue {
  if (typeof original === "number" || (original == null && isNumericType(typeName))) {
    const t = text.trim();
    if (t !== "" && !Number.isNaN(Number(t)) && /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(t)) {
      const n = Number(t);
      // keep big integers as strings to avoid precision loss
      return Number.isSafeInteger(n) || !Number.isInteger(n) ? n : t;
    }
    return text;
  }
  if (typeof original === "boolean" || /^bool/i.test(typeName)) {
    const t = text.trim().toLowerCase();
    if (["true", "t", "1", "yes"].includes(t)) return true;
    if (["false", "f", "0", "no"].includes(t)) return false;
    return text;
  }
  if ((original !== null && typeof original === "object") || isJsonType(typeName)) {
    try { return JSON.parse(text) as CellValue; } catch { return text; }
  }
  return text;
}

export function compareValues(a: CellValue, b: CellValue): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const sa = typeof a === "object" ? JSON.stringify(a) : String(a);
  const sb = typeof b === "object" ? JSON.stringify(b) : String(b);
  const na = Number(sa), nb = Number(sb);
  if (sa !== "" && sb !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return sa.localeCompare(sb, undefined, { numeric: true });
}
