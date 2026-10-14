// Serialize a block of grid cells for the clipboard.
import type { CellValue, ColumnInfo, Dialect } from "../../lib/types";
import { quoteIdent, sqlLiteral } from "../table/sqlDialect";
import { plainText } from "./format";

export type CopyFormat = "tsv" | "tsv-header" | "csv" | "json" | "insert" | "markdown";

function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tsvField(v: CellValue): string {
  if (v === null) return "NULL";
  return plainText(v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

export function serialize(
  format: CopyFormat,
  columns: ColumnInfo[],
  rows: CellValue[][],
  opts: { dialect?: Dialect; tableName?: string } = {},
): string {
  const names = columns.map((c) => c.name);
  switch (format) {
    case "tsv":
      return rows.map((r) => r.map(tsvField).join("\t")).join("\n");
    case "tsv-header":
      return [names.join("\t"), ...rows.map((r) => r.map(tsvField).join("\t"))].join("\n");
    case "csv":
      return [names.map(csvField).join(","), ...rows.map((r) => r.map((v) => csvField(plainText(v))).join(","))].join("\n");
    case "json":
      return JSON.stringify(rows.map((r) => Object.fromEntries(r.map((v, i) => [names[i], v]))), null, 2);
    case "markdown": {
      const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
      return [
        `| ${names.map(esc).join(" | ")} |`,
        `| ${names.map(() => "---").join(" | ")} |`,
        ...rows.map((r) => `| ${r.map((v) => (v === null ? "NULL" : esc(plainText(v)))).join(" | ")} |`),
      ].join("\n");
    }
    case "insert": {
      const d = opts.dialect && opts.dialect !== "none" ? opts.dialect : "postgres";
      const table = opts.tableName ?? "table_name";
      const cols = names.map((n) => quoteIdent(d, n)).join(", ");
      return rows.map((r) => `INSERT INTO ${table} (${cols}) VALUES (${r.map((v) => sqlLiteral(d, v)).join(", ")});`).join("\n");
    }
  }
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}
