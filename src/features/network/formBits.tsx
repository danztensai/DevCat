// Form pieces for the network profile editor.
import clsx from "clsx";
import { Check, FileUp, FolderPlus } from "lucide-react";
import type { ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { Button, Checkbox, IconButton, Input, Select, Textarea } from "../../components/ui";
import { errMsg } from "../../lib/api";
import type { NetProfile } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { COLOR_PRESETS } from "../connections/dialog/sections";
import { Row } from "../connections/dialog/formBits";
import { createProject } from "../connections/tree/projectActions";

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-2 flex items-center gap-2 border-b border-line pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</span>
      <span className="flex-1" />
      {right}
    </div>
  );
}

/** Pick a file with the native dialog and read it as text. null = cancelled / failed (toast shown). */
export async function pickTextFile(filters?: { name: string; extensions: string[] }[], title?: string): Promise<{ path: string; text: string } | null> {
  let path: string | string[] | null;
  try {
    path = await open({ multiple: false, directory: false, title, filters: filters ? [...filters, { name: "All files", extensions: ["*"] }] : undefined });
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
  if (typeof path !== "string") return null;
  try {
    return { path, text: await readTextFile(path) };
  } catch (e) {
    toast.error(`Couldn't read ${path}: ${errMsg(e)}`);
    return null;
  }
}

const PEM_FILTERS = [{ name: "Certificates & keys", extensions: ["crt", "pem", "cer", "key", "txt"] }];

/** PEM / key textarea with "Load file…". */
export function PemField({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  const load = async () => {
    const f = await pickTextFile(PEM_FILTERS);
    if (f) onChange(f.text.trim());
  };
  return (
    <div className="flex gap-1.5">
      <Textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="resize-y text-[11px]! leading-4" />
      <div className="flex flex-col gap-1">
        <Button type="button" size="sm" onClick={load} title="Load from file"><FileUp className="size-3" />File…</Button>
        {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}>Clear</Button>}
      </div>
    </div>
  );
}

const NEW_PROJECT = "\u0000new";

/** Name / project / color / auto-connect. */
export function IdentityRows({ p, set, namePlaceholder }: { p: NetProfile; set: (patch: Partial<NetProfile>) => void; namePlaceholder: string }) {
  const projects = useConnections((s) => s.projects);
  const pickProject = async (value: string) => {
    if (value !== NEW_PROJECT) return set({ projectId: value || null });
    const created = await createProject();
    if (created) set({ projectId: created.id });
  };
  return (
    <>
      <Row label="Name">
        <Input autoFocus={!p.id} value={p.name} placeholder={namePlaceholder} onChange={(e) => set({ name: e.target.value })} />
      </Row>
      <Row label="Project" hint={!p.projectId ? "Not in a project — shown in every project's focus mode." : undefined}>
        <div className="flex items-center gap-1.5">
          <Select value={p.projectId ?? ""} onChange={(e) => void pickProject(e.target.value)} className="min-w-0 flex-1">
            <option value="">No project</option>
            {projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            <option value={NEW_PROJECT}>New project…</option>
          </Select>
          <IconButton type="button" title="New project" onClick={() => void pickProject(NEW_PROJECT)}><FolderPlus className="size-3.5" /></IconButton>
        </div>
      </Row>
      <Row label="Color">
        <div className="flex h-7 items-center gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button
              type="button"
              key={c.label}
              title={c.label}
              onClick={() => set({ color: c.value })}
              className={clsx(
                "flex size-5 items-center justify-center rounded-full border transition-transform hover:scale-110",
                c.value ? "border-transparent" : "border-line bg-app",
                (p.color ?? null) === c.value && "ring-2 ring-fg/70 ring-offset-1 ring-offset-app",
              )}
              style={c.value ? { background: c.value } : undefined}
            >
              {!c.value && <span className="h-px w-3 rotate-45 bg-faint" />}
              {c.value && (p.color ?? null) === c.value && <Check className="size-3 text-white" />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="" hint="Connect automatically when DevCat starts.">
        <Checkbox label="Auto-connect" checked={p.autoConnect} onChange={(v) => set({ autoConnect: v })} />
      </Row>
    </>
  );
}
