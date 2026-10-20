// Font settings (per computer, localStorage; shared by all DevCat windows, not per project): the
// code font used by terminals and editors, terminal size / line height, an optional editor size,
// and the UI font. Applying sets `--font-mono` / `--font-sans`; terminals and editors follow
// through `onFontsChange`.
import { create } from "zustand";

export interface Fonts {
  /** Code font family (terminals, editors); "" = the default stack. */
  mono: string;
  /** UI font family; "" = the default stack. */
  sans: string;
  terminalSize: number;
  terminalLineHeight: number;
  /** Editor font size; 0 = each editor's own size. */
  editorSize: number;
}

/** Fallbacks after the chosen font. Cascadia Mono ships with Windows 11; the symbol fonts cover
 *  block, box-drawing and status-line glyphs that Consolas and friends lack. */
const MONO_FALLBACK = '"JetBrains Mono", "Cascadia Mono", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, "DejaVu Sans Mono", monospace, "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2"';
const SANS_FALLBACK = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export const FONT_DEFAULTS: Fonts = { mono: "", sans: "", terminalSize: 13, terminalLineHeight: 1.15, editorSize: 0 };
const KEY = "devcat.fonts";

/** Well-known fonts offered in the pickers (only the installed ones are listed). */
export const MONO_CHOICES = ["JetBrains Mono", "Cascadia Mono", "Cascadia Code", "Fira Code", "Source Code Pro", "Hack", "IBM Plex Mono",
  "Ubuntu Mono", "DejaVu Sans Mono", "Menlo", "SF Mono", "Monaco", "Consolas", "Lucida Console", "MesloLGS NF", "JetBrainsMono Nerd Font",
  "CaskaydiaCove Nerd Font", "FiraCode Nerd Font"];
export const SANS_CHOICES = ["Inter", "Segoe UI", "SF Pro Text", "Helvetica Neue", "Roboto", "Ubuntu", "Noto Sans", "Open Sans", "IBM Plex Sans", "Arial"];

function load(): Fonts {
  try {
    return { ...FONT_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...FONT_DEFAULTS };
  }
}

interface Store extends Fonts {
  set: (p: Partial<Fonts>) => void;
  reset: () => void;
}

export const useFonts = create<Store>((set) => ({
  ...load(),
  set: (p) => set(p),
  reset: () => set({ ...FONT_DEFAULTS }),
}));

const quote = (f: string) => (/^[\w-]+$/.test(f) && !/^\d/.test(f) ? f : `"${f.replace(/"/g, "")}"`);
const stack = (family: string, fallback: string) => (family.trim() ? `${quote(family.trim())}, ${fallback}` : fallback);

export function fonts(): Fonts {
  const { set: _s, reset: _r, ...f } = useFonts.getState();
  return f;
}
export const monoStack = (f: Fonts = fonts()) => stack(f.mono, MONO_FALLBACK);
export const sansStack = (f: Fonts = fonts()) => stack(f.sans, SANS_FALLBACK);

/** xterm options for the current fonts. */
export function terminalFont(f: Fonts = fonts()) {
  return { fontFamily: monoStack(f), fontSize: f.terminalSize, lineHeight: f.terminalLineHeight };
}

/** Monaco options for the current fonts (size only when the user set one). */
export function editorFont(f: Fonts = fonts()): { fontFamily: string; fontSize?: number } {
  return f.editorSize > 0 ? { fontFamily: monoStack(f), fontSize: f.editorSize } : { fontFamily: monoStack(f) };
}

/** Whether `family` is installed: text measures differently than with the generic fallbacks alone. */
export function fontInstalled(family: string): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const sample = "mmmmmmmmmlli10OO@#";
  return ["monospace", "serif", "sans-serif"].some((g) => {
    ctx.font = `16px ${g}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `16px ${quote(family)}, ${g}`;
    return ctx.measureText(sample).width !== base;
  });
}

const listeners = new Set<(f: Fonts) => void>();
/** Follow font changes (terminals, editors). Returns unsubscribe. */
export function onFontsChange(f: (fonts: Fonts) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

let last = "";
function apply() {
  const f = fonts();
  const root = document.documentElement;
  root.style.setProperty("--font-mono", monoStack(f));
  root.style.setProperty("--font-sans", sansStack(f));
  const key = JSON.stringify(f);
  if (key !== last) {
    last = key;
    listeners.forEach((l) => l(f));
  }
}

let started = false;
/** Apply now and keep following changes (this window and other windows). */
export function startFonts() {
  if (started) return;
  started = true;
  apply();
  let fromOtherWindow = false;
  useFonts.subscribe(() => {
    if (!fromOtherWindow) {
      try { localStorage.setItem(KEY, JSON.stringify(fonts())); } catch { /* private mode */ }
    }
    apply();
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    fromOtherWindow = true;
    useFonts.setState(load());
    fromOtherWindow = false;
  });
}
