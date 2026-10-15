// Claude sidebar state: current workspace folder + recent folders (persisted in localStorage).
import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

const KEY_CWD = "devcat.claude.cwd";
const KEY_RECENT = "devcat.claude.recent";
const KEY_IGNORED = "devcat.claude.showIgnored";
const KEY_SPLIT = "devcat.claude.sessionsOpen";
const MAX_RECENT = 10;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota / private mode */ }
}

interface WorkspaceState {
  cwd: string | null;
  recent: string[];
  showIgnored: boolean;
  sessionsOpen: boolean;
  setCwd: (cwd: string | null) => void;
  forgetRecent: (cwd: string) => void;
  setShowIgnored: (v: boolean) => void;
  setSessionsOpen: (v: boolean) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  cwd: load<string | null>(KEY_CWD, null),
  recent: load<string[]>(KEY_RECENT, []),
  showIgnored: load(KEY_IGNORED, false),
  sessionsOpen: load(KEY_SPLIT, true),
  setCwd: (cwd) => {
    const recent = cwd ? [cwd, ...get().recent.filter((r) => r !== cwd)].slice(0, MAX_RECENT) : get().recent;
    save(KEY_CWD, cwd);
    save(KEY_RECENT, recent);
    set({ cwd, recent });
  },
  forgetRecent: (cwd) => {
    const recent = get().recent.filter((r) => r !== cwd);
    save(KEY_RECENT, recent);
    set({ recent });
  },
  setShowIgnored: (showIgnored) => { save(KEY_IGNORED, showIgnored); set({ showIgnored }); },
  setSessionsOpen: (sessionsOpen) => { save(KEY_SPLIT, sessionsOpen); set({ sessionsOpen }); },
}));

/** Ask for a folder with the native picker; sets it as the workspace. */
export async function pickFolder(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false, defaultPath: useWorkspace.getState().cwd ?? undefined });
  if (typeof dir !== "string") return null;
  useWorkspace.getState().setCwd(dir);
  return dir;
}
