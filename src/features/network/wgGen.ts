// WireGuard form <-> .conf text. Pure functions (no React / Tauri) so they are easy to test.
import type { ParseResult } from "./ovpnGen";

export interface WgPeer {
  publicKey: string;
  presharedKey: string;
  endpoint: string;
  allowedIps: string;
  keepalive: string;
  /** Other keys of this [Peer] section, kept verbatim ("Key = value"). */
  extra: string[];
}

export interface WgForm {
  privateKey: string;
  address: string;
  dns: string;
  mtu: string;
  /** Other [Interface] keys (ListenPort, PostUp, Table…), kept verbatim. */
  extra: string[];
  peers: WgPeer[];
}

export const FULL_TUNNEL = "0.0.0.0/0, ::/0";

export const emptyWgPeer = (): WgPeer => ({ publicKey: "", presharedKey: "", endpoint: "", allowedIps: FULL_TUNNEL, keepalive: "25", extra: [] });
export const emptyWgForm = (): WgForm => ({ privateKey: "", address: "", dns: "", mtu: "", extra: [], peers: [emptyWgPeer()] });

const kv = (k: string, v: string) => (v.trim() ? [`${k} = ${v.trim()}`] : []);

export function generateWg(f: WgForm): string {
  const out = [
    "[Interface]",
    ...kv("PrivateKey", f.privateKey),
    ...kv("Address", f.address),
    ...kv("DNS", f.dns),
    ...kv("MTU", f.mtu),
    ...f.extra,
  ];
  for (const p of f.peers) {
    out.push(
      "",
      "[Peer]",
      ...kv("PublicKey", p.publicKey),
      ...kv("PresharedKey", p.presharedKey),
      ...kv("Endpoint", p.endpoint),
      ...kv("AllowedIPs", p.allowedIps),
      ...kv("PersistentKeepalive", p.keepalive),
      ...p.extra,
    );
  }
  return out.join("\n") + "\n";
}

export function parseWg(text: string): ParseResult<WgForm> {
  const f: WgForm = { privateKey: "", address: "", dns: "", mtu: "", extra: [], peers: [] };
  const notes: string[] = [];
  let section: "interface" | "peer" | null = null;
  let comments = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith(";")) { comments++; continue; }
    const sec = line.match(/^\[(\w+)\]$/);
    if (sec) {
      const name = sec[1].toLowerCase();
      if (name === "interface") section = "interface";
      else if (name === "peer") { section = "peer"; f.peers.push({ ...emptyWgPeer(), allowedIps: "", keepalive: "" }); }
      else return { ok: false, reason: `Unknown section [${sec[1]}].` };
      continue;
    }
    const m = line.match(/^([\w-]+)\s*=\s*(.*)$/);
    if (!m || !section) return { ok: false, reason: `Can't read line: ${line}` };
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (section === "interface") {
      if (key === "privatekey") f.privateKey = val;
      else if (key === "address") f.address = f.address ? `${f.address}, ${val}` : val;
      else if (key === "dns") f.dns = f.dns ? `${f.dns}, ${val}` : val;
      else if (key === "mtu") f.mtu = val;
      else f.extra.push(line);
    } else {
      const p = f.peers[f.peers.length - 1];
      if (key === "publickey") p.publicKey = val;
      else if (key === "presharedkey") p.presharedKey = val;
      else if (key === "endpoint") p.endpoint = val;
      else if (key === "allowedips") p.allowedIps = p.allowedIps ? `${p.allowedIps}, ${val}` : val;
      else if (key === "persistentkeepalive") p.keepalive = val;
      else p.extra.push(line);
    }
  }
  if (!f.peers.length) f.peers.push(emptyWgPeer());
  const kept = f.extra.length + f.peers.reduce((n, p) => n + p.extra.length, 0);
  if (kept) notes.push(`${kept} other key(s) (e.g. ${[...f.extra, ...f.peers.flatMap((p) => p.extra)][0].split("=")[0].trim()}) are kept as-is.`);
  if (comments) notes.push("Comments are dropped when editing with the form.");
  return { ok: true, form: f, notes };
}

/** True when AllowedIPs routes all traffic through the tunnel. */
export const isFullTunnel = (allowed: string) => allowed.split(",").map((s) => s.trim()).some((s) => s === "0.0.0.0/0" || s === "::/0");
