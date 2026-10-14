// Save generated content (SQL scripts, diagram images) to a user-chosen file.
// Uses the dialog + fs plugins; falls back to a browser download when fs
// write permission is unavailable.
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { dirname, lsGet, lsSet } from "./shared";

export interface FileFilter { name: string; extensions: string[] }

function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Returns the saved path, "download" for the fallback, or null if cancelled. */
export async function saveContent(opts: {
  defaultName: string;
  filters: FileFilter[];
  content: string | Uint8Array;
  /** localStorage key for remembering the last directory */
  dirKey?: string;
  mime?: string;
}): Promise<string | null> {
  const lastDir = opts.dirKey ? lsGet<string>(`dir:${opts.dirKey}`, "") : "";
  let path: string | null = null;
  try {
    path = await save({ defaultPath: lastDir ? `${lastDir}/${opts.defaultName}` : opts.defaultName, filters: opts.filters });
  } catch {
    // dialog unavailable (plain browser) → download
    download(opts.defaultName, new Blob([opts.content as BlobPart], { type: opts.mime ?? "application/octet-stream" }));
    return "download";
  }
  if (!path) return null;
  if (opts.dirKey) lsSet(`dir:${opts.dirKey}`, dirname(path));
  if (typeof opts.content === "string") await writeTextFile(path, opts.content);
  else await writeFile(path, opts.content);
  return path;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
