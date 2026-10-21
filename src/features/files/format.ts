// Small helpers shared by the file tree and the file preview tab.
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { openTab } from "../../store/tabs";

export function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

/** `path` relative to `root` when it lies inside it, else `path` unchanged. */
export function relPath(path: string, root?: string | null): string {
  if (!root) return path;
  const r = root.replace(/[\\/]+$/, "");
  if (path === r) return ".";
  if (path.startsWith(r + "/") || path.startsWith(r + "\\")) return path.slice(r.length + 1);
  return path;
}

export function extOf(name: string): string {
  const b = basename(name).toLowerCase();
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1) : "";
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/** "just now", "5m ago", "3h ago", "2d ago", else a short date. */
export function relTime(iso?: string | null, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: s > 86400 * 300 ? "numeric" : undefined });
}

export async function copyText(text: string, what?: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what ?? (text.length > 48 ? "Copied to clipboard" : `Copied ${text}`));
  } catch {
    toast.error("Couldn't access the clipboard");
  }
}

/** Put a local file or folder itself on the clipboard (paste attaches it in Slack, copies it in Explorer / Finder). */
export async function copyFile(path: string) {
  try {
    await api.fsCopyFiles([path]);
    toast.success(`Copied ${basename(path)}`, { description: "Paste it in Slack, a mail or Explorer / Finder" });
  } catch (e) {
    toast.error(String(e));
  }
}

/** Drag data type for files dragged from DevCat's own file tree (a JSON array of paths). */
export const DRAG_PATHS = "application/x-devcat-paths";

/** What the system file manager is called: "Reveal in Finder" / "Show in Explorer" / "Show in folder". */
export const REVEAL_LABEL = (() => {
  const p = navigator.platform.toLowerCase();
  return p.includes("mac") ? "Reveal in Finder" : p.includes("win") ? "Show in Explorer" : "Show in folder";
})();

export async function revealPath(path: string) {
  try {
    await revealItemInDir(path);
  } catch (e) {
    toast.error(`Couldn't reveal: ${String(e)}`);
  }
}

export async function openExternally(path: string) {
  try {
    await api.fsOpenExternal(path);
  } catch (e) {
    toast.error(String(e));
  }
}

/** Open (or focus) the preview tab for a file. */
export function openFilePreview(path: string, root?: string | null) {
  return openTab({ type: "file", path, root: root ?? null }, basename(path), `file:${path}`);
}
