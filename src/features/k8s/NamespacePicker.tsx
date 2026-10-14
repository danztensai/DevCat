import clsx from "clsx";
import { Check, ChevronDown, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../../components/ui";

/** Multi-select namespace filter. Empty selection = all namespaces. */
export default function NamespacePicker({ namespaces, selected, onChange, disabled }: {
  namespaces: string[];
  selected: string[];
  onChange: (ns: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [open]);
  const filtered = useMemo(() => namespaces.filter((n) => n.toLowerCase().includes(q.toLowerCase())), [namespaces, q]);
  const label = disabled ? "Cluster-scoped" : selected.length === 0 ? "All namespaces" : selected.length === 1 ? selected[0] : `${selected.length} namespaces`;
  const toggle = (n: string, only: boolean) => {
    if (only) { onChange([n]); setOpen(false); return; }
    onChange(selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n]);
  };
  return (
    <div ref={ref} className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-52 items-center gap-1.5 rounded-md border border-line bg-app px-2 text-[13px] hover:border-faint disabled:opacity-50"
        title="Namespace filter"
      >
        <Layers className="size-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-40 flex max-h-96 w-64 flex-col rounded-md border border-line bg-panel shadow-2xl">
          <div className="border-b border-line p-1.5">
            <Input autoFocus placeholder="Filter namespaces…" value={q} onChange={(e) => setQ(e.target.value)} className="h-6 text-xs"
              onKeyDown={(e) => { if (e.key === "Enter" && filtered.length === 1) toggle(filtered[0], true); }} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-1 text-[13px]">
            <button className="flex h-7 w-full items-center gap-2 px-2 hover:bg-hover" onClick={() => { onChange([]); setOpen(false); }}>
              <span className="flex size-4 items-center justify-center">{selected.length === 0 && <Check className="size-3.5 text-accent" />}</span>
              All namespaces
            </button>
            <div className="my-1 h-px bg-line" />
            {filtered.map((n) => (
              <div key={n} className="group flex h-7 items-center hover:bg-hover">
                <button className="flex min-w-0 flex-1 items-center gap-2 px-2" onClick={() => toggle(n, false)}>
                  <span className={clsx("flex size-3.5 shrink-0 items-center justify-center rounded-sm border", selected.includes(n) ? "border-accent bg-accent text-accent-fg" : "border-line")}>
                    {selected.includes(n) && <Check className="size-3" />}
                  </span>
                  <span className="truncate">{n}</span>
                </button>
                <button className="mr-1 hidden rounded px-1.5 text-[11px] text-muted hover:text-fg group-hover:block" onClick={() => toggle(n, true)}>only</button>
              </div>
            ))}
            {!filtered.length && <div className="px-3 py-2 text-xs text-muted">No match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
