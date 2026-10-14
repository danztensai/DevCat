import clsx from "clsx";
import { ChevronDown, ChevronUp, ScrollText, SquareTerminal, X } from "lucide-react";
import { useRef } from "react";
import { IconButton } from "../../components/ui";
import LogsPanel, { type LogTarget } from "./LogsPanel";
import ShellPanel, { type ShellTarget } from "./ShellPanel";

export type DockSession =
  | ({ id: string; type: "logs" } & LogTarget)
  | ({ id: string; type: "shell" } & ShellTarget);

export default function Dock({ connId, sessions, activeId, setActive, close, height, setHeight, collapsed, setCollapsed }: {
  connId: string;
  sessions: DockSession[];
  activeId: string | null;
  setActive: (id: string) => void;
  close: (id: string) => void;
  height: number;
  setHeight: (h: number) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
}) {
  const drag = useRef<{ y: number; h: number } | null>(null);
  if (!sessions.length) return null;

  const onDown = (e: React.MouseEvent) => {
    drag.current = { y: e.clientY, h: height };
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      setHeight(Math.max(140, Math.min(window.innerHeight * 0.8, drag.current.h + drag.current.y - ev.clientY)));
    };
    const up = () => { drag.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="flex shrink-0 flex-col border-t border-line bg-panel" style={{ height: collapsed ? 30 : height }}>
      {!collapsed && <div onMouseDown={onDown} className="-mt-1 h-1 shrink-0 cursor-row-resize hover:bg-accent/60" />}
      <div className="flex h-[29px] shrink-0 items-stretch border-b border-line bg-app">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); close(s.id); } else { setActive(s.id); setCollapsed(false); } }}
              className={clsx(
                "group flex max-w-64 shrink-0 cursor-default items-center gap-1.5 border-r border-line pl-2.5 pr-1 text-xs",
                s.id === activeId ? "bg-panel text-fg" : "text-muted hover:bg-panel/60",
              )}
            >
              {s.type === "logs" ? <ScrollText className="size-3.5 shrink-0 text-info" /> : <SquareTerminal className="size-3.5 shrink-0 text-ok" />}
              <span className="truncate">{s.pod}</span>
              <button
                aria-label="Close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => close(s.id)}
                className="rounded p-0.5 opacity-60 hover:bg-hover hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <IconButton title={collapsed ? "Expand" : "Collapse"} className="my-auto mr-1" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </IconButton>
      </div>
      <div className={clsx("relative min-h-0 flex-1", collapsed && "hidden")}>
        {/* Keep every session mounted so streams and terminals survive tab switches. */}
        {sessions.map((s) => (
          <div key={s.id} className={clsx("absolute inset-0", s.id !== activeId && "invisible")}>
            {s.type === "logs"
              ? <LogsPanel connId={connId} target={s} visible={s.id === activeId && !collapsed} />
              : <ShellPanel connId={connId} target={s} visible={s.id === activeId && !collapsed} />}
          </div>
        ))}
      </div>
    </div>
  );
}
