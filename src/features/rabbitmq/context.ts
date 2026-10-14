import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api";

export type View =
  | "overview" | "queues" | "exchanges" | "connections" | "channels" | "consumers"
  | "vhosts" | "access" | "nodes";

export interface Focus { view: View; vhost: string; name: string }

export interface RabbitCtx {
  connId: string;
  readOnly: boolean;
  /** "" = all vhosts */
  vhost: string;
  vhosts: string[];
  search: string;
  useRegex: boolean;
  /** Increments on every auto-refresh tick and manual refresh. */
  tick: number;
  refresh: () => void;
  /** Jump to a queue/exchange/connection detail from anywhere. */
  focus: Focus | null;
  open: (f: Focus) => void;
}

export const Ctx = createContext<RabbitCtx | null>(null);

export function useRabbit(): RabbitCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRabbit outside RabbitTab");
  return c;
}

/** The vhost to use for create actions when "All vhosts" is selected. */
export function writeVhost(c: RabbitCtx): string {
  return c.vhost || (c.vhosts.includes("/") ? "/" : c.vhosts[0] ?? "/");
}

/**
 * Fetch on mount, whenever `deps` change and on every refresh tick.
 * Keeps the previous data while refetching; overlapping polls are skipped.
 */
export function usePoll<T>(fetcher: () => Promise<T>, deps: unknown[], opts: { enabled?: boolean } = {}) {
  const { tick } = useRabbit();
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);
  const gen = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const run = useCallback(async (force: boolean) => {
    if (inflight.current && !force) return;
    const my = ++gen.current;
    inflight.current = true;
    setLoading(true);
    try {
      const d = await fetchRef.current();
      if (my === gen.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === gen.current) setError(errMsg(e));
    } finally {
      if (my === gen.current) { inflight.current = false; setLoading(false); }
    }
  }, []);

  // deps changed -> forced reload (discarding stale in-flight results)
  useEffect(() => {
    if (enabled) void run(true);
  }, [enabled, run, ...deps]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (enabled && document.visibilityState !== "hidden") void run(false);
  }, [tick, enabled, run]);

  return { data, error, loading, reload: () => run(true), setData };
}

/** Run an action with toasts; rethrows so confirm dialogs stay open on failure. */
export async function act(p: Promise<unknown>, ok: string) {
  try {
    await p;
    toast.success(ok);
  } catch (e) {
    toast.error(errMsg(e));
    throw e;
  }
}
