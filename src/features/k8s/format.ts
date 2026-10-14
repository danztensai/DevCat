// Formatting + status derivation helpers shared by the k8s views.
import { useSyncExternalStore } from "react";
import type { K8sObject } from "./api";

// ---- ticking clock (one interval for every Age cell) -----------------------
let now = Date.now();
const subs = new Set<() => void>();
setInterval(() => { now = Date.now(); subs.forEach((s) => s()); }, 1000);
export function useNow() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => now);
}

export function ts(s?: string | null): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/** kubectl-style compact age: 45s, 12m, 3h4m, 5d, 2y */
export function age(from: number, at: number = Date.now()): string {
  if (!from) return "—";
  let s = Math.max(0, Math.floor((at - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) { s %= 60; return m < 10 && s ? `${m}m${s}s` : `${m}m`; }
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 && h < 10 ? `${h}h${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 365) return d < 10 && h % 24 ? `${d}d${h % 24}h` : `${d}d`;
  return `${Math.floor(d / 365)}y${d % 365 ? `${d % 365}d` : ""}`;
}

/** Parses a Kubernetes quantity into base units (cores / bytes). */
export function parseQty(q?: string | number | null): number {
  if (q == null) return 0;
  if (typeof q === "number") return q;
  const m = /^([+-]?[0-9.]+(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/.exec(q.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult: Record<string, number> = {
    "": 1, n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
  };
  return n * (mult[m[2]] ?? 1);
}

export function fmtCpu(cores?: number | null): string {
  if (cores == null || Number.isNaN(cores)) return "—";
  if (cores === 0) return "0";
  if (cores < 1) return `${Math.round(cores * 1000)}m`;
  return cores < 10 ? `${cores.toFixed(2).replace(/\.?0+$/, "")}` : `${cores.toFixed(1).replace(/\.0$/, "")}`;
}

export function fmtBytes(b?: number | null): string {
  if (b == null || Number.isNaN(b)) return "—";
  if (b === 0) return "0";
  const u = ["B", "Ki", "Mi", "Gi", "Ti", "Pi"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b < 10 && i > 0 ? b.toFixed(1) : Math.round(b)}${u[i]}`;
}

export type Tone = "ok" | "warn" | "danger" | "info" | "default";

// ---- Pod status (mirrors kubectl's STATUS column logic) ---------------------
export function podStatus(p: K8sObject): { text: string; tone: Tone } {
  const st = p.status ?? {};
  if (p.metadata.deletionTimestamp) return { text: "Terminating", tone: "warn" };
  let reason: string = st.reason || st.phase || "Unknown";
  let initializing = false;
  const inits: K8sObject[] = st.initContainerStatuses ?? [];
  inits.forEach((c, i) => {
    if (initializing) return;
    const t = c.state?.terminated;
    if (t && t.exitCode === 0) return;
    if (t) { reason = t.reason ? `Init:${t.reason}` : `Init:ExitCode:${t.exitCode}`; initializing = true; }
    else if (c.state?.waiting?.reason && c.state.waiting.reason !== "PodInitializing") { reason = `Init:${c.state.waiting.reason}`; initializing = true; }
    else { reason = `Init:${i}/${inits.length}`; initializing = true; }
  });
  if (!initializing) {
    let hasRunning = false;
    for (const c of [...(st.containerStatuses ?? [])].reverse()) {
      if (c.state?.waiting?.reason) reason = c.state.waiting.reason;
      else if (c.state?.terminated?.reason) reason = c.state.terminated.reason;
      else if (c.state?.terminated) reason = c.state.terminated.signal ? `Signal:${c.state.terminated.signal}` : `ExitCode:${c.state.terminated.exitCode}`;
      else if (c.ready && c.state?.running) hasRunning = true;
    }
    if (reason === "Completed" && hasRunning) reason = "Running";
  }
  return { text: reason, tone: statusTone(reason) };
}

export function statusTone(s: string): Tone {
  if (/^(Running|Ready|Active|Bound|Available|Complete|Completed|Succeeded|True|Normal|Healthy|Deployed)$/i.test(s)) return s === "Completed" || s === "Succeeded" || s === "Complete" ? "info" : "ok";
  if (/Pending|ContainerCreating|PodInitializing|Init:|Terminating|Waiting|Progressing|Released|Unknown|NotReady,SchedulingDisabled|SchedulingDisabled|Suspended/i.test(s)) return "warn";
  if (/Error|Fail|BackOff|Crash|OOM|Evicted|NotReady|Lost|Invalid|Err|Warning|Unschedulable|Terminated/i.test(s)) return "danger";
  return "default";
}

export function podContainers(p: K8sObject) {
  const statuses: K8sObject[] = p.status?.containerStatuses ?? [];
  const total = (p.spec?.containers ?? []).length;
  const ready = statuses.filter((c) => c.ready).length;
  const restarts = statuses.reduce((a, c) => a + (c.restartCount ?? 0), 0);
  const lastRestart = statuses
    .map((c) => ts(c.lastState?.terminated?.finishedAt))
    .reduce((a, b) => Math.max(a, b), 0);
  return { total, ready, restarts, lastRestart, statuses };
}

export function nodeStatus(n: K8sObject): { text: string; tone: Tone } {
  const ready = (n.status?.conditions ?? []).find((c: K8sObject) => c.type === "Ready");
  let text = ready?.status === "True" ? "Ready" : "NotReady";
  if (n.spec?.unschedulable) text += ",SchedulingDisabled";
  const pressure = (n.status?.conditions ?? []).filter((c: K8sObject) => c.type !== "Ready" && c.status === "True").map((c: K8sObject) => c.type);
  if (pressure.length) text += ` (${pressure.join(", ")})`;
  return { text, tone: ready?.status === "True" ? (n.spec?.unschedulable || pressure.length ? "warn" : "ok") : "danger" };
}

export function nodeRoles(n: K8sObject): string {
  const roles = Object.keys(n.metadata.labels ?? {})
    .filter((k) => k.startsWith("node-role.kubernetes.io/"))
    .map((k) => k.slice("node-role.kubernetes.io/".length) || "—");
  return roles.join(",") || "<none>";
}

/** Pod-level summed resource requests. */
export function podRequests(p: K8sObject) {
  let cpu = 0, memory = 0;
  for (const c of p.spec?.containers ?? []) {
    cpu += parseQty(c.resources?.requests?.cpu);
    memory += parseQty(c.resources?.requests?.memory);
  }
  return { cpu, memory };
}

export function selectorString(sel?: Record<string, string> | null): string {
  return Object.entries(sel ?? {}).map(([k, v]) => `${k}=${v}`).join(",");
}

export function labelSelectorString(sel?: { matchLabels?: Record<string, string>; matchExpressions?: { key: string; operator: string; values?: string[] }[] } | null): string {
  if (!sel) return "";
  const parts = Object.entries(sel.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`);
  for (const e of sel.matchExpressions ?? []) {
    const vals = (e.values ?? []).join(",");
    if (e.operator === "In") parts.push(`${e.key} in (${vals})`);
    else if (e.operator === "NotIn") parts.push(`${e.key} notin (${vals})`);
    else if (e.operator === "Exists") parts.push(e.key);
    else if (e.operator === "DoesNotExist") parts.push(`!${e.key}`);
  }
  return parts.join(",");
}

export function eventTime(e: K8sObject): number {
  return ts(e.lastTimestamp) || ts(e.eventTime) || ts(e.series?.lastObservedTime) || ts(e.firstTimestamp) || ts(e.metadata?.creationTimestamp);
}
