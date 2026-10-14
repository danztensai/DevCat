// Statement splitting for "run statement under cursor". Works on raw text offsets.
import type { ConnectionKind } from "../../lib/types";

export interface StmtSpan { start: number; end: number; text: string }

/**
 * Split SQL into statements on `;`, honoring quotes, comments and Postgres
 * dollar-quoting. MSSQL also splits on lines that are just `GO`.
 */
export function splitSql(src: string, kind: ConnectionKind): StmtSpan[] {
  const out: StmtSpan[] = [];
  let start = 0;
  let i = 0;
  const n = src.length;
  const push = (end: number) => {
    const raw = src.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text && !isOnlyComments(text)) out.push({ start: start + lead, end: start + lead + text.length, text });
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "-" && next === "-") { i = lineEnd(src, i); continue; }
    if (ch === "#" && kind === "mysql") { i = lineEnd(src, i); continue; }
    if (ch === "/" && next === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { i = skipQuoted(src, i, ch, kind === "mysql"); continue; }
    if (ch === "[" && kind === "mssql") { const j = src.indexOf("]", i + 1); i = j < 0 ? n : j + 1; continue; }
    if (ch === "$" && kind === "postgres") {
      const m = /^\$[A-Za-z_]*\$/.exec(src.slice(i, i + 64));
      if (m) { const j = src.indexOf(m[0], i + m[0].length); i = j < 0 ? n : j + m[0].length; continue; }
    }
    if (ch === ";") { push(i); start = i + 1; i++; continue; }
    if (kind === "mssql" && (i === 0 || src[i - 1] === "\n")) {
      const m = /^[ \t]*GO[ \t]*(\r?\n|$)/i.exec(src.slice(i, i + 16));
      if (m) { push(i); start = i + m[0].length; i += m[0].length; continue; }
    }
    i++;
  }
  push(n);
  return out;
}

/** Mongo: statements separated by blank lines or `;`. Redis: one command per line. */
export function splitScript(src: string, kind: ConnectionKind): StmtSpan[] {
  if (kind === "redis") return splitBy(src, /\r?\n/g);
  if (kind === "mongodb") return splitBy(src, /;\s*\n|\n[ \t]*\r?\n/g);
  return splitSql(src, kind);
}

function splitBy(src: string, re: RegExp): StmtSpan[] {
  const out: StmtSpan[] = [];
  let start = 0;
  const add = (end: number) => {
    const raw = src.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim().replace(/;$/, "").trim();
    if (text && !text.startsWith("//") && !text.startsWith("#")) out.push({ start: start + lead, end: start + lead + text.length, text });
  };
  for (const m of src.matchAll(re)) { add(m.index!); start = m.index! + m[0].length; }
  add(src.length);
  return out;
}

/** Statement containing `offset`, or the closest one before it (cursor after `;`). */
export function statementAt(spans: StmtSpan[], offset: number): StmtSpan | null {
  if (!spans.length) return null;
  let best: StmtSpan | null = null;
  for (const s of spans) {
    if (offset >= s.start && offset <= s.end + 1) return s;
    if (s.end < offset) best = s;
  }
  return best ?? spans[0];
}

function lineEnd(s: string, i: number) {
  const j = s.indexOf("\n", i);
  return j < 0 ? s.length : j + 1;
}

function skipQuoted(s: string, i: number, q: string, backslash: boolean) {
  let j = i + 1;
  while (j < s.length) {
    if (backslash && s[j] === "\\") { j += 2; continue; }
    if (s[j] === q) {
      if (s[j + 1] === q) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return s.length;
}

function isOnlyComments(t: string) {
  return t.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "").trim() === "";
}
