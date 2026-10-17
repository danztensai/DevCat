import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";

// DevCat Mobile frontend (mobile/src).
// `--mode web`: the browser version DevCat serves to phone browsers (→ dist-web, embedded in the
//   desktop app by src-tauri/build.rs).
// `--mode bridge`: run it in a normal browser against the mobile bridge (`cargo run --example
//   bridge` in mobile/src-tauri) for UI testing.
const host = process.env.TAURI_DEV_HOST;
const root = new URL(".", import.meta.url).pathname;
const bridge = new URL("./src/dev/bridge.ts", import.meta.url).pathname;
const web = new URL("./src/web/shim.ts", import.meta.url).pathname;
const shimmed = ["api/core", "api/event", "plugin-notification", "plugin-barcode-scanner", "plugin-opener", "plugin-deep-link"];

export default defineConfig(({ mode }) => ({
  root,
  plugins: [react(), tailwindcss()],
  resolve: mode === "bridge" || mode === "web"
    ? { alias: Object.fromEntries(shimmed.map((m) => [`@tauri-apps/${m}`, mode === "web" ? web : bridge])) }
    : undefined,
  clearScreen: false,
  server: {
    port: 1440,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1441 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { outDir: mode === "web" ? "dist-web" : "dist", emptyOutDir: true, chunkSizeWarningLimit: 3000 },
}));
