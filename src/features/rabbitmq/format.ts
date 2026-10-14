import type { RateDetails, Sample } from "./api";

export function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "–";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + "k";
  return n.toLocaleString();
}

export function fmtRate(r: number | null | undefined): string {
  if (r == null || Number.isNaN(r)) return "–";
  if (r === 0) return "0/s";
  if (r < 10) return r.toFixed(1) + "/s";
  return fmtNum(Math.round(r)) + "/s";
}

export function fmtBytes(b: number | null | undefined): string {
  if (b == null || Number.isNaN(b)) return "–";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = b;
  while (Math.abs(v) >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1)) + " " + u[i];
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "–";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const rate = (d: RateDetails | undefined | null) => d?.rate ?? 0;

/** Cumulative counter samples (newest first) -> per-second rates keyed by timestamp. */
export function counterRates(samples: Sample[] | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!samples || samples.length < 2) return out;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const dt = (a.timestamp - b.timestamp) / 1000;
    if (dt > 0) out.set(a.timestamp, Math.max(0, (a.sample - b.sample) / dt));
  }
  return out;
}

/** Gauge samples (e.g. queue lengths) keyed by timestamp. */
export function gaugeSamples(samples: Sample[] | undefined): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of samples ?? []) out.set(s.timestamp, s.sample);
  return out;
}

export function jsonPretty(text: string): string | null {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return null; }
}

export function argsSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  return Object.entries(args).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ");
}
