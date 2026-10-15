// Git sidebar state: folder scanned for repositories + recent folders + depth (persisted in localStorage).
import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { useWorkspace } from "../claude/sidebar/workspace";

const KEY_ROOT = "devcat.git.root";
const KEY_RECENT = "devcat.git.recent";
const KEY_DEPTH = "devcat.git.depth";
const MAX_RECENT = 10;
export const DEFAULT_DEPTH = 6;

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

interface ScanState {
  /** null = follow the Claude workspace folder. */
  root: string | null;
  recent: string[];
  depth: number;
  setRoot: (root: string | null) => void;
  forgetRecent: (root: string) => void;
  setDepth: (depth: number) => void;
}

export const useGitScan = create<ScanState>((set, get) => ({
  root: load<string | null>(KEY_ROOT, null),
  recent: load<string[]>(KEY_RECENT, []),
  depth: load(KEY_DEPTH, DEFAULT_DEPTH),
  setRoot: (root) => {
    const recent = root ? [root, ...get().recent.filter((r) => r !== root)].slice(0, MAX_RECENT) : get().recent;
    save(KEY_ROOT, root);
    save(KEY_RECENT, recent);
    set({ root, recent });
  },
  forgetRecent: (root) => {
    const recent = get().recent.filter((r) => r !== root);
    save(KEY_RECENT, recent);
    set({ recent });
  },
  setDepth: (depth) => { save(KEY_DEPTH, depth); set({ depth }); },
}));

/** Folder to scan: the chosen one, else the Claude workspace folder. */
export function useScanRoot(): string | null {
  const root = useGitScan((s) => s.root);
  const cwd = useWorkspace((s) => s.cwd);
  return root ?? cwd;
}

/** Ask for a folder with the native picker; sets it as the scan root. */
export async function pickScanRoot(current: string | null): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false, defaultPath: current ?? undefined });
  if (typeof dir !== "string") return null;
  useGitScan.getState().setRoot(dir);
  return dir;
}
