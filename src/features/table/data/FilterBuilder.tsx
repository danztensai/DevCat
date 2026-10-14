// Popover for building a WHERE clause from column/operator/value rows.
import MiniSelect from "../../grid/MiniSelect";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton, Input } from "../../../components/ui";
import type { ColumnInfo, Dialect } from "../../../lib/types";
import { buildWhere, needsValue, OPERATORS, type Condition, type Operator } from "./filterSql";

interface Props {
  columns: ColumnInfo[];
  dialect: Dialect;
  onApply: (where: string) => void;
  onClose: () => void;
}

const blank = (column = ""): Condition => ({ column, op: "=", value: "", value2: "" });

export default function FilterBuilder({ columns, dialect, onApply, onClose }: Props) {
  const [conds, setConds] = useState<Condition[]>(() => [blank(columns[0]?.name)]);
  const [join, setJoin] = useState<"AND" | "OR">("AND");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [onClose]);

  const set = (i: number, patch: Partial<Condition>) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const preview = buildWhere(dialect, conds, join, columns);
  const apply = () => { onApply(preview); onClose(); };

  return (
    <div ref={ref} className="absolute top-full left-2 z-40 mt-1 w-[560px] rounded-lg border border-line bg-raised p-3 shadow-2xl shadow-black/50">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        Match
        <MiniSelect className="w-20" value={join} onChange={(e) => setJoin(e.target.value as "AND" | "OR")}>
          <option value="AND">all</option>
          <option value="OR">any</option>
        </MiniSelect>
        of these conditions
      </div>
      <div className="flex flex-col gap-1.5">
        {conds.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <MiniSelect className="h-7 w-40" value={c.column} onChange={(e) => set(i, { column: e.target.value })}>
              {columns.map((col) => <option key={col.name} value={col.name}>{col.name}</option>)}
            </MiniSelect>
            <MiniSelect className="h-7 w-28" value={c.op} onChange={(e) => set(i, { op: e.target.value as Operator })}>
              {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
            </MiniSelect>
            {needsValue(c.op) ? (
              <>
                <Input
                  autoFocus={i === conds.length - 1}
                  className="h-7 flex-1 font-mono text-xs!"
                  placeholder={c.op.includes("IN") ? "a, b, c" : c.op.includes("LIKE") ? "text or pattern with %" : "value"}
                  value={c.value}
                  onChange={(e) => set(i, { value: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                />
                {c.op === "BETWEEN" && (
                  <>
                    <span className="text-xs text-muted">and</span>
                    <Input className="h-7 flex-1 font-mono text-xs!" value={c.value2} onChange={(e) => set(i, { value2: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply()} />
                  </>
                )}
              </>
            ) : <div className="flex-1" />}
            <IconButton title="Remove condition" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))} disabled={conds.length === 1}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
      <button className="mt-2 flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => setConds((cs) => [...cs, blank(columns[0]?.name)])}>
        <Plus className="size-3" /> Add condition
      </button>
      <div className="selectable mt-3 min-h-8 rounded border border-line bg-app px-2 py-1.5 font-mono text-[11px] text-muted">
        {preview ? <>WHERE <span className="text-fg">{preview}</span></> : <span className="text-faint">No conditions</span>}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={apply} disabled={!preview}>Apply filter</Button>
      </div>
    </div>
  );
}
