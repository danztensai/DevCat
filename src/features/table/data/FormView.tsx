// Vertical record view of the active grid row; editable when the grid is.
import clsx from "clsx";
import { ChevronDown, ChevronUp, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../../../components/ui";
import type { CellValue } from "../../../lib/types";
import { editText, isJsonType, parseInput } from "../../grid/format";
import type { GridController } from "../../grid/useGridController";

export default function FormView({ ctl }: { ctl: GridController }) {
  const r = ctl.sel?.focus.r ?? (ctl.rowCount ? 0 : null);
  const d = r === null ? null : ctl.order[r];
  const go = (delta: number) => {
    if (r === null) return;
    const n = Math.max(0, Math.min(ctl.rowCount - 1, r + delta));
    ctl.setSel({ anchor: { r: n, c: ctl.sel?.focus.c ?? 0 }, focus: { r: n, c: ctl.sel?.focus.c ?? 0 } });
  };

  if (d === null || d === undefined) {
    return <div className="flex h-full items-center justify-center text-xs text-faint">No row selected</div>;
  }
  const readOnly = !ctl.canEdit || ctl.isDeleted(d);

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-xs text-muted">
        <span className="flex-1">
          {ctl.isInserted(d) ? "New row" : `Row ${r! + 1} of ${ctl.rowCount.toLocaleString()}`}
          {ctl.isDeleted(d) && <span className="ml-2 text-danger">deleted</span>}
        </span>
        <IconButton title="Previous row" onClick={() => go(-1)} disabled={r === 0}><ChevronUp className="size-4" /></IconButton>
        <IconButton title="Next row" onClick={() => go(1)} disabled={r === ctl.rowCount - 1}><ChevronDown className="size-4" /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {ctl.columns.map((col, c) => (
          <FieldRow
            key={`${d}:${c}`}
            name={col.name}
            typeName={col.typeName}
            pk={ctl.pkIdx.includes(c)}
            value={ctl.value(d, c)}
            modified={ctl.isModified(d, c)}
            readOnly={readOnly}
            onChange={(v) => ctl.setCell(d, c, v)}
          />
        ))}
      </div>
    </div>
  );
}

function FieldRow({ name, typeName, pk, value, modified, readOnly, onChange }: {
  name: string; typeName: string; pk: boolean; value: CellValue | undefined; modified: boolean; readOnly: boolean;
  onChange: (v: CellValue) => void;
}) {
  const initial = value === undefined || value === null ? "" : editText(value);
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  const multiline = (value !== null && typeof value === "object") || isJsonType(typeName) || initial.length > 60 || initial.includes("\n");
  const commit = () => { if (text !== initial) onChange(parseInput(text, value ?? null, typeName)); };
  const cls = clsx(
    "w-full rounded border bg-app px-2 py-1 font-mono text-xs text-fg focus:border-accent focus:outline-none",
    modified ? "border-warn/60 bg-warn/10" : "border-line",
    readOnly && "opacity-80",
  );
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex items-center gap-1 text-[11px]">
        {pk && <KeyRound className="size-3 text-accent" />}
        <span className="font-medium text-fg/90">{name}</span>
        <span className="text-faint">{typeName}</span>
        <span className="flex-1" />
        {!readOnly && value !== null && (
          <button className="text-[10px] text-faint hover:text-fg" onClick={() => onChange(null)}>set NULL</button>
        )}
      </div>
      {multiline ? (
        <textarea
          spellCheck={false}
          readOnly={readOnly}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          className={cls}
          value={text}
          placeholder={value === null ? "NULL" : value === undefined ? "DEFAULT" : ""}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          spellCheck={false}
          readOnly={readOnly}
          className={clsx(cls, "h-6 py-0")}
          value={text}
          placeholder={value === null ? "NULL" : value === undefined ? "DEFAULT" : ""}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      )}
    </div>
  );
}
