// Redis helpers: command quoting, reply parsing, type metadata.
import type { QueryResult } from "../../lib/types";

export const REDIS_TYPES = ["string", "list", "set", "zset", "hash", "stream", "ReJSON-RL"] as const;

export const TYPE_META: Record<string, { label: string; cls: string }> = {
  string: { label: "STR", cls: "bg-info/15 text-info" },
  list: { label: "LIST", cls: "bg-ok/15 text-ok" },
  set: { label: "SET", cls: "bg-accent/15 text-accent" },
  zset: { label: "ZSET", cls: "bg-warn/15 text-warn" },
  hash: { label: "HASH", cls: "bg-[#c084fc]/15 text-[#c084fc]" },
  stream: { label: "STREAM", cls: "bg-[#2dd4bf]/15 text-[#2dd4bf]" },
  "ReJSON-RL": { label: "JSON", cls: "bg-[#f472b6]/15 text-[#f472b6]" },
  none: { label: "NONE", cls: "bg-hover text-faint" },
};

export const typeMeta = (t: string | null | undefined) => TYPE_META[t ?? ""] ?? { label: (t ?? "?").toUpperCase().slice(0, 6), cls: "bg-hover text-muted" };

/** Normalize "db3" / "3" / null to the bare index string used by the backend. */
export const dbIndex = (d: string | null | undefined) => (d ?? "0").replace(/^db/, "") || "0";

/** Quote one argument the way redis-cli parses it (double quotes with escapes). */
export function quoteArg(s: string): string {
  if (/^[A-Za-z0-9_:.\-/@#*$]+$/.test(s)) return s;
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += "\\x" + c.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + '"';
}

export const cmd = (...args: (string | number)[]) => args.map((a) => quoteArg(String(a))).join(" ");

/** SCAN replies come back as rows [[1, cursor], [2, [keys...]]]. */
export function parseScan(r: QueryResult | undefined): { cursor: string; keys: string[] } {
  if (!r) return { cursor: "0", keys: [] };
  const err = r.message?.startsWith("(error)") ? r.message : null;
  if (err) throw new Error(err);
  const vals = r.rows.map((row) => row[row.length - 1]);
  const cursor = String(vals[0] ?? "0");
  const keys = Array.isArray(vals[1]) ? (vals[1] as unknown[]).map(String) : [];
  return { cursor, keys };
}

/** First error message among results, if any. */
export function replyError(rs: QueryResult[]): string | null {
  const e = rs.find((r) => r.message?.startsWith("(error)"));
  return e ? e.message! : null;
}

export function formatTtl(ttl: number): string {
  if (ttl === -1) return "No expiry";
  if (ttl === -2) return "Expired";
  if (ttl < 60) return `${ttl}s`;
  const d = Math.floor(ttl / 86400), h = Math.floor((ttl % 86400) / 3600), m = Math.floor((ttl % 3600) / 60), s = ttl % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, !d && s && `${s}s`].filter(Boolean).join(" ");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Try to parse a string as JSON object/array (for the pretty toggle). */
export function asJson(s: string): unknown | undefined {
  const t = s.trim();
  if (!(t.startsWith("{") && t.endsWith("}")) && !(t.startsWith("[") && t.endsWith("]"))) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}
