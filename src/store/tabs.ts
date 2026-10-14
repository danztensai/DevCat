import { create } from "zustand";
import type { Tab, TabSpec } from "../tabs/types";

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** Open a tab. If `key` matches an existing tab it is focused instead. */
  open: (spec: TabSpec, title: string, key?: string) => string;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  activate: (id: string) => void;
  update: (id: string, patch: Partial<Tab>) => void;
}

let seq = 0;

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [{ id: "welcome", type: "welcome", title: "Welcome" }],
  activeId: "welcome",
  open: (spec, title, key) => {
    const id = key ?? `${spec.type}-${++seq}`;
    if (get().tabs.some((t) => t.id === id)) {
      set({ activeId: id });
      return id;
    }
    set((s) => ({ tabs: [...s.tabs, { ...spec, id, title } as Tab], activeId: id }));
    return id;
  },
  close: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeId = s.activeId;
      if (activeId === id) activeId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
      return { tabs, activeId };
    }),
  closeOthers: (id) => set((s) => ({ tabs: s.tabs.filter((t) => t.id === id), activeId: id })),
  activate: (id) => set({ activeId: id }),
  update: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) })),
}));

/** Convenience helpers used across features. */
export const openTab = (spec: TabSpec, title: string, key?: string) => useTabs.getState().open(spec, title, key);
