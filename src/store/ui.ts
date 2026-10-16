import { create } from "zustand";

/** "claude" = the AI workspace (internal id kept). */
export type SidebarView = "claude" | "connections" | "history" | "network" | "git" | "notes";

interface UiState {
  sidebar: SidebarView;
  setSidebar: (v: SidebarView) => void;
  /** Connection dialog: null = closed; id = edit, else new (optionally preselecting kind / project). */
  connectionDialog: { id: string | null; kind?: string; projectId?: string | null } | null;
  openConnectionDialog: (id?: string | null, kind?: string, projectId?: string | null) => void;
  closeConnectionDialog: () => void;
  /** Status bar message */
  status: string;
  setStatus: (s: string) => void;
}

export const useUi = create<UiState>((set) => ({
  sidebar: "claude",
  setSidebar: (sidebar) => set({ sidebar }),
  connectionDialog: null,
  openConnectionDialog: (id = null, kind, projectId) => set({ connectionDialog: { id, kind, projectId } }),
  closeConnectionDialog: () => set({ connectionDialog: null }),
  status: "Ready",
  setStatus: (status) => set({ status }),
}));
