// "🎨 Appearance": dark / light / system, theme presets, and window glass, for all projects or
// just the one this window is focused on.
import clsx from "clsx";
import { Check, Palette as PaletteIcon, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useConnections } from "../../store/connections";
import { Button, Dialog } from "../../components/ui";
import { Segmented } from "../connections/dialog/formBits";
import { GLASS_SUPPORTED, effectiveOf, useAppearance, type Appearance, type Glass, type Mode } from "./store";
import { DARK_PRESETS, LIGHT_PRESETS, type Palette } from "./themes";

const useOpen = create<{ open: boolean; set: (o: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

export function AppearanceButton() {
  const show = useOpen((s) => s.set);
  return (
    <button onClick={() => show(true)} title="Appearance: themes and window glass" className="flex h-6 items-center rounded px-1.5 text-muted hover:bg-hover hover:text-fg">
      <PaletteIcon className="size-3.5" />
    </button>
  );
}

/** A small picture of the theme: sidebar, work area, a line of text and the accent. */
function Swatch({ p, active, onClick }: { p: Palette; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={p.name} className={clsx("group flex flex-col gap-1.5 rounded-lg border p-1.5 text-left", active ? "border-accent" : "border-line hover:border-muted")}>
      <div className="flex h-14 overflow-hidden rounded-md border" style={{ borderColor: p.line, background: p.app }}>
        <div className="w-1/3 space-y-1 border-r p-1.5" style={{ background: p.panel, borderColor: p.line }}>
          <div className="h-1 w-3/4 rounded-full" style={{ background: p.muted }} />
          <div className="h-1 w-1/2 rounded-full" style={{ background: p.faint }} />
          <div className="h-1 w-2/3 rounded-full" style={{ background: p.accent }} />
        </div>
        <div className="flex-1 space-y-1 p-1.5">
          <div className="h-1 w-4/5 rounded-full" style={{ background: p.fg }} />
          <div className="h-1 w-3/5 rounded-full" style={{ background: p.muted }} />
          <div className="mt-2 h-2.5 w-8 rounded" style={{ background: p.accent }} />
        </div>
      </div>
      <div className="flex items-center gap-1 px-0.5 text-[11.5px]">
        <span className={clsx("flex-1 truncate", active ? "font-semibold text-fg" : "text-muted")}>{p.name}</span>
        {active && <Check className="size-3 text-accent" />}
      </div>
    </button>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[12px]">
      <span className="w-28 text-muted">{label}</span>
      <input type="range" min={15} max={100} step={1} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} className="flex-1 accent-[var(--color-accent)]" />
      <span className="w-9 text-right font-mono text-[11px] text-muted">{Math.round(value * 100)}%</span>
    </label>
  );
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</div>
      {children}
      {hint && <div className="text-[11.5px] text-faint">{hint}</div>}
    </div>
  );
}

export function AppearanceDialog() {
  const { open, set: setOpen } = useOpen();
  const store = useAppearance();
  const focus = useConnections((s) => s.focusProjectId);
  const project = useConnections((s) => s.projects.find((p) => p.id === focus));
  const [scope, setScope] = useState<"all" | "project">("all");
  // Opening on a project with its own look: edit that.
  useEffect(() => { if (open) setScope(focus && store.projects[focus] ? "project" : "all"); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // "This project" only when the window is focused on one.
  const target = scope === "project" && project ? project.id : null;
  const own = !!target && !!store.projects[target];
  const a = effectiveOf(store, target);
  const set = (p: Partial<Appearance>) => store.set(p, target);
  const dark = a.mode === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : a.mode === "dark";
  const glassShown = GLASS_SUPPORTED && (a.glass === "always" || (a.glass === "dark" && dark));
  return (
    <Dialog open={open} onClose={() => setOpen(false)} width={640}
      title={<span className="flex items-center gap-2"><PaletteIcon className="size-4" />Appearance</span>}
      footer={<div className="flex w-full justify-between">
        <Button variant="ghost" disabled={!!target && !own} onClick={() => store.reset(target)}>
          <RotateCcw className="size-3.5" />{target ? "Use the global look" : "Reset"}
        </Button>
        <Button variant="primary" onClick={() => setOpen(false)}>Done</Button>
      </div>}>
      <div className="space-y-5">
        {project && (
          <Section title="Apply to"
            hint={target ? (own ? <>Windows focused on <b className="text-muted">{project.name}</b> use this look.</> : <>Change anything below to give <b className="text-muted">{project.name}</b> its own look.</>) : "Every window, except projects with their own look."}>
            <Segmented<"all" | "project"> value={scope} onChange={setScope}
              options={[{ value: "all", label: "All projects" }, { value: "project", label: `This project: ${project.name}` }]} />
          </Section>
        )}
        <Section title="Mode" hint={a.mode === "system" ? "Follows your computer's light / dark setting." : undefined}>
          <Segmented<Mode> value={a.mode} onChange={(mode) => set({ mode })}
            options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
        </Section>
        {(a.mode !== "light") && (
          <Section title={a.mode === "system" ? "Dark theme" : "Theme"}>
            <div className="grid grid-cols-4 gap-2">
              {DARK_PRESETS.map((p) => <Swatch key={p.id} p={p} active={a.dark === p.id} onClick={() => set({ dark: p.id })} />)}
            </div>
          </Section>
        )}
        {(a.mode !== "dark") && (
          <Section title={a.mode === "system" ? "Light theme" : "Theme"}>
            <div className="grid grid-cols-4 gap-2">
              {LIGHT_PRESETS.map((p) => <Swatch key={p.id} p={p} active={a.light === p.id} onClick={() => set({ light: p.id })} />)}
            </div>
          </Section>
        )}
        <Section title="Window glass"
          hint={GLASS_SUPPORTED
            ? "The window shows your desktop, blurred, behind the sidebar and work area. Editors, terminals, dialogs and menus stay solid."
            : "Window glass needs macOS or Windows."}>
          {GLASS_SUPPORTED && (
            <>
              <Segmented<Glass> value={a.glass} onChange={(glass) => set({ glass })}
                options={[{ value: "off", label: "Off" }, { value: "dark", label: "Dark mode only" }, { value: "always", label: "Always" }]} />
              {glassShown && (
                <div className="space-y-2 pt-1">
                  <Slider label="Sidebar opacity" value={a.sidebarOpacity} onChange={(sidebarOpacity) => set({ sidebarOpacity })} />
                  <Slider label="Work area opacity" value={a.workOpacity} onChange={(workOpacity) => set({ workOpacity })} />
                </div>
              )}
            </>
          )}
        </Section>
      </div>
    </Dialog>
  );
}
