// Dense editable-table building blocks shared by the designer sub-editors.
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

/** Text input that fills a grid cell. `row`/`field` enable arrow-key navigation (see gridKeyNav). */
export function CellInput({ row, field, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { row: number; field: string }) {
  return (
    <input
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      data-row={row}
      data-field={field}
      {...p}
      className={clsx(
        "h-[26px] w-full min-w-0 bg-transparent px-1.5 font-mono text-[12px] text-inherit placeholder:text-faint outline-none",
        "focus:bg-app focus:shadow-[inset_0_0_0_1px_var(--color-accent)] disabled:text-faint",
        className,
      )}
    />
  );
}

export function CellCheck({ checked, onChange, disabled, title, row, field }:
  { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string; row: number; field: string }) {
  return (
    <div className="flex h-[26px] items-center justify-center">
      <input
        type="checkbox"
        title={title}
        data-row={row}
        data-field={field}
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--color-accent)] disabled:opacity-40"
      />
    </div>
  );
}

/** Arrow up/down moves focus to the same field in the adjacent row. Attach to the <table> onKeyDown. */
export function gridKeyNav(e: KeyboardEvent<HTMLElement>, onRowFocus?: (row: number) => void) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const t = e.target as HTMLElement;
  if (t.getAttribute("list") && t instanceof HTMLInputElement && t.value) return; // let the datalist handle arrows
  const row = Number(t.dataset.row);
  const field = t.dataset.field;
  if (Number.isNaN(row) || !field) return;
  const next = row + (e.key === "ArrowDown" ? 1 : -1);
  const el = e.currentTarget.querySelector<HTMLElement>(`[data-row="${next}"][data-field="${field}"]`);
  if (el) {
    e.preventDefault();
    el.focus();
    if (el instanceof HTMLInputElement && el.type === "text") el.select();
    onRowFocus?.(next);
  }
}

export function Th({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return (
    <th title={title} className={clsx("sticky top-0 z-10 h-7 border-r border-b border-line bg-raised px-1.5 text-left text-[11px] font-medium text-muted whitespace-nowrap", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("border-r border-b border-line/60 p-0 align-middle", className)}>{children}</td>;
}

/** Ordered multi-select for column lists (index / FK columns). */
export function ColumnsPicker({ value, options, onChange, disabled, placeholder = "choose…", row, field }:
  { value: string[]; options: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string; row: number; field: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 200 });

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const height = Math.min(320, options.length * 26 + 40);
    const top = r.bottom + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 2) : r.bottom + 2;
    setPos({ left: r.left, top, width: Math.max(200, r.width) });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", down, true); window.removeEventListener("keydown", key); };
  }, [open]);

  const toggle = (c: string) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  const missing = value.filter((v) => !options.includes(v));

  return (
    <>
      <button
        ref={btn}
        type="button"
        data-row={row}
        data-field={field}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-[26px] w-full min-w-0 items-center gap-1 px-1.5 text-left font-mono text-[12px] hover:bg-hover focus:bg-app focus:shadow-[inset_0_0_0_1px_var(--color-accent)] focus:outline-none disabled:text-faint"
      >
        <span className={clsx("flex-1 truncate", !value.length && "text-faint")}>{value.length ? value.join(", ") : placeholder}</span>
        <ChevronDown className="size-3 shrink-0 text-faint" />
      </button>
      {open && (
        <div
          ref={pop}
          className="fixed z-[70] max-h-80 overflow-auto rounded-md border border-line bg-raised py-1 shadow-2xl shadow-black/50"
          style={pos}
        >
          <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-faint">Click in key order</div>
          {[...options, ...missing].map((c) => {
            const idx = value.indexOf(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className="flex h-[26px] w-full items-center gap-2 px-2.5 text-left font-mono text-[12px] hover:bg-hover"
              >
                <span className={clsx("flex size-4 items-center justify-center rounded-sm border text-[10px]", idx >= 0 ? "border-accent bg-accent text-accent-fg" : "border-line")}>
                  {idx >= 0 ? (value.length > 1 ? idx + 1 : <Check className="size-3" />) : null}
                </span>
                <span className={clsx("truncate", missing.includes(c) && "text-danger")}>{c}</span>
              </button>
            );
          })}
          {!options.length && <div className="px-2.5 py-1 text-xs text-faint">No columns</div>}
        </div>
      )}
    </>
  );
}

/** Small action strip above each sub-editor. */
export function EditorBar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-1.5">
      {children}
      <div className="flex-1" />
      {right}
    </div>
  );
}
