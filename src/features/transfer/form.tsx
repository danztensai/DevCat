// Small form building blocks for the Data Transfer wizard pages.
import { open, save } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button, Input } from "../../components/ui";
import { errMsg } from "../../lib/api";
import type { FileFilter } from "./files";
import { dirname, joinPath, lsGet, lsSet } from "./shared";

export function Section({ title, children, className, right }: { title: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={clsx("rounded-md border border-line bg-panel", className)}>
      <div className="flex h-8 items-center border-b border-line px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</span>
        <div className="flex-1" />
        {right}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[130px_1fr] items-center gap-3 py-1">
      <span className="text-xs text-muted">{label}</span>
      <div className="min-w-0">
        {children}
        {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-app p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx("h-6 rounded px-2.5 text-xs", value === o.value ? "bg-hover text-fg" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Path input + Browse button. `dirKey` remembers the last used directory in localStorage. */
export function PathField({ value, onChange, mode, filters, defaultName, dirKey, placeholder }: {
  value: string;
  onChange: (p: string) => void;
  mode: "save" | "open" | "folder";
  filters?: FileFilter[];
  defaultName?: string;
  dirKey: string;
  placeholder?: string;
}) {
  const browse = async () => {
    try {
      const last = lsGet<string>(`dir:${dirKey}`, "");
      let p: string | null = null;
      if (mode === "save") {
        p = await save({ defaultPath: last && defaultName ? joinPath(last, defaultName) : defaultName ?? last ?? undefined, filters });
      } else {
        const r = await open({ directory: mode === "folder", multiple: false, defaultPath: value || last || undefined, filters: mode === "open" ? filters : undefined });
        p = typeof r === "string" ? r : null;
      }
      if (p) {
        lsSet(`dir:${dirKey}`, mode === "folder" ? p : dirname(p));
        onChange(p);
      }
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="flex gap-1.5">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? (mode === "folder" ? "Choose a folder…" : "Choose a file…")} className="font-mono text-xs" />
      <Button onClick={browse}><FolderOpen className="size-3.5" />Browse</Button>
    </div>
  );
}

export const DELIMITERS = [
  { value: ",", label: "Comma ( , )" },
  { value: ";", label: "Semicolon ( ; )" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe ( | )" },
];
