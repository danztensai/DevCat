import { Handle, Position, useStore, type Node, type NodeProps, type ReactFlowState } from "@xyflow/react";
import clsx from "clsx";
import { KeyRound, Link2, Table2 } from "lucide-react";
import { memo } from "react";
import type { TableStructure } from "../../lib/types";

export const HEADER_H = 30;
export const ROW_H = 20;

export type TableNodeData = {
  table: TableStructure;
  label: string;
  width: number;
  fkCols: Set<string>;
  /** Visual state */
  state: "normal" | "focus" | "related" | "dim" | "match";
};

export type TableNodeType = Node<TableNodeData, "table">;

/** Column rows are only rendered when zoomed in enough (big diagrams stay fast). */
const detailSelector = (s: ReactFlowState) => s.transform[2] >= 0.45;

export const handleId = (col: string, side: "s" | "t") => `${col}::${side}`;

function TableNodeImpl({ data, selected }: NodeProps<TableNodeType>) {
  const detail = useStore(detailSelector);
  const { table, state } = data;
  const cols = table.columns;
  return (
    <div
      className={clsx(
        "rounded-md border bg-raised text-[12px] shadow-lg transition-opacity",
        state === "dim" ? "opacity-25" : "opacity-100",
        state === "focus" || selected ? "border-accent ring-1 ring-accent/50" :
          state === "match" ? "border-info ring-1 ring-info/50" :
            state === "related" ? "border-accent/60" : "border-line",
      )}
      style={{ width: data.width }}
    >
      <div
        className={clsx(
          "flex items-center gap-1.5 rounded-t-md border-b border-line px-2",
          state === "focus" || selected ? "bg-accent/15" : "bg-hover",
        )}
        style={{ height: HEADER_H }}
      >
        <Table2 className="size-3.5 shrink-0 text-accent" />
        <span className="truncate font-semibold text-fg" title={data.label}>{data.label}</span>
        <span className="ml-auto shrink-0 text-[10px] text-faint">{cols.length}</span>
      </div>
      {detail ? (
        <div className="py-0.5">
          {cols.map((c) => {
            const fk = data.fkCols.has(c.name);
            return (
              <div key={c.name} className="relative flex items-center gap-1.5 px-2" style={{ height: ROW_H }}>
                <Handle type="target" position={Position.Left} id={handleId(c.name, "t")} className="!size-1.5 !min-h-0 !min-w-0 !border-none !bg-faint" />
                <span className="flex w-3.5 shrink-0 justify-center">
                  {c.isPrimaryKey ? <KeyRound className="size-3 text-warn" /> : fk ? <Link2 className="size-3 text-info" /> : null}
                </span>
                <span className={clsx("truncate", c.isPrimaryKey ? "font-medium text-fg" : "text-fg/90")} title={c.comment ?? c.name}>{c.name}</span>
                <span className="ml-auto truncate pl-2 font-mono text-[10.5px] text-muted" title={c.dataType}>
                  {c.dataType}
                </span>
                <span className={clsx("w-2.5 shrink-0 text-center font-mono text-[10px]", c.nullable ? "text-faint" : "text-transparent")} title={c.nullable ? "nullable" : "not null"}>
                  ?
                </span>
                <Handle type="source" position={Position.Right} id={handleId(c.name, "s")} className="!size-1.5 !min-h-0 !min-w-0 !border-none !bg-faint" />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="relative px-2 py-1 text-[10.5px] text-faint">
          {cols.length} columns
          {/* keep handle ids stable so edges stay attached while zoomed out */}
          {cols.map((c) => (
            <span key={c.name}>
              <Handle type="target" position={Position.Left} id={handleId(c.name, "t")} className="!pointer-events-none !opacity-0" style={{ top: 0 }} />
              <Handle type="source" position={Position.Right} id={handleId(c.name, "s")} className="!pointer-events-none !opacity-0" style={{ top: 0 }} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export const TableNode = memo(TableNodeImpl);

export function estimateSize(t: TableStructure, label: string) {
  const longest = Math.max(
    label.length * 7.4 + 50,
    ...t.columns.map((c) => c.name.length * 6.8 + Math.min(c.dataType.length, 24) * 6.4 + 60),
  );
  const width = Math.round(Math.min(380, Math.max(180, longest)));
  const height = HEADER_H + t.columns.length * ROW_H + 6;
  return { width, height };
}
