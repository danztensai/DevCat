// OpenVPN form <-> .ovpn text. Pure functions (no React / Tauri) so they are easy to test.

export interface OvpnForm {
  host: string;
  port: number;
  proto: "udp" | "tcp";
  dev: "tun" | "tap";
  ca: string;
  cert: string;
  key: string;
  /** shared HMAC key; mode decides <tls-auth> vs <tls-crypt> */
  tlsKey: string;
  tlsMode: "none" | "tls-auth" | "tls-crypt";
  /** key-direction for tls-auth ("" = omit) */
  keyDirection: "" | "0" | "1";
  /** data-ciphers list, e.g. "AES-256-GCM:AES-128-GCM" ("" = OpenVPN default) */
  cipher: string;
  /** HMAC digest, e.g. "SHA256" ("" = default) */
  auth: string;
  compress: "none" | "lz4" | "lz4-v2";
  authUserPass: boolean;
  /** Any other directives, one per line, kept verbatim. */
  extra: string;
}

export const emptyOvpnForm = (): OvpnForm => ({
  host: "", port: 1194, proto: "udp", dev: "tun",
  ca: "", cert: "", key: "", tlsKey: "", tlsMode: "none", keyDirection: "1",
  cipher: "AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305", auth: "SHA256", compress: "none",
  authUserPass: false, extra: "",
});

/** Directives the generator always writes; dropped when parsed back with these exact values. */
const BOILERPLATE: Record<string, string> = {
  client: "",
  "resolv-retry": "infinite",
  nobind: "",
  "persist-key": "",
  "persist-tun": "",
  "remote-cert-tls": "server",
  verb: "3",
};

const block = (tag: string, body: string) => {
  const b = body.trim();
  return b ? [`<${tag}>`, b, `</${tag}>`] : [];
};

export function generateOvpn(f: OvpnForm): string {
  const out: string[] = ["client", `dev ${f.dev}`, `proto ${f.proto}`];
  if (f.host.trim()) out.push(`remote ${f.host.trim()} ${f.port || 1194}`);
  out.push("resolv-retry infinite", "nobind", "persist-key", "persist-tun", "remote-cert-tls server");
  if (f.cipher.trim()) out.push(`data-ciphers ${f.cipher.trim()}`);
  if (f.auth.trim()) out.push(`auth ${f.auth.trim()}`);
  if (f.compress !== "none") out.push(`compress ${f.compress}`);
  if (f.authUserPass) out.push("auth-user-pass");
  if (f.tlsMode === "tls-auth" && f.tlsKey.trim() && f.keyDirection) out.push(`key-direction ${f.keyDirection}`);
  out.push("verb 3");
  const extra = f.extra.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  if (extra.length) out.push("", ...extra);
  const blocks = [
    ...block("ca", f.ca),
    ...block("cert", f.cert),
    ...block("key", f.key),
    ...(f.tlsMode !== "none" ? block(f.tlsMode, f.tlsKey) : []),
  ];
  if (blocks.length) out.push("", ...blocks);
  return out.join("\n") + "\n";
}

export type ParseResult<T> = { ok: true; form: T; notes: string[] } | { ok: false; reason: string };

const INLINE_FIELDS: Record<string, "ca" | "cert" | "key" | "tls-auth" | "tls-crypt"> = {
  ca: "ca", cert: "cert", key: "key", "tls-auth": "tls-auth", "tls-crypt": "tls-crypt",
};

/** Parse .ovpn text into the form. Fails only for things the form cannot represent. */
export function parseOvpn(text: string): ParseResult<OvpnForm> {
  const f: OvpnForm = { ...emptyOvpnForm(), cipher: "", auth: "", keyDirection: "" };
  const extra: string[] = [];
  const notes: string[] = [];
  let remotes = 0;
  let comments = 0;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith(";")) { comments++; continue; }
    const open = line.match(/^<([\w-]+)>$/);
    if (open) {
      const tag = open[1];
      const end = lines.findIndex((l, j) => j > i && l.trim() === `</${tag}>`);
      if (end < 0) return { ok: false, reason: `Unclosed <${tag}> block.` };
      const body = lines.slice(i + 1, end).join("\n").trim();
      const field = INLINE_FIELDS[tag];
      if (!field) return { ok: false, reason: `Inline <${tag}> blocks aren't supported by the form.` };
      if (field === "tls-auth" || field === "tls-crypt") { f.tlsMode = field; f.tlsKey = body; }
      else f[field] = body;
      i = end;
      continue;
    }
    const [name, ...args] = line.split(/\s+/);
    const arg = args.join(" ");
    switch (name) {
      case "remote": {
        remotes++;
        if (remotes > 1) { extra.push(line); break; }
        f.host = args[0] ?? "";
        const port = parseInt(args[1] ?? "", 10);
        if (Number.isFinite(port)) f.port = port;
        if (args[2]) f.proto = args[2].startsWith("tcp") ? "tcp" : "udp";
        break;
      }
      case "port": { const p = parseInt(arg, 10); if (Number.isFinite(p)) f.port = p; break; }
      case "proto": f.proto = arg.startsWith("tcp") ? "tcp" : "udp"; break;
      case "dev":
        if (arg === "tun" || arg === "tap") f.dev = arg;
        else if (arg.startsWith("tap")) { f.dev = "tap"; notes.push(`"dev ${arg}" simplified to "dev tap".`); }
        else { f.dev = "tun"; if (arg !== "tun") notes.push(`"dev ${arg}" simplified to "dev tun".`); }
        break;
      case "data-ciphers": case "ncp-ciphers": f.cipher = arg; break;
      // Kept as written: unlike data-ciphers it is also the fallback for servers that can't negotiate.
      case "cipher": extra.push(line); break;
      case "auth": f.auth = arg; break;
      case "compress":
        if (!arg) f.compress = "none";
        else if (arg === "lz4" || arg === "lz4-v2") f.compress = arg;
        else extra.push(line);
        break;
      case "comp-lzo": if (arg !== "no") extra.push(line); break;
      case "auth-user-pass":
        f.authUserPass = true;
        if (arg) notes.push("auth-user-pass file reference dropped: DevCat supplies the username/password.");
        break;
      case "key-direction": f.keyDirection = arg === "0" ? "0" : arg === "1" ? "1" : ""; break;
      default:
        if (name in BOILERPLATE && BOILERPLATE[name] === arg) break;
        extra.push(line);
    }
  }
  if (remotes > 1) notes.push(`${remotes - 1} additional remote(s) kept in "Extra directives".`);
  if (comments) notes.push("Comments are dropped when editing with the form.");
  f.extra = extra.join("\n");
  return { ok: true, form: f, notes };
}
