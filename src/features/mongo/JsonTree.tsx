// Collapsible JSON tree for MongoDB documents (Extended JSON aware).
import clsx from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import { isPlainObject, shellValue } from "./ejson";

const KIND_CLS: Record<string, string> = {
  oid: "text-[#c084fc]",
  date: "text-[#2dd4bf]",
  number: "text-info",
  binary: "text-muted",
  regex: "text-[#f472b6]",
  other: "text-muted",
};

export function Scalar({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-faint italic">null</span>;
  if (typeof v === "string") return <span className="break-all text-ok">"{v}"</span>;
  if (typeof v === "number") return <span className="text-info">{String(v)}</span>;
  if (typeof v === "boolean") return <span className="text-accent">{String(v)}</span>;
  const sv = shellValue(v);
  if (sv) return <span className={KIND_CLS[sv.kind]}>{sv.text}</span>;
  return <span>{JSON.stringify(v)}</span>;
}

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] =>
  (Array.isArray(v) || isPlainObject(v)) && !shellValue(v);

function summary(v: Record<string, unknown> | unknown[]) {
  if (Array.isArray(v)) return `Array(${v.length})`;
  const n = Object.keys(v).length;
  return `{ ${n} field${n === 1 ? "" : "s"} }`;
}

function NodeImpl({ name, value, depth, defaultOpen, isIndex }: { name?: string; value: unknown; depth: number; defaultOpen: number; isIndex?: boolean }) {
  const container = isContainer(value);
  const [open, setOpen] = useState(container && depth < defaultOpen);
  const pad = { paddingLeft: depth * 14 };
  const label = name !== undefined && (
    <>
      <span className={clsx(isIndex ? "text-faint" : "text-fg/90")}>{name}</span>
      <span className="text-faint">: </span>
    </>
  );
  if (!container) {
    return (
      <div className="flex min-w-0 items-start leading-5" style={pad}>
        <span className="w-3.5 shrink-0" />
        <span className="min-w-0">{label}<Scalar v={value} /></span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  return (
    <div>
      <div className="flex cursor-pointer items-center leading-5 hover:bg-hover/50" style={pad} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {open ? <ChevronDown className="size-3.5 shrink-0 text-faint" /> : <ChevronRight className="size-3.5 shrink-0 text-faint" />}
        {label}
        <span className="text-faint">{open ? (Array.isArray(value) ? "[" : "{") : summary(value)}</span>
      </div>
      {open && (
        <>
          {entries.slice(0, 500).map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} defaultOpen={defaultOpen} isIndex={Array.isArray(value)} />)}
          {entries.length > 500 && <div className="text-faint italic" style={{ paddingLeft: (depth + 1) * 14 + 14 }}>… {entries.length - 500} more</div>}
          <div className="leading-5 text-faint" style={{ paddingLeft: depth * 14 + 14 }}>{Array.isArray(value) ? "]" : "}"}</div>
        </>
      )}
    </div>
  );
}

export const JsonNode = memo(NodeImpl);

/** Top-level fields of a document, nested containers collapsed beyond `defaultOpen` levels. */
export function JsonTree({ doc, defaultOpen = 1 }: { doc: Record<string, unknown>; defaultOpen?: number }) {
  return (
    <div className="selectable font-mono text-[12px]">
      {Object.entries(doc).map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={0} defaultOpen={defaultOpen} />)}
    </div>
  );
}
