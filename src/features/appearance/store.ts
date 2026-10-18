// Appearance settings (per computer, localStorage; shared by all DevCat windows): dark / light /
// system mode, a preset for each, and window glass (macOS vibrancy, Windows Acrylic). A project
// can have its own look (`projects[id]`, over the global one); a window focused on that project
// shows it. Applying sets the design-token CSS variables, the native window theme and effects;
// terminals and editors follow through `palette()` / `onPaletteChange`.
import { getCurrentWindow, Effect, EffectState } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { IS_MAC } from "../../lib/windows";
import { findPreset, withAlpha, type Palette } from "./themes";

export type Mode = "dark" | "light" | "system";
export type Glass = "off" | "dark" | "always";
/** Blur: the desktop shows through blurred (vibrancy / Acrylic). Clear: as it is. */
export type GlassStyle = "blur" | "clear";

export interface Appearance {
  mode: Mode;
  dark: string;
  light: string;
  glass: Glass;
  glassStyle: GlassStyle;
  /** How much the sidebar / work area tint covers the glass (0.01–1). */
  sidebarOpacity: number;
  workOpacity: number;
}

const DEFAULTS: Appearance = { mode: "dark", dark: "devcat", light: "light", glass: "off", glassStyle: "blur", sidebarOpacity: 0.45, workOpacity: 0.7 };
const KEYS = Object.keys(DEFAULTS) as (keyof Appearance)[];
const KEY = "devcat.appearance";
const IS_LINUX = navigator.userAgent.toLowerCase().includes("linux");
/** Window glass needs macOS or Windows. */
export const GLASS_SUPPORTED = !IS_LINUX;

interface Saved extends Appearance {
  /** Per-project looks (all settings, copied from the global one when first customised). */
  projects: Record<string, Partial<Appearance>>;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULTS, ...raw, projects: raw.projects ?? {} };
  } catch {
    return { ...DEFAULTS, projects: {} };
  }
}

interface Store extends Saved {
  /** The project this window is focused on (its look applies, if it has one). */
  focus: string | null;
  /** Change the global look, or project `project`'s. */
  set: (p: Partial<Appearance>, project?: string | null) => void;
  /** Back to defaults (global), or drop a project's own look. */
  reset: (project?: string | null) => void;
  setFocus: (id: string | null) => void;
}

export const useAppearance = create<Store>((set, get) => ({
  ...load(),
  focus: null,
  set: (p, project) => {
    if (!project) return set(p);
    set({ projects: { ...get().projects, [project]: { ...effectiveOf(get(), project), ...p } } });
  },
  reset: (project) => {
    if (!project) return set({ ...DEFAULTS });
    const { [project]: _gone, ...projects } = get().projects;
    set({ projects });
  },
  setFocus: (focus) => set({ focus }),
}));

/** The look for `project` (its own, else the global one). */
export function effectiveOf(s: Saved, project: string | null): Appearance {
  const global = Object.fromEntries(KEYS.map((k) => [k, s[k]])) as unknown as Appearance;
  const own = project ? s.projects[project] : undefined;
  return own ? { ...global, ...own } : global;
}

/** The look of this window now. */
export function effective(): Appearance {
  const s = useAppearance.getState();
  return effectiveOf(s, s.focus);
}

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function paletteOf(a: Appearance): Palette {
  const dark = a.mode === "system" ? systemDark.matches : a.mode === "dark";
  return findPreset(dark ? a.dark : a.light, dark);
}

/** The palette in use now. */
export function palette(): Palette {
  return paletteOf(effective());
}

/** Glass is showing now. */
export function glassOn(a: Appearance = effective()): boolean {
  return GLASS_SUPPORTED && (a.glass === "always" || (a.glass === "dark" && paletteOf(a).dark));
}

const listeners = new Set<(p: Palette, glass: boolean) => void>();
/** Follow theme changes (terminals, editors; `glass`: make backgrounds see-through). Returns unsubscribe. */
export function onPaletteChange(f: (p: Palette, glass: boolean) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

let lastEffect: string | null = null;
async function windowLook(p: Palette, glass: boolean, style: GlassStyle, mode: Mode) {
  const w = getCurrentWindow();
  // Native title bar and vibrancy material follow the theme ("system": the OS decides).
  await w.setTheme(mode === "system" ? null : p.dark ? "dark" : "light").catch(() => {});
  const effect = glass && style === "blur" ? "blur" : "none";
  if (effect === lastEffect) return;
  lastEffect = effect;
  try {
    if (effect === "blur") {
      await w.setEffects({ effects: IS_MAC ? [Effect.UnderWindowBackground] : [Effect.Acrylic], state: EffectState.Active });
    } else {
      await w.clearEffects();
    }
  } catch (e) {
    console.warn("window effects:", e);
  }
}

let lastPalette = "";
function apply() {
  const a = effective();
  const p = paletteOf(a);
  const glass = glassOn(a);
  const root = document.documentElement;
  const vars: Record<string, string> = {
    app: p.app, panel: p.panel, raised: p.raised, hover: p.hover, line: p.line, fg: p.fg, muted: p.muted, faint: p.faint,
    accent: p.accent, "accent-fg": p.accentFg, ok: p.ok, warn: p.warn, danger: p.danger, info: p.info,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--color-${k}`, v);
  root.style.setProperty("--scrollbar", p.dark ? "#2f3540" : "#c4c9d2");
  root.style.setProperty("--scrollbar-hover", p.dark ? "#3d4452" : "#aab0bb");
  // Glass: one tint per region (index.css); surfaces inside are clear, raised ones a light veil.
  const veil = (o: number) => (p.dark ? `rgba(255, 255, 255, ${o})` : `rgba(0, 0, 0, ${o})`);
  root.style.setProperty("--glass-work-tint", withAlpha(p.panel, a.workOpacity));
  root.style.setProperty("--glass-side-tint", withAlpha(p.app, a.sidebarOpacity));
  root.style.setProperty("--glass-raised", veil(p.dark ? 0.06 : 0.04));
  root.style.setProperty("--glass-hover", veil(p.dark ? 0.1 : 0.07));
  for (const k of ["app", "panel", "raised", "hover"] as const) root.style.setProperty(`--solid-${k}`, p[k]);
  root.classList.toggle("glass", glass);
  root.classList.toggle("light", !p.dark);
  root.style.colorScheme = p.dark ? "dark" : "light";
  void windowLook(p, glass, a.glassStyle, a.mode);
  const key = JSON.stringify([p, glass]);
  if (key !== lastPalette) {
    lastPalette = key;
    listeners.forEach((f) => f(p, glass));
  }
}

let started = false;
/** Apply now and keep following changes (this window, other windows, the OS theme). */
export function startAppearance() {
  if (started) return;
  started = true;
  apply();
  const savedPart = (st: Store) => {
    const { set: _s, reset: _r, setFocus: _f, focus: _x, ...saved } = st;
    return JSON.stringify(saved);
  };
  let lastSaved = savedPart(useAppearance.getState());
  let fromOtherWindow = false;
  useAppearance.subscribe((s) => {
    // Save real setting changes made here (not this window's focus, not another window's save).
    const json = savedPart(s);
    if (json !== lastSaved && !fromOtherWindow) {
      try { localStorage.setItem(KEY, json); } catch { /* private mode */ }
    }
    lastSaved = json;
    apply();
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    fromOtherWindow = true;
    useAppearance.setState(load());
    fromOtherWindow = false;
  });
  systemDark.addEventListener("change", () => {
    if (effective().mode === "system") apply();
  });
}

/** Re-renders when dark / light changes (system mode and project looks included). */
export function useIsDark(): boolean {
  const mode = useAppearance((s) => effectiveOf(s, s.focus).mode);
  const [sys, setSys] = useState(systemDark.matches);
  useEffect(() => {
    const h = () => setSys(systemDark.matches);
    systemDark.addEventListener("change", h);
    return () => systemDark.removeEventListener("change", h);
  }, []);
  return mode === "system" ? sys : mode === "dark";
}
