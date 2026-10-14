// Relaxed Extended JSON helpers for the Mongo UI.
// - `parseRelaxed` accepts strict JSON plus common mongo-shell syntax (unquoted keys,
//   single quotes, trailing commas, comments, ObjectId(), ISODate(), NumberLong(), /regex/)
//   and returns plain Extended JSON values. Used for client-side validation and editing.
// - `shellValue` renders Extended JSON wrappers in shell style for display.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

class P {
  i = 0;
  private s: string;
  constructor(s: string) { this.s = s; }
  err(msg: string): never {
    const line = this.s.slice(0, this.i).split("\n").length;
    throw new Error(`${msg} (line ${line}, col ${this.i - this.s.lastIndexOf("\n", this.i - 1)})`);
  }
  ws() {
    for (;;) {
      const c = this.s[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") this.i++;
      else if (c === "/" && this.s[this.i + 1] === "/") { while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++; }
      else if (c === "/" && this.s[this.i + 1] === "*") { const e = this.s.indexOf("*/", this.i + 2); this.i = e < 0 ? this.s.length : e + 2; }
      else return;
    }
  }
  peek() { this.ws(); return this.s[this.i]; }
  eat(c: string) { if (this.peek() === c) { this.i++; return true; } return false; }
  expect(c: string) { if (!this.eat(c)) this.err(`Expected '${c}'`); }
  ident(): string | null {
    this.ws();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }
  string(): string {
    const q = this.s[this.i];
    this.i++;
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === q) return out;
      if (c === "\\") {
        const e = this.s[this.i++];
        const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "0": "\0" };
        if (e === "u") { out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16)); this.i += 4; }
        else out += map[e] ?? e;
      } else out += c;
    }
    return this.err("Unterminated string");
  }
  number(): number {
    const m = /^[-+]?(0x[0-9a-f]+|(\d+\.?\d*|\.\d+)(e[-+]?\d+)?|Infinity|NaN)/i.exec(this.s.slice(this.i));
    if (!m) this.err("Invalid number");
    this.i += m![0].length;
    return Number(m![0]);
  }
  value(): Json {
    const c = this.peek();
    if (c === undefined) this.err("Unexpected end of input");
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'") return this.string();
    if (c === "/") return this.regex();
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) return this.number();
    const id = this.ident();
    if (!id) this.err(`Unexpected '${c}'`);
    switch (id) {
      case "true": return true;
      case "false": return false;
      case "null": case "undefined": return null;
      case "Infinity": case "NaN": return Number(id);
      case "new": return this.value();
    }
    return this.helper(id!);
  }
  helper(name: string): Json {
    this.expect("(");
    const args: Json[] = [];
    while (this.peek() !== ")") {
      args.push(this.value());
      if (!this.eat(",")) break;
    }
    this.expect(")");
    const a0 = args[0];
    switch (name) {
      case "ObjectId": return { $oid: String(a0 ?? "") };
      case "ISODate": case "Date": return { $date: a0 === undefined ? new Date().toISOString() : typeof a0 === "number" ? new Date(a0).toISOString() : String(a0) };
      case "NumberLong": return { $numberLong: String(a0 ?? 0) };
      case "NumberInt": return Number(a0 ?? 0);
      case "NumberDecimal": return { $numberDecimal: String(a0 ?? 0) };
      case "UUID": return { $uuid: String(a0 ?? "") };
      case "Timestamp": return { $timestamp: { t: Number(a0 ?? 0), i: Number(args[1] ?? 0) } };
      case "BinData": return { $binary: { base64: String(args[1] ?? ""), subType: Number(a0 ?? 0).toString(16).padStart(2, "0") } };
      case "RegExp": return { $regularExpression: { pattern: String(a0 ?? ""), options: String(args[1] ?? "") } };
    }
    return this.err(`Unknown function ${name}()`);
  }
  regex(): Json {
    this.i++;
    let pat = "";
    let cls = false;
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === "\\") { pat += c + this.s[this.i++]; continue; }
      if (c === "[") cls = true;
      if (c === "]") cls = false;
      if (c === "/" && !cls) break;
      pat += c;
    }
    const m = /^[a-z]*/.exec(this.s.slice(this.i))!;
    this.i += m[0].length;
    return { $regularExpression: { pattern: pat, options: m[0] } };
  }
  object(): Json {
    this.expect("{");
    const o: Record<string, Json> = {};
    while (this.peek() !== "}") {
      const c = this.peek();
      let k: string;
      if (c === '"' || c === "'") k = this.string();
      else {
        const m = /^[^\s:,{}[\]"']+/.exec(this.s.slice(this.i));
        if (!m) this.err("Expected a key");
        k = m![0];
        this.i += k.length;
      }
      this.expect(":");
      o[k] = this.value();
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return o;
  }
  array(): Json {
    this.expect("[");
    const a: Json[] = [];
    while (this.peek() !== "]") {
      a.push(this.value());
      if (!this.eat(",")) break;
    }
    this.expect("]");
    return a;
  }
}

export function parseRelaxed(text: string): Json {
  const p = new P(text);
  const v = p.value();
  if (p.peek() !== undefined) p.err("Unexpected trailing content");
  return v;
}

/** Validate a document-like input; empty string counts as `{}`. Returns error message or null. */
export function validateDoc(text: string, allowArray = false): string | null {
  if (!text.trim()) return null;
  try {
    const v = parseRelaxed(text);
    if (v === null || typeof v !== "object" || (Array.isArray(v) && !allowArray)) return allowArray ? "Expected an object or array" : "Expected an object { … }";
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export const isPlainObject = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);

/** Shell-style display for Extended JSON wrappers; returns null for regular objects. */
export function shellValue(v: unknown): { text: string; kind: "oid" | "date" | "number" | "binary" | "regex" | "other" } | null {
  if (!isPlainObject(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1 && !(keys.length === 2 && "$regex" in v)) return null;
  const k = keys[0];
  const x = v[k];
  switch (k) {
    case "$oid": return { text: `ObjectId("${x}")`, kind: "oid" };
    case "$date": {
      const d = isPlainObject(x) && "$numberLong" in x ? new Date(Number(x.$numberLong)).toISOString() : String(x);
      return { text: `ISODate("${d}")`, kind: "date" };
    }
    case "$numberLong": return { text: `NumberLong(${x})`, kind: "number" };
    case "$numberDecimal": return { text: `NumberDecimal("${x}")`, kind: "number" };
    case "$numberDouble": return { text: String(x), kind: "number" };
    case "$numberInt": return { text: String(x), kind: "number" };
    case "$uuid": return { text: `UUID("${x}")`, kind: "binary" };
    case "$binary": return { text: `BinData(${isPlainObject(x) ? `${parseInt(String(x.subType), 16) || 0}, "${String(x.base64).slice(0, 24)}${String(x.base64).length > 24 ? "…" : ""}"` : ""})`, kind: "binary" };
    case "$regularExpression": return { text: `/${isPlainObject(x) ? x.pattern : ""}/${isPlainObject(x) ? x.options : ""}`, kind: "regex" };
    case "$timestamp": return { text: `Timestamp(${isPlainObject(x) ? `${x.t}, ${x.i}` : ""})`, kind: "other" };
    case "$minKey": return { text: "MinKey()", kind: "other" };
    case "$maxKey": return { text: "MaxKey()", kind: "other" };
  }
  return null;
}

/** Compact one-line representation used in table cells and summaries. */
export function compact(v: unknown, max = 200): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v.length > max ? v.slice(0, max) + "…" : v;
  if (typeof v !== "object") return String(v);
  const sv = shellValue(v);
  if (sv) return sv.text;
  const s = JSON.stringify(v, (_k, x) => {
    const w = shellValue(x);
    return w ? `@@${w.text}@@` : x;
  }).replace(/"@@(.*?)@@"/g, (_m, t: string) => t.replace(/\\"/g, '"'));
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** JSON text for a JS value (extended JSON preserved). */
export const toJsonText = (v: unknown, pretty = true) => JSON.stringify(v, null, pretty ? 2 : undefined);

/** Collection name literal for shell statements. */
export const collRef = (name: string) => `db.getCollection(${JSON.stringify(name)})`;

/** Flatten a document into dotted top-level columns (objects only; arrays and ext-JSON stay whole). */
export function flatten(doc: Record<string, unknown>, depth = 2, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(doc)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (depth > 0 && isPlainObject(v) && !shellValue(v) && Object.keys(v).length > 0) flatten(v as Record<string, unknown>, depth - 1, key, out);
    else out[key] = v;
  }
  return out;
}

export function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const sv = shellValue(v);
  if (sv) return sv.kind === "oid" ? "objectId" : sv.kind === "date" ? "date" : sv.kind === "number" ? "number" : sv.kind;
  return typeof v;
}
