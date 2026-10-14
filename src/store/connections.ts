import { create } from "zustand";
import { api } from "../lib/api";
import type { ConnectionConfig, Project } from "../lib/types";

interface ConnectionsState {
  connections: ConnectionConfig[];
  projects: Project[];
  /** ids of connections with an open backend session */
  open: Set<string>;
  load: () => Promise<void>;
  save: (c: ConnectionConfig) => Promise<ConnectionConfig>;
  remove: (id: string) => Promise<void>;
  markOpen: (id: string, open: boolean) => void;
  byId: (id: string) => ConnectionConfig | undefined;
  /** Create (no id) or update a project. */
  saveProject: (p: Pick<Project, "name"> & Partial<Project>) => Promise<Project>;
  /** Delete a project; its connections are moved out, or deleted too. */
  removeProject: (id: string, deleteConnections?: boolean) => Promise<void>;
  /** Move connections into a project (null = no project). */
  moveToProject: (ids: string[], projectId: string | null) => Promise<void>;
  reorderProjects: (ids: string[]) => Promise<void>;
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  connections: [],
  projects: [],
  open: new Set(),
  load: async () => {
    const [connections, projects] = await Promise.all([api.listConnections(), api.listProjects()]);
    set({ connections, projects });
  },
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
  saveProject: async (p) => {
    const saved = await api.saveProject({ id: "", color: null, description: null, order: 0, ...p });
    await get().load();
    return saved;
  },
  removeProject: async (id, deleteConnections = false) => {
    const members = get().connections.filter((c) => c.projectId === id).map((c) => c.id);
    await api.deleteProject(id, deleteConnections);
    if (deleteConnections) members.forEach((m) => get().markOpen(m, false));
    await get().load();
  },
  moveToProject: async (ids, projectId) => {
    // Optimistic so drag & drop feels instant; reload reconciles.
    set((s) => ({ connections: s.connections.map((c) => (ids.includes(c.id) ? { ...c, projectId } : c)) }));
    try {
      await api.moveConnections(ids, projectId);
    } finally {
      await get().load();
    }
  },
  reorderProjects: async (ids) => {
    set((s) => ({ projects: ids.map((id) => s.projects.find((p) => p.id === id)!).filter(Boolean) }));
    const projects = await api.reorderProjects(ids);
    set({ projects });
  },
}));

export function newConnection(kind: ConnectionConfig["kind"], projectId: string | null = null): ConnectionConfig {
  return {
    id: "", name: "", kind, host: "localhost", port: null, user: "", password: "",
    database: null, filePath: null, url: null, sslMode: null, ssh: null,
    color: null, group: null, projectId, options: {}, readOnly: false,
  };
}
