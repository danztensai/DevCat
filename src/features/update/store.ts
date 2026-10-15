// App update state: background checks (main window only), the popup, download progress.
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { create } from "zustand";
import { api, errMsg } from "../../lib/api";
import type { UpdateInfo } from "../../lib/types";

const KEY_SKIP = "devcat.update.skip";
const FIRST_CHECK_MS = 8_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

type Phase = "idle" | "checking" | "available" | "downloading" | "restarting" | "error";

interface UpdateState {
  phase: Phase;
  info: UpdateInfo | null;
  /** Popup visible (an update stays in the status bar after "Later"). */
  open: boolean;
  downloaded: number;
  total: number | null;
  error: string | null;
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  later: () => void;
  skip: () => void;
  show: () => void;
}

export const useUpdate = create<UpdateState>((set, get) => ({
  phase: "idle",
  info: null,
  open: false,
  downloaded: 0,
  total: null,
  error: null,

  check: async (manual = false) => {
    const { phase } = get();
    if (phase === "checking" || phase === "downloading" || phase === "restarting") return;
    set({ phase: "checking", error: null });
    try {
      const info = await api.updateCheck();
      if (!info) {
        set({ phase: "idle", info: null });
        if (manual) toast.success("DevCat is up to date");
        return;
      }
      const skipped = localStorage.getItem(KEY_SKIP) === info.version;
      set({ phase: "available", info, open: manual || !skipped });
    } catch (e) {
      // Background checks fail quietly (offline, GitHub down); manual ones say why.
      set({ phase: get().info ? "available" : "idle" });
      if (manual) toast.error(errMsg(e));
    }
  },

  install: async () => {
    set({ phase: "downloading", downloaded: 0, total: null, error: null, open: true });
    const un = await listen<{ downloaded: number; total?: number | null }>("update-progress", (e) =>
      set({ downloaded: e.payload.downloaded, total: e.payload.total ?? null }));
    try {
      await api.updateInstall();
      // On success the app restarts (Windows: the installer takes over).
      set({ phase: "restarting" });
    } catch (e) {
      set({ phase: "error", error: errMsg(e) });
    } finally {
      un();
    }
  },

  later: () => set({ open: false }),
  skip: () => {
    const v = get().info?.version;
    if (v) localStorage.setItem(KEY_SKIP, v);
    set({ open: false });
  },
  show: () => set({ open: true }),
}));

let started = false;
/** Check shortly after launch, then every few hours. */
export function startUpdateChecks() {
  if (started) return;
  started = true;
  setTimeout(() => void useUpdate.getState().check(), FIRST_CHECK_MS);
  setInterval(() => void useUpdate.getState().check(), EVERY_MS);
}
