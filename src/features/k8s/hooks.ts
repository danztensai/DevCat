import { useCallback, useEffect, useRef, useState } from "react";
import { errMsg } from "../../lib/api";
import { events, eventsReady, k8s, type K8sObject, type UsageItem } from "./api";

/**
 * Live list of a kind via the backend watch stream. `namespaces` null/empty = all namespaces.
 * For several selected namespaces one watch per namespace is started (works with
 * namespace-scoped RBAC). Updates are coalesced and flushed at most every 250ms.
 */
export function useWatchList(connId: string, kind: string | null, namespaced: boolean, namespaces: string[] | null) {
  const [items, setItems] = useState<K8sObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non-fatal error while data is already shown (watch reconnecting). */
  const [warning, setWarning] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const nsKey = namespaced && namespaces?.length ? [...namespaces].sort().join(",") : "";

  useEffect(() => {
    if (!kind) return;
    let cancelled = false;
    const targets: (string | null)[] = nsKey ? nsKey.split(",") : [null];
    const maps = new Map<string | null, Map<string, K8sObject>>();
    const synced = new Set<string | null>();
    const streamIds: string[] = [];
    const offs: (() => void)[] = [];
    let dirty = false;

    setItems([]);
    setLoading(true);
    setError(null);
    setWarning(null);

    const flush = () => {
      if (!dirty || cancelled) return;
      dirty = false;
      const all: K8sObject[] = [];
      maps.forEach((m) => m.forEach((o) => all.push(o)));
      setItems(all);
    };
    const timer = setInterval(flush, 250);

    (async () => {
      await eventsReady();
      for (const t of targets) {
        if (cancelled) return;
        maps.set(t, new Map());
        let id: string;
        try {
          id = await k8s.watchStart(connId, kind, t);
        } catch (e) {
          if (!cancelled) { setError(errMsg(e)); setLoading(false); }
          return;
        }
        if (cancelled) { k8s.streamStop(id).catch(() => {}); return; }
        streamIds.push(id);
        offs.push(events.watch.on(id, (ev) => {
          const m = maps.get(t)!;
          switch (ev.type) {
            case "Restarted": {
              m.clear();
              for (const o of (ev.object as K8sObject[]) ?? []) m.set(o.metadata.uid, o);
              synced.add(t);
              if (synced.size === targets.length) { setLoading(false); setError(null); }
              setWarning(null);
              dirty = true;
              flush();
              break;
            }
            case "Added":
            case "Modified": {
              const o = ev.object as K8sObject;
              m.set(o.metadata.uid, o);
              dirty = true;
              break;
            }
            case "Deleted": {
              m.delete((ev.object as K8sObject).metadata.uid);
              dirty = true;
              break;
            }
            case "Error":
              if (synced.has(t)) setWarning(ev.error ?? "watch error");
              else { setError(ev.error ?? "watch error"); setLoading(false); }
              break;
          }
        }));
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      offs.forEach((f) => f());
      streamIds.forEach((id) => k8s.streamStop(id).catch(() => {}));
    };
  }, [connId, kind, nsKey, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { items, loading, error, warning, retry };
}

/** Polls metrics.k8s.io. Returns null map when metrics-server is unavailable. */
export function useMetrics(connId: string, kind: "pods" | "nodes" | null, namespace: string | null, intervalMs = 30000) {
  const [metrics, setMetrics] = useState<Map<string, UsageItem> | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (!kind) { setMetrics(null); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await k8s.metrics(connId, kind, namespace);
        if (cancelled) return;
        setAvailable(r.available);
        if (!r.available) { setMetrics(null); return; }
        const m = new Map<string, UsageItem>();
        for (const it of r.items) m.set(kind === "pods" ? `${it.namespace}/${it.name}` : it.name, it);
        setMetrics(m);
      } catch {
        if (!cancelled) { setAvailable(false); setMetrics(null); }
      }
    };
    load();
    const t = setInterval(load, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [connId, kind, namespace, intervalMs]);
  return { metrics, available };
}

/** Async loader with loading/error state and manual reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const run = async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const d = await fnRef.current();
        if (!cancelled) { setData(d); setError(null); }
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run(true);
    const t = pollMs ? setInterval(() => run(false), pollMs) : undefined;
    return () => { cancelled = true; if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, pollMs]);
  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []), setData };
}
