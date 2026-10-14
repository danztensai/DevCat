// Schema-aware completion for query editors. Providers are registered once per language;
// each editor model registers its connection context via setModelContext().
import type * as Monaco from "monaco-editor";
import { api } from "../../lib/api";
import type { ConnectionKind, SchemaSnapshot, TableStructure } from "../../lib/types";
import { splitScript, statementAt } from "./statements";

export interface ModelCtx { connId: string; kind: ConnectionKind; database: string | null; schema: string | null }

const contexts = new Map<string, ModelCtx>();
const snapCache = new Map<string, Promise<SchemaSnapshot>>();
const dbCache = new Map<string, Promise<string[]>>();

export function setModelContext(uri: string, ctx: ModelCtx | null) {
  if (ctx) contexts.set(uri, ctx); else contexts.delete(uri);
}

const snapKey = (c: string, d: string | null, s: string | null) => `${c}|${d ?? ""}|${s ?? ""}`;

export function loadSnapshot(connId: string, database: string | null, schema: string | null): Promise<SchemaSnapshot> {
  const k = snapKey(connId, database, schema);
  let p = snapCache.get(k);
  if (!p) {
    p = api.schemaSnapshot(connId, database, schema);
    p.catch(() => snapCache.delete(k));
    snapCache.set(k, p);
  }
  return p;
}

function loadDatabases(connId: string): Promise<string[]> {
  let p = dbCache.get(connId);
  if (!p) {
    p = api.listDatabases(connId);
    p.catch(() => dbCache.delete(connId));
    dbCache.set(connId, p);
  }
  return p;
}

/** Drop cached metadata for a connection (e.g. after DDL). */
export function invalidateCompletion(connId: string) {
  for (const k of [...snapCache.keys()]) if (k.startsWith(connId + "|")) snapCache.delete(k);
  dbCache.delete(connId);
}

export function prefetchCompletion(ctx: ModelCtx) {
  if (ctx.kind === "redis") return;
  loadSnapshot(ctx.connId, ctx.database, ctx.schema).catch(() => {});
  if (ctx.kind !== "mongodb") loadDatabases(ctx.connId).catch(() => {});
}

/** Resolve within a time budget so the suggest widget never hangs on slow metadata. */
async function within<T>(p: Promise<T>, ms = 1500): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

const SQL_KEYWORDS = (
  "SELECT FROM WHERE AND OR NOT IN IS NULL LIKE ILIKE BETWEEN EXISTS AS DISTINCT ON JOIN LEFT RIGHT INNER OUTER FULL CROSS " +
  "GROUP BY ORDER ASC DESC HAVING LIMIT OFFSET UNION ALL INTERSECT EXCEPT INSERT INTO VALUES UPDATE SET DELETE " +
  "CREATE ALTER DROP TABLE VIEW INDEX UNIQUE PRIMARY KEY FOREIGN REFERENCES CONSTRAINT DEFAULT CHECK " +
  "CASE WHEN THEN ELSE END WITH RECURSIVE RETURNING TRUNCATE BEGIN COMMIT ROLLBACK TRANSACTION " +
  "EXPLAIN ANALYZE GRANT REVOKE CASCADE IF COALESCE NULLIF CAST COUNT SUM AVG MIN MAX OVER PARTITION " +
  "SCHEMA DATABASE COLUMN ADD RENAME TO USING TRUE FALSE"
).split(" ");

const DIALECT_KEYWORDS: Partial<Record<ConnectionKind, string[]>> = {
  postgres: "SERIAL BIGSERIAL JSONB TEXT VARCHAR INTEGER BIGINT BOOLEAN TIMESTAMPTZ NOW() GENERATE_SERIES STRING_AGG ARRAY_AGG LATERAL MATERIALIZED VACUUM ON CONFLICT DO NOTHING".split(" "),
  mysql: "AUTO_INCREMENT ENGINE SHOW TABLES DATABASES DESCRIBE USE GROUP_CONCAT IFNULL NOW() REPLACE STRAIGHT_JOIN".split(" "),
  sqlite: "AUTOINCREMENT PRAGMA ATTACH DETACH VACUUM GLOB IFNULL DATETIME('now')".split(" "),
  mssql: "TOP IDENTITY NVARCHAR GETDATE() ISNULL OUTPUT MERGE GO EXEC NOLOCK OFFSET FETCH NEXT ROWS ONLY".split(" "),
};

const NOT_ALIAS = new Set("where on join left right inner outer full cross group order limit having union set values using natural as select".split(" "));

const unquote = (s: string) => s.replace(/^["`[]|["`\]]$/g, "");

/** table name (lowercased, possibly qualified) by alias/name used in the statement. */
function tableRefs(stmt: string): Map<string, string> {
  const m = new Map<string, string>();
  const re = /\b(?:from|join|update|into)\s+((?:[\w$"`[\]]+\.){0,2}[\w$"`[\]]+)(?:\s+(?:as\s+)?([\w$]+))?/gi;
  for (const x of stmt.matchAll(re)) {
    const full = x[1].split(".").map(unquote);
    const name = full[full.length - 1];
    m.set(name.toLowerCase(), name);
    if (x[2] && !NOT_ALIAS.has(x[2].toLowerCase())) m.set(x[2].toLowerCase(), name);
  }
  // comma-separated FROM lists: FROM a x, b y
  const from = /\bfrom\s+([\s\S]*?)(?:\bwhere\b|\bgroup\b|\border\b|\blimit\b|\bjoin\b|$)/i.exec(stmt);
  if (from) {
    for (const part of from[1].split(",")) {
      const t = part.trim().split(/\s+/);
      if (!t[0]) continue;
      const name = unquote(t[0].split(".").pop()!);
      m.set(name.toLowerCase(), name);
      const alias = t[1]?.toLowerCase() === "as" ? t[2] : t[1];
      if (alias && /^[\w$]+$/.test(alias) && !NOT_ALIAS.has(alias.toLowerCase())) m.set(alias.toLowerCase(), name);
    }
  }
  return m;
}

function findTable(snap: SchemaSnapshot | null, name: string): TableStructure | undefined {
  const n = name.toLowerCase();
  return snap?.tables.find((t) => t.table?.name.toLowerCase() === n);
}

let registered = false;

export function registerCompletion(monaco: typeof Monaco) {
  if (registered) return;
  registered = true;
  const K = monaco.languages.CompletionItemKind;

  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " "],
    async provideCompletionItems(model, position, context) {
      const ctx = contexts.get(model.uri.toString());
      if (!ctx) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      // Space trigger only right after FROM/JOIN etc.
      if (context.triggerCharacter === " " && !/\b(from|join|update|into|table)\s+$/i.test(linePrefix)) return { suggestions: [] };

      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const stmt = statementAt(splitScript(text, ctx.kind), offset)?.text ?? "";
      const snap = await within(loadSnapshot(ctx.connId, ctx.database, ctx.schema));
      const refs = tableRefs(stmt);

      const dot = /([\w$"`[\]]+)\.([\w$]*)$/.exec(linePrefix);
      if (dot) {
        const q = unquote(dot[1]).toLowerCase();
        const out: Monaco.languages.CompletionItem[] = [];
        const target = refs.get(q) ?? q;
        const t = findTable(snap, target);
        if (t) {
          for (const c of t.columns) {
            out.push({ label: { label: c.name, description: c.dataType }, kind: K.Field, insertText: c.name, range, sortText: `0${String(c.ordinal).padStart(4, "0")}` });
          }
        }
        // qualifier is a schema (or MySQL database)
        const inSchema = snap?.tables.filter((x) => (x.table?.schema ?? x.table?.database ?? "").toLowerCase() === q) ?? [];
        for (const x of inSchema) out.push({ label: x.table!.name, kind: K.Struct, insertText: x.table!.name, range, sortText: "1" });
        for (const [v] of snap?.views ?? []) if ((v.schema ?? v.database ?? "").toLowerCase() === q) out.push({ label: v.name, kind: K.Interface, insertText: v.name, range, sortText: "1" });
        if (!out.length && ctx.kind === "mysql") {
          const other = await within(loadSnapshot(ctx.connId, unquote(dot[1]), null));
          for (const x of other?.tables ?? []) out.push({ label: x.table!.name, kind: K.Struct, insertText: x.table!.name, range });
        }
        return { suggestions: out };
      }

      const out: Monaco.languages.CompletionItem[] = [];
      const afterFrom = /\b(from|join|update|into|table)\s+[\w$"`.]*$/i.test(linePrefix);
      const seenCols = new Set<string>();
      if (!afterFrom) {
        for (const name of new Set(refs.values())) {
          const t = findTable(snap, name);
          for (const c of t?.columns ?? []) {
            if (seenCols.has(c.name)) continue;
            seenCols.add(c.name);
            out.push({ label: { label: c.name, description: `${t!.table!.name} · ${c.dataType}` }, kind: K.Field, insertText: c.name, range, sortText: "0" });
          }
        }
      }
      for (const t of snap?.tables ?? []) {
        if (!t.table) continue;
        out.push({ label: { label: t.table.name, description: t.table.schema ?? "table" }, kind: K.Struct, insertText: t.table.name, range, sortText: afterFrom ? "0" : "1", detail: `${t.columns.length} columns` });
      }
      for (const [v] of snap?.views ?? []) {
        out.push({ label: { label: v.name, description: "view" }, kind: K.Interface, insertText: v.name, range, sortText: afterFrom ? "0" : "1" });
      }
      if (!afterFrom || ctx.kind === "mysql") {
        const dbs = await within(loadDatabases(ctx.connId), 300);
        for (const d of dbs ?? []) out.push({ label: { label: d, description: "database" }, kind: K.Module, insertText: d, range, sortText: "3" });
      }
      if (!afterFrom) {
        for (const kw of [...SQL_KEYWORDS, ...(DIALECT_KEYWORDS[ctx.kind] ?? [])]) {
          out.push({ label: kw, kind: K.Keyword, insertText: kw, range, sortText: "2" });
        }
      }
      return { suggestions: out };
    },
  });

  // MongoDB shell: db.<collection>.<method>
  const MONGO_METHODS = [
    "find({})", "findOne({})", "aggregate([])", "countDocuments({})", "distinct(\"\")", "insertOne({})", "insertMany([])",
    "updateOne({}, { $set: {} })", "updateMany({}, { $set: {} })", "replaceOne({}, {})", "deleteOne({})", "deleteMany({})",
    "createIndex({})", "getIndexes()", "drop()", "estimatedDocumentCount()",
  ];
  monaco.languages.registerCompletionItemProvider("javascript", {
    triggerCharacters: ["."],
    async provideCompletionItems(model, position) {
      const ctx = contexts.get(model.uri.toString());
      if (!ctx || ctx.kind !== "mongodb") return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      if (/\bdb\.[\w$]*$/.test(linePrefix)) {
        const snap = await within(loadSnapshot(ctx.connId, ctx.database, null));
        const out: Monaco.languages.CompletionItem[] = (snap?.tables ?? []).filter((t) => t.table).map((t) => ({
          label: t.table!.name, kind: K.Struct, insertText: t.table!.name, range,
        }));
        for (const m of ["getCollection(\"\")", "getCollectionNames()", "runCommand({})", "stats()"]) {
          out.push({ label: m.replace(/\(.*/, ""), kind: K.Method, insertText: m, range, sortText: "z" });
        }
        return { suggestions: out };
      }
      if (/\bdb\.(?:[\w$]+|getCollection\([^)]*\))\.[\w$]*$/.test(linePrefix)) {
        return { suggestions: MONGO_METHODS.map((m) => ({ label: m.replace(/\(.*/, ""), kind: K.Method, insertText: m, range })) };
      }
      return { suggestions: [] };
    },
  });

  registerRedisLanguage(monaco);
}

const REDIS_COMMANDS = (
  "GET SET DEL EXISTS EXPIRE TTL PTTL PERSIST TYPE KEYS SCAN RENAME INCR INCRBY DECR APPEND MGET MSET SETEX SETNX STRLEN " +
  "HGET HSET HDEL HGETALL HKEYS HVALS HLEN HEXISTS HINCRBY HSCAN " +
  "LPUSH RPUSH LPOP RPOP LRANGE LLEN LINDEX LSET LREM LTRIM " +
  "SADD SREM SMEMBERS SISMEMBER SCARD SPOP SRANDMEMBER SSCAN SUNION SINTER SDIFF " +
  "ZADD ZREM ZRANGE ZREVRANGE ZRANGEBYSCORE ZSCORE ZCARD ZINCRBY ZRANK ZSCAN " +
  "XADD XRANGE XREVRANGE XLEN XDEL XREAD XINFO " +
  "INFO DBSIZE FLUSHDB FLUSHALL SELECT PING ECHO CONFIG CLIENT MEMORY OBJECT SLOWLOG TIME PUBLISH"
).split(" ");

function registerRedisLanguage(monaco: typeof Monaco) {
  monaco.languages.register({ id: "redis" });
  monaco.languages.setMonarchTokensProvider("redis", {
    ignoreCase: true,
    keywords: REDIS_COMMANDS,
    tokenizer: {
      root: [
        [/^\s*[a-zA-Z]+/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/#.*$/, "comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'[^']*'/, "string"],
        [/-?\d+(\.\d+)?/, "number"],
      ],
    },
  });
  monaco.languages.registerCompletionItemProvider("redis", {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const prefix = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      if (prefix.trim()) return { suggestions: [] };
      return { suggestions: REDIS_COMMANDS.map((c) => ({ label: c, kind: monaco.languages.CompletionItemKind.Keyword, insertText: c + " ", range })) };
    },
  });
}
