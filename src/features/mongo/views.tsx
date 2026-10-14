// Result renderers for a page of MongoDB documents.
import Editor from "@monaco-editor/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { Copy, CopyPlus, Pencil, Trash2 } from "lucide-react";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { IconButton } from "../../components/ui";
import { compact, flatten, shellValue, toJsonText, typeOf } from "./ejson";
import { JsonTree, Scalar } from "./JsonTree";

export type Doc = Record<string, unknown>;

export interface DocActions {
  onEdit?: (d: Doc) => void;
  onDuplicate?: (d: Doc) => void;
  onDelete?: (d: Doc) => void;
}

const idText = (d: Doc) => ("_id" in d ? compact(d._id, 80) : "(no _id)");

export function DocumentsView({ docs, offset, expand, actions }: { docs: Doc[]; offset: number; expand: number; actions: DocActions }) {
  return (
    <div className="h-full overflow-auto p-2">
      <div className="flex flex-col gap-1.5">
        {docs.map((d, i) => (
          <div
            key={i}
            className="group rounded-md border border-line bg-panel [content-visibility:auto] [contain-intrinsic-size:auto_120px]"
            onDoubleClick={() => actions.onEdit?.(d)}
          >
            <div className="flex h-7 items-center gap-2 border-b border-line/60 px-2">
              <span className="font-mono text-[10.5px] text-faint">{offset + i + 1}</span>
              <span className="truncate font-mono text-[11.5px] text-[#c084fc]">{idText(d)}</span>
              <span className="text-[10.5px] text-faint">{Object.keys(d).length} fields</span>
              <div className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton title="Copy JSON" onClick={() => navigator.clipboard.writeText(toJsonText(d)).then(() => toast.success("Document copied"))}><Copy className="size-3.5" /></IconButton>
                {actions.onEdit && <IconButton title="Edit (double-click)" onClick={() => actions.onEdit!(d)}><Pencil className="size-3.5" /></IconButton>}
                {actions.onDuplicate && <IconButton title="Duplicate" onClick={() => actions.onDuplicate!(d)}><CopyPlus className="size-3.5" /></IconButton>}
                {actions.onDelete && <IconButton title="Delete" onClick={() => actions.onDelete!(d)} className="hover:text-danger"><Trash2 className="size-3.5" /></IconButton>}
              </div>
            </div>
            <div className="px-2 py-1">
              <JsonTree doc={d} defaultOpen={expand} key={expand} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableView({ docs, offset, actions }: { docs: Doc[]; offset: number; actions: DocActions }) {
  const { columns, rows, types } = useMemo(() => {
    const flat = docs.map((d) => flatten(d));
    const cols: string[] = [];
    const seen = new Set<string>();
    const types = new Map<string, Set<string>>();
    for (const f of flat) for (const [k, v] of Object.entries(f)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
      if (v !== null) (types.get(k) ?? types.set(k, new Set()).get(k)!).add(typeOf(v));
    }
    const idIdx = cols.indexOf("_id");
    if (idIdx > 0) { cols.splice(idIdx, 1); cols.unshift("_id"); }
    return { columns: cols.slice(0, 300), rows: flat, types };
  }, [docs]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 24, overscan: 15 });
  const W = 180;
  const width = 48 + columns.length * W;

  return (
    <div ref={parentRef} className="selectable h-full overflow-auto font-mono text-[12px]">
      <div style={{ width, minWidth: "100%" }}>
        <div className="sticky top-0 z-10 flex h-7 border-b border-line bg-panel font-sans text-[11.5px]">
          <div className="sticky left-0 w-12 shrink-0 border-r border-line bg-panel" />
          {columns.map((c) => (
            <div key={c} className="flex shrink-0 flex-col justify-center truncate border-r border-line px-2" style={{ width: W }} title={`${c}: ${[...(types.get(c) ?? [])].join(" | ")}`}>
              <span className="truncate font-medium text-fg/90">{c}</span>
            </div>
          ))}
        </div>
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            return (
              <div
                key={vi.index}
                onDoubleClick={() => actions.onEdit?.(docs[vi.index])}
                className="absolute left-0 flex border-b border-line/40 hover:bg-hover/60"
                style={{ top: 0, height: vi.size, transform: `translateY(${vi.start}px)`, width }}
              >
                <div className="sticky left-0 flex w-12 shrink-0 items-center justify-end border-r border-line/60 bg-app pr-2 text-[10.5px] text-faint">{offset + vi.index + 1}</div>
                {columns.map((c) => {
                  const v = r[c];
                  const missing = !(c in r);
                  return (
                    <div key={c} className="flex shrink-0 items-center truncate border-r border-line/30 px-2" style={{ width: W }} title={missing ? "(missing)" : compact(v, 2000)}>
                      {missing ? <span className="text-faint/50">—</span> : <Cell v={v} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Cell({ v }: { v: unknown }) {
  if (v === null || typeof v !== "object" || shellValue(v)) return <span className="truncate"><Scalar v={v} /></span>;
  return <span className={clsx("truncate", Array.isArray(v) ? "text-warn/90" : "text-muted")}>{compact(v, 300)}</span>;
}

export function JsonView({ docs }: { docs: Doc[] }) {
  const text = useMemo(() => toJsonText(docs), [docs]);
  return (
    <Editor
      language="json"
      theme="devcat"
      value={text}
      options={{ readOnly: true, minimap: { enabled: true }, fontSize: 12, scrollBeyondLastLine: false, automaticLayout: true, folding: true }}
    />
  );
}
