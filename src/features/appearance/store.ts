// Appearance settings (per computer, localStorage; shared by all DevCat windows): dark / light /
// system mode, a preset for each, and window glass (macOS vibrancy, Windows Acrylic). Applying
// them sets the design-token CSS variables, the native window theme and effects; terminals and
// editors follow through `palette()` / `onPaletteChange`.
import { getCurrentWindow, Effect, EffectState } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { IS_MAC } from "../../lib/windows";
import { findPreset, withAlpha, type Palette } from "./themes";

export type Mode = "dark" | "light" | "system";
export type Glass = "off" | "dark" | "always";

export interface Appearance {
  mode: Mode;
  dark: string;
  light: string;
  glass: Glass;
  /** Opacity of the sidebar and the work area over the glass (0.3–1). */
  sidebarOpacity: number;
  workOpacity: number;
}

const DEFAULTS: Appearance = { mode: "dark", dark: "devcat", light: "light", glass: "off", sidebarOpacity: 0.55, workOpacity: 0.82 };
const KEY = "devcat.appearance";
const IS_LINUX = navigator.userAgent.toLowerCase().includes("linux");
/** Window glass needs macOS or Windows. */
export const GLASS_SUPPORTED = !IS_LINUX;

function load(): Appearance {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULTS; }
}

interface Store extends Appearance {
  set: (p: Partial<Appearance>) => void;
  reset: () => void;
}

export const useAppearance = create<Store>((set) => ({
  ...load(),
  set: (p) => set(p),
  reset: () => set(DEFAULTS),
}));

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

/** The palette in use now. */
export function palette(): Palette {
  const a = useAppearance.getState();
  const dark = a.mode === "system" ? systemDark.matches : a.mode === "dark";
  return findPreset(dark ? a.dark : a.light, dark);
}

/** Glass is showing now. */
export function glassOn(a: Appearance = useAppearance.getState()): boolean {
  return GLASS_SUPPORTED && (a.glass === "always" || (a.glass === "dark" && palette().dark));
}

const listeners = new Set<(p: Palette) => void>();
/** Follow theme changes (terminals, editors). Returns unsubscribe. */
export function onPaletteChange(f: (p: Palette) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

let lastEffect = "";
async function windowLook(p: Palette, glass: boolean, mode: Mode) {
  const w = getCurrentWindow();
  // Native title bar and vibrancy material follow the theme ("system": the OS decides).
  await w.setTheme(mode === "system" ? null : p.dark ? "dark" : "light").catch(() => {});
  const key = `${glass}`;
  if (key === lastEffect) return;
  lastEffect = key;
  if (glass) {
    await w.setEffects({ effects: IS_MAC ? [Effect.Sidebar] : [Effect.Acrylic], state: EffectState.Active }).catch(() => {});
  } else {
    await w.clearEffects().catch(() => {});
  }
}

function apply() {
  const a = useAppearance.getState();
  const p = palette();
  const glass = glassOn(a);
  const root = document.documentElement;
  const vars: Record<string, string> = {
    app: p.app, panel: p.panel, raised: p.raised, hover: p.hover, line: p.line, fg: p.fg, muted: p.muted, faint: p.faint,
    accent: p.accent, "accent-fg": p.accentFg, ok: p.ok, warn: p.warn, danger: p.danger, info: p.info,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--color-${k}`, v);
  root.style.setProperty("--scrollbar", p.dark ? "#2f3540" : "#c4c9d2");
  root.style.setProperty("--scrollbar-hover", p.dark ? "#3d4452" : "#aab0bb");
  // Glass: see-through surfaces inside the window layout (dialogs and menus stay solid).
  const glassVars = (o: number) => ({
    "--glass-app": withAlpha(p.app, o),
    "--glass-panel": withAlpha(p.panel, o),
    "--glass-raised": withAlpha(p.raised, Math.min(1, o + 0.1)),
  });
  for (const [k, v] of Object.entries(glassVars(a.workOpacity))) root.style.setProperty(k.replace("--glass", "--glass-work"), v);
  for (const [k, v] of Object.entries(glassVars(a.sidebarOpacity))) root.style.setProperty(k.replace("--glass", "--glass-side"), v);
  root.style.setProperty("--solid-app", p.app);
  root.style.setProperty("--solid-panel", p.panel);
  root.style.setProperty("--solid-raised", p.raised);
  root.classList.toggle("glass", glass);
  root.classList.toggle("light", !p.dark);
  root.style.colorScheme = p.dark ? "dark" : "light";
  void windowLook(p, glass, a.mode);
  listeners.forEach((f) => f(p));
}

let started = false;
/** Apply now and keep following changes (this window, other windows, the OS theme). */
export function startAppearance() {
  if (started) return;
  started = true;
  apply();
  useAppearance.subscribe((s) => {
    const { set: _s, reset: _r, ...a } = s;
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode */ }
    apply();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) useAppearance.setState(load());
  });
  systemDark.addEventListener("change", () => {
    if (useAppearance.getState().mode === "system") apply();
  });
}

/** Re-renders when dark / light changes (system mode included). */
export function useIsDark(): boolean {
  const mode = useAppearance((s) => s.mode);
  const [sys, setSys] = useState(systemDark.matches);
  useEffect(() => {
    const h = () => setSys(systemDark.matches);
    systemDark.addEventListener("change", h);
    return () => systemDark.removeEventListener("change", h);
  }, []);
  return mode === "system" ? sys : mode === "dark";
}
