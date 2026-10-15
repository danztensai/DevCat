// Network profiles (VPN / SSH tunnels): list, live status, logs and tool availability.
// Live state comes from the backend events "net-status" and "net-log"; `initNetwork()`
// subscribes once (idempotent) and is called by every consumer hook.
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { api, errMsg } from "../../lib/api";
import type { NetProfile, NetStatus, NetTools } from "../../lib/types";
import { useConnections } from "../../store/connections";

/** Max log lines kept per profile in the UI. */
const LOG_CAP = 5000;

interface NetStoreState {
  profiles: NetProfile[];
  loaded: boolean;
  error: string | null;
  statuses: Record<string, NetStatus>;
  /** null = unknown (backend not ready / failed) */
  tools: NetTools | null;
  /** Log lines per profile; only kept for profiles whose logs were requested. */
  logs: Record<string, string[]>;
  load: () => Promise<void>;
  loadStatus: () => Promise<void>;
  loadTools: () => Promise<void>;
  loadLogs: (id: string) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  save: (p: NetProfile, configText?: string | null) => Promise<NetProfile>;
  remove: (id: string) => Promise<void>;
}

const idle = (id: string): NetStatus => ({ id, state: "disconnected", localPorts: [] });

export const useNet = create<NetStoreState>((set, get) => {
  const setStatus = (s: NetStatus) => set((st) => ({ statuses: { ...st.statuses, [s.id]: { ...s, localPorts: s.localPorts ?? [] } } }));
  return {
    profiles: [],
    loaded: false,
    error: null,
    statuses: {},
    tools: null,
    logs: {},
    load: async () => {
      try {
        const profiles = await api.netList();
        set({ profiles, loaded: true, error: null });
      } catch (e) {
        set({ loaded: true, error: errMsg(e) });
      }
    },
    loadStatus: async () => {
      try {
        const list = await api.netStatus();
        set({ statuses: Object.fromEntries(list.map((s) => [s.id, { ...s, localPorts: s.localPorts ?? [] }])) });
      } catch { /* backend not ready: everything is disconnected */ }
    },
    loadTools: async () => {
      try { set({ tools: await api.netTools() }); } catch { set({ tools: null }); }
    },
    loadLogs: async (id) => {
      try {
        const lines = await api.netLogs(id);
        set((st) => ({ logs: { ...st.logs, [id]: lines.slice(-LOG_CAP) } }));
      } catch {
        set((st) => ({ logs: { ...st.logs, [id]: st.logs[id] ?? [] } }));
      }
    },
    connect: async (id) => {
      setStatus({ ...(get().statuses[id] ?? idle(id)), state: "connecting", error: null, since: new Date().toISOString() });
      try {
        await api.netConnect(id);
      } catch (e) {
        setStatus({ ...(get().statuses[id] ?? idle(id)), state: "error", error: errMsg(e), since: new Date().toISOString() });
        throw e;
      }
    },
    disconnect: async (id) => {
      const prev = get().statuses[id] ?? idle(id);
      setStatus({ ...prev, state: "disconnecting" });
      try {
        await api.netDisconnect(id);
      } catch (e) {
        setStatus({ ...prev, error: errMsg(e) });
        throw e;
      }
    },
    save: async (p, configText) => {
      const saved = await api.netSave(p, configText);
      await get().load();
      return saved;
    },
    remove: async (id) => {
      await api.netDelete(id);
      set((st) => {
        const statuses = { ...st.statuses };
        delete statuses[id];
        return { statuses, profiles: st.profiles.filter((p) => p.id !== id) };
      });
      await get().load();
    },
  };
});

let unlisteners: Promise<UnlistenFn>[] | null = null;

/** Subscribe to backend events and load the initial data. Safe to call many times. */
export function initNetwork() {
  if (unlisteners) return;
  const st = useNet.getState();
  unlisteners = [
    listen<NetStatus>("net-status", (e) => {
      const s = e.payload;
      useNet.setState((cur) => ({ statuses: { ...cur.statuses, [s.id]: { ...s, localPorts: s.localPorts ?? [] } } }));
    }),
    listen<{ id: string; lines: string[] }>("net-log", (e) => {
      const { id, lines } = e.payload;
      useNet.setState((cur) => {
        const prev = cur.logs[id];
        if (!prev) return {}; // nobody is watching this profile's logs yet
        const next = prev.concat(lines);
        return { logs: { ...cur.logs, [id]: next.length > LOG_CAP ? next.slice(-LOG_CAP) : next } };
      });
    }),
  ];
  // Listener registration fails outside Tauri (plain browser): ignore.
  unlisteners.forEach((p) => p.catch(() => {}));
  void st.load();
  void st.loadStatus();
  void st.loadTools();
}

// HMR: drop the old listeners when this module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unlisteners?.forEach((p) => p.then((u) => u()).catch(() => {}));
    unlisteners = null;
  });
}

export function useNetProfiles(): NetProfile[] {
  useEffect(initNetwork, []);
  return useNet((s) => s.profiles);
}

/** Profiles visible under project focus mode: the focused project's + unassigned ones. */
export function useScopedNetProfiles(): NetProfile[] {
  const profiles = useNetProfiles();
  const focus = useConnections((s) => s.focusProjectId);
  return useMemo(() => (focus ? profiles.filter((p) => !p.projectId || p.projectId === focus) : profiles), [profiles, focus]);
}

export function useNetStatus(id: string | null | undefined): NetStatus | null {
  useEffect(initNetwork, []);
  return useNet((s) => (id ? s.statuses[id] ?? null : null));
}

export const netProfileById = (id: string) => useNet.getState().profiles.find((p) => p.id === id);
