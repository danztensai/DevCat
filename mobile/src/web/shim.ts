// The browser versions (`vite --mode web` / `--mode hosted`): stand in for @tauri-apps/* so the
// same screens run in a phone browser. The phone-side commands (m_*) are answered here by
// WebHost (talks to the DevCat that served the page) or, in the hosted version, RelayHost
// (through the computer's relay); camera and notifications are stubs (the QR code is scanned
// with the phone's camera app, notifications come through ntfy).
import { WebHost, deviceName, platform, saved as webSaved, setDeviceName } from "./client";
import type { RelayHost, RelaySaved } from "./relay";

type Handler = (e: { event: string; payload: unknown }) => void;
const handlers = new Map<string, Set<Handler>>();
function emit(event: string, payload: unknown) {
  handlers.get(event)?.forEach((h) => h({ event, payload }));
}

// The relay code and its WebAssembly are only in the hosted build (MODE is replaced at build
// time, so the computer's copy drops the import).
const HOSTED = import.meta.env.MODE === "hosted";
const hostP: Promise<WebHost | RelayHost> = HOSTED ? import("./relay").then((m) => new m.RelayHost(emit)) : Promise.resolve(new WebHost(emit));
let host: WebHost | RelayHost;
const saved = () => (HOSTED ? (host as RelayHost).saved() : webSaved());

function machine() {
  const s = saved();
  if (!s) return null;
  const relayed = HOSTED ? (s as RelaySaved) : null;
  return {
    id: s.hostId, name: s.hostName, addrs: relayed ? relayed.addrs : [location.host], os: s.os ?? "", appVersion: s.appVersion ?? "",
    access: s.access ?? "", addedAt: s.addedAt, lastSeen: Date.now(), manualAddrs: [], relay: relayed?.relay ?? null,
  };
}

export async function invoke<T>(cmd: string, args: Record<string, any> = {}): Promise<T> {
  host ??= await hostP;
  const r = await (async (): Promise<unknown> => {
    switch (cmd) {
      case "m_info": return { deviceId: saved()?.deviceId ?? "", deviceName: deviceName(), platform: platform(), version: "web", online: host.online() && saved() ? [saved()!.hostId] : [] };
      case "m_set_name": setDeviceName(String(args.name ?? "").trim() || deviceName()); return null;
      case "m_machines": { const m = machine(); return m ? [m] : []; }
      case "m_pair": await host.pair(String(args.link)); return machine();
      case "m_connect": return host.connect();
      case "m_call": return host.call(String(args.cmd), args.args ?? null);
      case "m_disconnect": case "m_network_changed": host.close(); return null;
      case "m_forget": host.forget(); return [];
      case "m_set_addrs": { const m = machine(); return m ? [m] : []; }
      default: throw `Not available in the browser: ${cmd}`;
    }
  })();
  return r as T;
}

export type UnlistenFn = () => void;
export async function listen(event: string, h: Handler): Promise<UnlistenFn> {
  const set = handlers.get(event) ?? new Set<Handler>();
  set.add(h);
  handlers.set(event, set);
  return () => { set.delete(h); };
}

// plugin-notification: pages served over http can't show notifications.
export async function isPermissionGranted() { return false; }
export async function requestPermission() { return "denied"; }
export function sendNotification() {}

// plugin-barcode-scanner: not in the browser (the phone's camera app opens the link instead).
export enum Format { QRCode = "QR_CODE" }
export async function checkPermissions() { return "denied"; }
export async function requestPermissions() { return "denied"; }
export async function scan(): Promise<{ content: string }> { throw new Error("Use your phone's camera app to scan the code."); }

// plugin-opener
export async function openUrl(u: string) { window.open(u, "_blank", "noopener"); }

// plugin-deep-link: only the app receives devcat:// links.
export async function getCurrent(): Promise<string[] | null> { return null; }
export async function onOpenUrl(): Promise<() => void> { return () => {}; }
