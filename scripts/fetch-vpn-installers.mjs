// Windows builds: download the official OpenVPN / WireGuard MSIs pinned in
// src-tauri/vpn-installers.json into src-tauri/vpn-installers/ (bundled as app resources),
// verifying each SHA-256. Files already present with the right hash are kept.
// Usage: node scripts/fetch-vpn-installers.mjs [x64|arm64]   (default x64)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");
const manifest = JSON.parse(readFileSync(join(root, "vpn-installers.json"), "utf8"));
const arch = process.argv[2] ?? "x64";
const outDir = join(root, "vpn-installers");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

for (const [tool, t] of Object.entries(manifest)) {
  if (tool.startsWith("_")) continue;
  const f = t.files[arch];
  if (!f) throw new Error(`${tool}: no installer for ${arch}`);
  const dest = join(outDir, f.url.split("/").pop());
  if (existsSync(dest) && sha256(readFileSync(dest)) === f.sha256) {
    console.log(`${tool}: ${dest} is up to date`);
    continue;
  }
  console.log(`${tool}: downloading ${f.url}`);
  const res = await fetch(f.url);
  if (!res.ok) throw new Error(`${tool}: HTTP ${res.status} for ${f.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== f.sha256) throw new Error(`${tool}: checksum mismatch for ${f.url} (got ${got})`);
  writeFileSync(dest, buf);
  console.log(`${tool}: ok (${(buf.length / 1048576).toFixed(1)} MB)`);
}
