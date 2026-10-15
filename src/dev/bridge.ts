// Dev-only browser shims for @tauri-apps/* (vite --mode bridge): commands go to the Rust
// devbridge (`cargo run --example devbridge`); everything else is a harmless stub.
const URL_ = "http://127.0.0.1:1430/invoke";

function fallback(cmd: string): unknown {
  return /list|ids|sessions|projects|contexts|logs|traffic|history|queries/.test(cmd) ? [] : null;
}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd, args }) });
  const body = await res.json();
  if ("ok" in body) return body.ok as T;
  if (typeof body.err === "string" && body.err.startsWith("devbridge: unsupported")) return fallback(cmd) as T;
  throw body.err;
}
export const convertFileSrc = (p: string) => p;
export class Channel<T> { onmessage: (m: T) => void = () => {}; }

// event
export type UnlistenFn = () => void;
export async function listen(): Promise<UnlistenFn> { return () => {}; }
export async function emit(): Promise<void> {}

// window
export enum UserAttentionType { Critical = 1, Informational = 2 }
export function getCurrentWindow() {
  return { setTitle: async (t: string) => { document.title = t; }, setBadgeCount: async (n?: number) => { console.log("[bridge] badge", n ?? 0); }, requestUserAttention: async (t: number) => { console.log("[bridge] attention", t); }, label: "main", onFocusChanged: async () => () => {}, listen: async () => () => {} };
}
export const getCurrentWebviewWindow = getCurrentWindow;

// app
export async function getVersion() { return "0.0.0-bridge"; }

// path
export async function homeDir() { return "/Users"; }
export async function join(...p: string[]) { return p.join("/").replace(/\/+/g, "/"); }

// dialog: folder pick answers come from localStorage "devbridge.pick"
export async function open() { return localStorage.getItem("devbridge.pick"); }
export async function save() { return null; }
export async function ask() { return false; }
export async function confirm() { return false; }
export async function message() {}

// fs
export async function readTextFile() { return ""; }
export async function writeFile() {}
export async function writeTextFile() {}

// opener
export async function openUrl(u: string) { console.log("[bridge] openUrl", u); }
export async function openPath(p: string) { console.log("[bridge] openPath", p); }
export async function revealItemInDir(p: string) { console.log("[bridge] reveal", p); }
