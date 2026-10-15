// Title-bar toggle that keeps the screen and system awake (like Caffeine / Amphetamine).
// Click: on (until turned off) / off. Right-click: for a set time.
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { Coffee, Power, Timer } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import type { KeepAwakeState } from "../../lib/types";
import { useContextMenu, type MenuItem } from "../connections/ContextMenu";

const DURATIONS: [number, string][] = [[15, "15 minutes"], [60, "1 hour"], [120, "2 hours"], [300, "5 hours"], [480, "8 hours"]];

function remaining(until: number, now: number): string {
  const mins = Math.max(0, Math.ceil((until - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

export function KeepAwakeButton() {
  const [state, setState] = useState<KeepAwakeState>({ on: false });
  const [now, setNow] = useState(() => Date.now());
  const menu = useContextMenu();

  // Shared by all windows: read once, then follow the backend's broadcasts.
  useEffect(() => {
    api.keepAwakeStatus().then((s) => { if (s) setState(s); }).catch(() => {});
    const un = listen<KeepAwakeState>("keep-awake", (e) => setState(e.payload));
    return () => { void un.then((f) => f()); };
  }, []);
  useEffect(() => {
    if (!state.until) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    setNow(Date.now());
    return () => clearInterval(t);
  }, [state.until]);

  const set = async (on: boolean, minutes?: number) => {
    try {
      const s = await api.keepAwakeSet(on, minutes ?? null);
      if (s) setState(s);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    const items: MenuItem[] = [
      ...DURATIONS.map(([m, label]): MenuItem => ({ label: `Keep awake for ${label}`, icon: <Timer className="size-3.5" />, onClick: () => void set(true, m) })),
      { label: "Keep awake until turned off", icon: <Coffee className="size-3.5" />, onClick: () => void set(true) },
      "separator",
      { label: "Allow sleep", icon: <Power className="size-3.5" />, disabled: !state.on, onClick: () => void set(false) },
    ];
    menu.show(e, items);
  };

  const left = state.on && state.until ? remaining(state.until, now) : null;
  const title = state.on
    ? `Keeping the screen awake${left ? ` for ${left} more` : ""}. Click to allow sleep. Right-click for a set time.`
    : "Keep the screen awake. Right-click for a set time.";

  return (
    <>
      <button
        title={title}
        aria-pressed={state.on}
        onClick={() => void set(!state.on)}
        onContextMenu={openMenu}
        className={clsx(
          "flex h-6 items-center gap-1 rounded px-1.5 text-[11px] tabular-nums",
          state.on ? "bg-accent/20 text-accent hover:bg-accent/30" : "text-muted hover:bg-hover hover:text-fg",
        )}
      >
        <Coffee className="size-3.5" />
        {left}
      </button>
      {menu.element}
    </>
  );
}
