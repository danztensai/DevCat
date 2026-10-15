// PTY event bus: one global listener for "pty-output" / "pty-exit", dispatched by pty id.
// Output that arrives before a subscriber exists (ptyOpen still resolving) is buffered.
import { listen } from "@tauri-apps/api/event";

type OutFn = (bytes: Uint8Array) => void;
type ExitFn = (code: number | null) => void;

const outSubs = new Map<string, OutFn>();
const exitSubs = new Map<string, ExitFn>();
const pendingOut = new Map<string, Uint8Array[]>();
const pendingExit = new Map<string, number | null>();
/** Ptys we detached from: drop their late events instead of buffering. */
const closed = new Set<string>();

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let ready: Promise<void> | null = null;
/** Subscribe once to the backend events. Await before ptyOpen so no output is lost. */
export function ptyEventsReady(): Promise<void> {
  if (!ready) {
    ready = Promise.all([
      listen<{ id: string; data: string }>("pty-output", (e) => {
        const bytes = b64ToBytes(e.payload.data);
        const fn = outSubs.get(e.payload.id);
        if (fn) fn(bytes);
        else if (!closed.has(e.payload.id)) {
          const buf = pendingOut.get(e.payload.id) ?? [];
          if (buf.length < 5000) buf.push(bytes);
          pendingOut.set(e.payload.id, buf);
        }
      }),
      listen<{ id: string; code?: number | null }>("pty-exit", (e) => {
        const fn = exitSubs.get(e.payload.id);
        if (fn) fn(e.payload.code ?? null);
        else if (!closed.has(e.payload.id)) pendingExit.set(e.payload.id, e.payload.code ?? null);
      }),
    ]).then(() => undefined);
  }
  return ready;
}

/** Attach handlers to a pty (flushes anything buffered). Returns an unsubscribe function. */
export function subscribePty(id: string, onOut: OutFn, onExit: ExitFn): () => void {
  outSubs.set(id, onOut);
  exitSubs.set(id, onExit);
  pendingOut.get(id)?.forEach(onOut);
  pendingOut.delete(id);
  if (pendingExit.has(id)) {
    const c = pendingExit.get(id) ?? null;
    pendingExit.delete(id);
    onExit(c);
  }
  return () => {
    closed.add(id);
    outSubs.delete(id);
    exitSubs.delete(id);
    pendingOut.delete(id);
    pendingExit.delete(id);
  };
}
