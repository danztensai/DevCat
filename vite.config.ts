import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// `vite --mode bridge`: run the UI in a normal browser against the Rust devbridge (dev only).
const bridgeAlias = Object.fromEntries(
  ["api/core", "api/event", "api/window", "api/webviewWindow", "api/path", "plugin-dialog", "plugin-fs", "plugin-opener"]
    .map((m) => [`@tauri-apps/${m}`, new URL("./src/dev/bridge.ts", import.meta.url).pathname]),
);

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: mode === "bridge" ? { alias: bridgeAlias } : undefined,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { chunkSizeWarningLimit: 6000 },
}));
