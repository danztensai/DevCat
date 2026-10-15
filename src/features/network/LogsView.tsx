// Live log of a network profile: initial backlog + "net-log" events, auto-scroll, filter, copy.
import clsx from "clsx";
import { ArrowDownToLine, Copy, Eraser, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconButton, Toolbar } from "../../components/ui";
import { copyText } from "./meta";
import { useNet } from "./store";

const EMPTY: string[] = [];

export function LogsView({ id }: { id: string }) {
  const lines = useNet((s) => s.logs[id] ?? EMPTY);
  const loaded = useNet((s) => id in s.logs);
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void useNet.getState().loadLogs(id); }, [id]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines;
  }, [lines, query]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const clear = () => useNet.setState((s) => ({ logs: { ...s.logs, [id]: [] } }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar className="bg-app">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Filter log"
            spellCheck={false}
            className="h-6 w-full rounded border border-line bg-app pr-6 pl-7 text-[12px] placeholder:text-faint focus:border-accent focus:outline-none"
          />
          {query && <button className="absolute top-1/2 right-1.5 -translate-y-1/2 text-faint hover:text-fg" title="Clear filter" onClick={() => setQuery("")}><X className="size-3" /></button>}
        </div>
        <span className="text-[11px] text-faint">{query ? `${shown.length} of ${lines.length}` : `${lines.length}`} line{lines.length === 1 ? "" : "s"}</span>
        <span className="flex-1" />
        <IconButton title="Follow (scroll to bottom)" active={follow} onClick={() => setFollow(true)}><ArrowDownToLine className="size-3.5" /></IconButton>
        <IconButton title="Copy log" disabled={!shown.length} onClick={() => void copyText(shown.join("\n"), "Log copied")}><Copy className="size-3.5" /></IconButton>
        <IconButton title="Clear view" disabled={!lines.length} onClick={clear}><Eraser className="size-3.5" /></IconButton>
      </Toolbar>
      <div ref={scrollRef} onScroll={onScroll} className="selectable min-h-0 flex-1 overflow-auto bg-app px-3 py-2 font-mono text-[11.5px] leading-[18px]">
        {!loaded ? null : !lines.length ? (
          <div className="font-sans text-[12px] text-faint">No log output yet. Connect to see what's happening.</div>
        ) : (
          shown.map((l, i) => (
            <div
              key={i}
              className={clsx(
                "whitespace-pre-wrap break-all",
                /\b(error|fatal|failed|denied|refused)\b/i.test(l) ? "text-danger" : /\bwarn(ing)?\b/i.test(l) ? "text-warn" : /\b(connected|initialization sequence completed|established)\b/i.test(l) ? "text-ok" : "text-fg/85",
              )}
            >
              {l || " "}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
