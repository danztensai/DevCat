import { create } from "zustand";
import { api } from "../lib/api";
import type { ConnectionConfig } from "../lib/types";

interface ConnectionsState {
  connections: ConnectionConfig[];
  /** ids of connections with an open backend session */
  open: Set<string>;
  load: () => Promise<void>;
  save: (c: ConnectionConfig) => Promise<ConnectionConfig>;
  remove: (id: string) => Promise<void>;
  markOpen: (id: string, open: boolean) => void;
  byId: (id: string) => ConnectionConfig | undefined;
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  connections: [],
  open: new Set(),
  load: async () => set({ connections: await api.listConnections() }),
  save: async (c) => {
    const saved = await api.saveConnection(c);
    await get().load();
    get().markOpen(saved.id, false);
    return saved;
  },
  remove: async (id) => {
    await api.deleteConnection(id);
    get().markOpen(id, false);
    await get().load();
  },
  markOpen: (id, isOpen) =>
    set((s) => {
      const open = new Set(s.open);
      if (isOpen) open.add(id); else open.delete(id);
      return { open };
    }),
  byId: (id) => get().connections.find((c) => c.id === id),
}));

export function newConnection(kind: ConnectionConfig["kind"]): ConnectionConfig {
  return {
    id: "", name: "", kind, host: "localhost", port: null, user: "", password: "",
    database: null, filePath: null, url: null, sslMode: null, ssh: null,
    color: null, group: null, options: {}, readOnly: false,
  };
}
