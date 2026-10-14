import { create } from "zustand";

export type SidebarView = "connections" | "history";

interface UiState {
  sidebar: SidebarView;
  setSidebar: (v: SidebarView) => void;
  /** Connection dialog: null = closed, "" = new, id = edit */
  connectionDialog: { id: string | null; kind?: string } | null;
  openConnectionDialog: (id?: string | null, kind?: string) => void;
  closeConnectionDialog: () => void;
  /** Status bar message */
  status: string;
  setStatus: (s: string) => void;
}

export const useUi = create<UiState>((set) => ({
  sidebar: "connections",
  setSidebar: (sidebar) => set({ sidebar }),
  connectionDialog: null,
  openConnectionDialog: (id = null, kind) => set({ connectionDialog: { id, kind } }),
  closeConnectionDialog: () => set({ connectionDialog: null }),
  status: "Ready",
  setStatus: (status) => set({ status }),
}));
