// Mini redis-cli: one command per Enter, ↑/↓ history (persisted per connection).
import clsx from "clsx";
import { Terminal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import { lsGet, lsSet } from "../transfer/shared";

const READS = /^(GET|MGET|STRLEN|GETRANGE|EXISTS|TYPE|TTL|PTTL|KEYS|SCAN|RANDOMKEY|DBSIZE|INFO|PING|ECHO|TIME|LRANGE|LLEN|LINDEX|LPOS|SMEMBERS|SCARD|SISMEMBER|SRANDMEMBER|SSCAN|ZRANGE|ZCARD|ZSCORE|ZRANK|ZCOUNT|ZSCAN|ZREVRANGE|ZRANGEBYSCORE|HGET|HGETALL|HKEYS|HVALS|HLEN|HEXISTS|HSCAN|HMGET|XRANGE|XREVRANGE|XLEN|XINFO|OBJECT|MEMORY|CONFIG|CLIENT|SLOWLOG|COMMAND|JSON\.GET)$/;

interface Entry { db: string; cmd: string; out: string; error?: boolean; ms?: number }

export function RedisConsole({ connId, db, onDb, onMutated }: { connId: string; db: string; onDb: (db: string) => void; onMutated: () => void }) {
  const histKey = `redis:history:${connId}`;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>(lsGet<string[]>(histKey, []));
  const pos = useRef<number>(-1);
  const draft = useRef("");
  const outRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement>(null);

  useEffect(() => { outRef.current?.scrollTo({ top: outRef.current.scrollHeight }); }, [entries]);

  const run = async () => {
    const line = input.trim();
    if (!line || busy) return;
    history.current = [...history.current.filter((h) => h !== line), line].slice(-200);
    lsSet(histKey, history.current);
    pos.current = -1;
    setInput("");
    const name = line.split(/\s+/)[0].toUpperCase();
    if (name === "CLEAR") { setEntries([]); return; }
    const sel = line.match(/^select\s+(\d+)\s*$/i);
    setBusy(true);
    const started = performance.now();
    try {
      const rs = await api.execute(connId, line, { database: db, maxRows: 5000 });
      const out = rs.map((r) => r.message ?? (r.rowsAffected != null ? `(integer) ${r.rowsAffected}` : "")).join("\n");
      const error = rs.some((r) => r.message?.startsWith("(error)"));
      setEntries((e) => [...e.slice(-500), { db, cmd: line, out, error, ms: Math.round(performance.now() - started) }]);
      if (sel && !error) onDb(sel[1]);
      else if (!error && !READS.test(name)) onMutated();
    } catch (e) {
      setEntries((x) => [...x, { db, cmd: line, out: `(error) ${errMsg(e)}`, error: true }]);
    } finally {
      setBusy(false);
      setTimeout(() => inRef.current?.focus(), 0);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const h = history.current;
    if (e.key === "Enter") { e.preventDefault(); run(); }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!h.length) return;
      if (pos.current === -1) { draft.current = input; pos.current = h.length - 1; }
      else pos.current = Math.max(0, pos.current - 1);
      setInput(h[pos.current]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (pos.current === -1) return;
      pos.current++;
      if (pos.current >= h.length) { pos.current = -1; setInput(draft.current); }
      else setInput(h[pos.current]);
    } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); setEntries([]); }
  };

  return (
    <div className="flex h-full flex-col bg-app" onClick={() => window.getSelection()?.isCollapsed && inRef.current?.focus()}>
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2 text-[11px] text-muted">
        <Terminal className="size-3.5" />
        <span className="font-semibold uppercase tracking-wider">Console</span>
        <span className="text-faint">db{db} · ↑/↓ history · Ctrl+L clear</span>
        <div className="flex-1" />
        <IconButton title="Clear output" onClick={() => setEntries([])}><Trash2 className="size-3.5" /></IconButton>
      </div>
      <div ref={outRef} className="selectable min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-[12px] leading-[18px]">
        {entries.map((e, i) => (
          <div key={i} className="mb-1">
            <div className="flex gap-2">
              <span className="text-faint">db{e.db}&gt;</span>
              <span className="text-fg">{e.cmd}</span>
              {e.ms != null && <span className="ml-auto text-[10.5px] text-faint">{e.ms} ms</span>}
            </div>
            <pre className={clsx("whitespace-pre-wrap break-all", e.error ? "text-danger" : "text-fg/80")}>{e.out}</pre>
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-2">
        <span className="font-mono text-[12px] text-accent">db{db}&gt;</span>
        <input
          ref={inRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Type a command, e.g. GET user:1"
          className="h-7 flex-1 bg-transparent font-mono text-[12px] text-fg placeholder:text-faint focus:outline-none"
        />
      </div>
    </div>
  );
}
