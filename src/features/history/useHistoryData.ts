// Loads history entries + saved queries; refreshes on window focus and when notified.
import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { api, errMsg } from "../../lib/api";
import type { HistoryEntry, SavedQuery } from "../../lib/types";

/** Bump to make every mounted history view reload (call after running/saving queries). */
const useHistoryBus = create<{ version: number }>(() => ({ version: 0 }));
export const notifyHistoryChanged = () => useHistoryBus.setState((s) => ({ version: s.version + 1 }));

export function useHistoryData(opts: { search: string; connectionId?: string | null; limit?: number }) {
  const { search, connectionId = null, limit = 500 } = opts;
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = useHistoryBus((s) => s.version);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const [h, s] = await Promise.all([
        api.historyList(connectionId, search.trim() || null, limit),
        api.savedQueries(),
      ]);
      if (my !== seq.current) return;
      setHistory(h);
      setSaved([...s].sort((a, b) => a.name.localeCompare(b.name)));
      setError(null);
    } catch (e) {
      if (my === seq.current) setError(errMsg(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [connectionId, search, limit]);

  // Debounce search typing; other changes reload immediately-ish.
  useEffect(() => {
    const t = setTimeout(refresh, 180);
    return () => clearTimeout(t);
  }, [refresh, version]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { history, saved, loading, error, refresh };
}
