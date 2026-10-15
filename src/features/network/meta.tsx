// Shared bits for the network feature: kind icons/labels, status dot, small helpers.
import clsx from "clsx";
import { Cable, Shield, ShieldHalf } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { NetKind, NetProfile, NetState, NetStatus } from "../../lib/types";

export const NET_KIND_META: Record<NetKind, { label: string; short: string; color: string }> = {
  openvpn: { label: "OpenVPN", short: "OpenVPN", color: "#f59e5b" },
  wireguard: { label: "WireGuard", short: "WireGuard", color: "#f87171" },
  ssh: { label: "SSH tunnel", short: "SSH", color: "#60a5fa" },
};

export const isVpn = (k: NetKind) => k !== "ssh";

export function NetKindIcon({ kind, className = "size-3.5" }: { kind: NetKind; className?: string }) {
  const style = { color: NET_KIND_META[kind].color };
  if (kind === "openvpn") return <Shield className={className} style={style} />;
  if (kind === "wireguard") return <ShieldHalf className={className} style={style} />;
  return <Cable className={className} style={style} />;
}

export const STATE_LABEL: Record<NetState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  disconnecting: "Disconnecting…",
  error: "Error",
};

export const stateTone = (s: NetState | undefined) =>
  s === "connected" ? "ok" : s === "connecting" || s === "disconnecting" ? "warn" : s === "error" ? "danger" : "default";

export const isBusy = (s: NetState | undefined) => s === "connecting" || s === "disconnecting";
/** States in which the primary action is "Disconnect". */
export const isUp = (s: NetState | undefined) => s === "connected" || s === "connecting";

export function StatusDot({ state, className }: { state: NetState | undefined; className?: string }) {
  return (
    <span
      title={STATE_LABEL[state ?? "disconnected"]}
      className={clsx(
        "inline-block size-2 shrink-0 rounded-full",
        state === "connected" && "bg-ok",
        isBusy(state) && "animate-pulse bg-warn",
        state === "error" && "bg-danger",
        (!state || state === "disconnected") && "bg-faint/60",
        className,
      )}
    />
  );
}

/** Small on/off switch. */
export function Switch({ on, busy, onChange, title, disabled }: { on: boolean; busy?: boolean; onChange: (v: boolean) => void; title: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={clsx(
        "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40",
        on ? (busy ? "border-warn/60 bg-warn/40" : "border-ok/60 bg-ok/40") : "border-line bg-app",
      )}
    >
      <span className={clsx("absolute size-2.5 rounded-full transition-all", on ? "left-[11px] bg-fg" : "left-px bg-muted", busy && "animate-pulse")} />
    </button>
  );
}

/** Local ports of an SSH tunnel as ":5433 :1080". */
export function portsLabel(st: NetStatus | null | undefined): string {
  return st?.state === "connected" && st.localPorts.length ? st.localPorts.map((p) => `:${p}`).join(" ") : "";
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Re-render every `ms` (for relative times). */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what === "Copied" ? `Copied ${text.length > 40 ? "to clipboard" : text}` : what);
  } catch {
    toast.error("Couldn't access the clipboard");
  }
}

export function newProfile(kind: NetKind, projectId: string | null = null): NetProfile {
  return {
    id: "", name: "", kind, projectId, color: null, autoConnect: false,
    ssh: kind === "ssh" ? { enabled: true, host: "", port: 22, user: "", auth: "key", keyPath: null, password: null } : null,
    forwards: kind === "ssh" ? [{ kind: "local", bindPort: 0, remoteHost: "", remotePort: 0 }] : [],
    vpnUser: null, vpnPassword: null, summary: null, options: {},
  };
}

export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
