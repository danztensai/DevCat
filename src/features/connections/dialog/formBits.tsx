// Small form building blocks used by the connection dialog sections.
import clsx from "clsx";
import { Eye, EyeOff, FolderOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button, Input } from "../../../components/ui";
import { errMsg } from "../../../lib/api";

/** Two-column label/control row; keeps the dense form aligned. */
export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] items-start gap-3">
      <span className="pt-1.5 text-right text-xs text-muted">{label}</span>
      <div className="flex min-w-0 flex-col gap-1">
        {children}
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
    </div>
  );
}

export function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        autoComplete="new-password"
        onChange={(e) => onChange(e.target.value)}
        className="pr-8"
      />
      <button
        type="button"
        tabIndex={-1}
        title={show ? "Hide" : "Show"}
        onClick={() => setShow((s) => !s)}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 text-faint hover:text-fg"
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

/** Text input with a Browse button backed by the native file dialog. */
export function FileInput({ value, onChange, placeholder, mode = "open", filters, createLabel }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mode?: "open" | "open+save";
  filters?: { name: string; extensions: string[] }[];
  createLabel?: string;
}) {
  const browse = async () => {
    try {
      const p = await open({ multiple: false, directory: false, filters });
      if (typeof p === "string") onChange(p);
    } catch (e) { toast.error(errMsg(e)); }
  };
  const create = async () => {
    try {
      const p = await save({ filters, defaultPath: "database.sqlite" });
      if (p) onChange(p);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="flex gap-1.5">
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      <Button type="button" onClick={browse} title="Choose an existing file"><FolderOpen className="size-3.5" />Browse</Button>
      {mode === "open+save" && <Button type="button" onClick={create} title="Pick a location for a new file">{createLabel ?? "Create new"}</Button>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-7 rounded-md border border-line bg-app p-0.5">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx("rounded px-2.5 text-xs", value === o.value ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
