import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Checkbox, Dialog, Field, IconButton, Input, Select } from "../../components/ui";
import { errMsg } from "../../lib/api";
import { rmq } from "./api";
import { useRabbit, writeVhost } from "./context";

// ---------------------------------------------------------------------------
// Typed key/value editor (queue/exchange arguments, message headers)

export type ArgType = "string" | "number" | "boolean" | "json";
export interface ArgRow { id: number; key: string; value: string; type: ArgType }

interface Preset { key: string; type: ArgType; value?: string; hint: string; for?: "classic" | "quorum" | "stream" }

export const QUEUE_PRESETS: Preset[] = [
  { key: "x-message-ttl", type: "number", value: "60000", hint: "Per-message TTL (ms)" },
  { key: "x-expires", type: "number", value: "1800000", hint: "Delete queue after idle (ms)" },
  { key: "x-max-length", type: "number", value: "10000", hint: "Max ready messages" },
  { key: "x-max-length-bytes", type: "number", value: "104857600", hint: "Max total body size" },
  { key: "x-overflow", type: "string", value: "reject-publish", hint: "drop-head | reject-publish | reject-publish-dlx" },
  { key: "x-dead-letter-exchange", type: "string", value: "", hint: "DLX name" },
  { key: "x-dead-letter-routing-key", type: "string", value: "", hint: "Routing key for dead letters" },
  { key: "x-single-active-consumer", type: "boolean", value: "true", hint: "Only one consumer at a time" },
  { key: "x-max-priority", type: "number", value: "10", hint: "Priority queue (classic)", for: "classic" },
  { key: "x-delivery-limit", type: "number", value: "20", hint: "Poison message limit (quorum)", for: "quorum" },
  { key: "x-quorum-initial-group-size", type: "number", value: "3", hint: "Replicas (quorum)", for: "quorum" },
  { key: "x-max-age", type: "string", value: "7D", hint: "Retention, e.g. 7D, 12h (stream)", for: "stream" },
  { key: "x-stream-max-segment-size-bytes", type: "number", value: "500000000", hint: "Segment size (stream)", for: "stream" },
  { key: "x-queue-leader-locator", type: "string", value: "balanced", hint: "client-local | balanced" },
];

export const EXCHANGE_PRESETS: Preset[] = [
  { key: "alternate-exchange", type: "string", value: "", hint: "Exchange for unroutable messages" },
];

let rowId = 0;
export const newRow = (key = "", value = "", type: ArgType = "string"): ArgRow => ({ id: ++rowId, key, value, type });

export function rowsFromObject(o: Record<string, unknown> | undefined): ArgRow[] {
  return Object.entries(o ?? {}).map(([k, v]) =>
    typeof v === "number" ? newRow(k, String(v), "number")
      : typeof v === "boolean" ? newRow(k, String(v), "boolean")
        : typeof v === "string" ? newRow(k, v, "string")
          : newRow(k, JSON.stringify(v), "json"));
}

/** Converts rows to an object; throws a user-facing message on invalid values. */
export function rowsToObject(rows: ArgRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    switch (r.type) {
      case "number": {
        const n = Number(r.value);
        if (r.value.trim() === "" || Number.isNaN(n)) throw new Error(`${k}: "${r.value}" is not a number`);
        out[k] = n;
        break;
      }
      case "boolean": out[k] = r.value === "true"; break;
      case "json":
        try { out[k] = JSON.parse(r.value); } catch { throw new Error(`${k}: invalid JSON`); }
        break;
      default: out[k] = r.value;
    }
  }
  return out;
}

export function ArgsEditor({ rows, onChange, presets, queueType, keyPlaceholder = "key" }: {
  rows: ArgRow[]; onChange: (rows: ArgRow[]) => void; presets?: Preset[]; queueType?: string; keyPlaceholder?: string;
}) {
  const set = (id: number, patch: Partial<ArgRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const available = (presets ?? []).filter((p) => !rows.some((r) => r.key === p.key) && (!p.for || !queueType || p.for === queueType));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_104px_24px] items-center gap-1.5">
          <Input className="font-mono text-xs" placeholder={keyPlaceholder} value={r.key} onChange={(e) => set(r.id, { key: e.target.value })} />
          {r.type === "boolean" ? (
            <Select value={r.value} onChange={(e) => set(r.id, { value: e.target.value })}>
              <option value="true">true</option>
              <option value="false">false</option>
            </Select>
          ) : (
            <Input className="font-mono text-xs" placeholder="value" value={r.value} onChange={(e) => set(r.id, { value: e.target.value })} />
          )}
          <Select
            value={r.type}
            onChange={(e) => set(r.id, { type: e.target.value as ArgType, value: e.target.value === "boolean" ? "true" : r.value })}
          >
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="json">JSON</option>
          </Select>
          <IconButton title="Remove" onClick={() => onChange(rows.filter((x) => x.id !== r.id))}><X className="size-3.5" /></IconButton>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => onChange([...rows, newRow()])}><Plus className="size-3" />Add</Button>
        {available.map((p) => (
          <button
            key={p.key}
            title={p.hint}
            className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-muted hover:border-accent/50 hover:text-fg"
            onClick={() => onChange([...rows.filter((r) => r.key.trim() || r.value.trim()), newRow(p.key, p.value ?? "", p.type)])}
          >
            {p.key}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function VhostSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { vhosts } = useRabbit();
  const list = vhosts.includes(value) ? vhosts : [value, ...vhosts];
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((v) => <option key={v} value={v}>{v}</option>)}
    </Select>
  );
}

export function DeclareQueueDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (vhost: string, name: string) => void }) {
  const ctx = useRabbit();
  const [vhost, setVhost] = useState("/");
  const [name, setName] = useState("");
  const [type, setType] = useState<"classic" | "quorum" | "stream">("classic");
  const [durable, setDurable] = useState(true);
  const [autoDelete, setAutoDelete] = useState(false);
  const [rows, setRows] = useState<ArgRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVhost(writeVhost(ctx)); setName(""); setType("classic"); setDurable(true); setAutoDelete(false); setRows([]); setError(null);
  }, [open]);

  // quorum & stream queues must be durable and cannot auto-delete
  const replicated = type !== "classic";

  const submit = async () => {
    setError(null);
    let args: Record<string, unknown>;
    try { args = rowsToObject(rows); } catch (e) { setError(errMsg(e)); return; }
    args["x-queue-type"] = type;
    setBusy(true);
    try {
      await rmq.declareQueue(ctx.connId, vhost, name.trim(), replicated || durable, !replicated && autoDelete, args);
      toast.success(`Queue ${name.trim()} declared`);
      onDone(vhost, name.trim());
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Declare queue"
      width={620}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>Declare</Button>
      </>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field label="Virtual host"><VhostSelect value={vhost} onChange={setVhost} /></Field>
          <Field label="Name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="orders.created" onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_2fr] items-end gap-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="classic">Classic</option>
              <option value="quorum">Quorum</option>
              <option value="stream">Stream</option>
            </Select>
          </Field>
          <div className="flex h-7 items-center gap-4">
            <Checkbox label="Durable" checked={replicated || durable} onChange={(v) => !replicated && setDurable(v)} />
            <Checkbox label="Auto-delete" checked={!replicated && autoDelete} onChange={(v) => !replicated && setAutoDelete(v)} />
            {replicated && <span className="text-[11px] text-faint">{type} queues are always durable</span>}
          </div>
        </div>
        <Field label="Arguments" hint="Click a preset to add it. Numbers are sent as integers, not strings.">
          <ArgsEditor rows={rows} onChange={setRows} presets={QUEUE_PRESETS} queueType={type} />
        </Field>
        {error && <div className="selectable rounded border border-danger/30 bg-danger/10 px-2 py-1.5 font-mono text-xs text-danger">{error}</div>}
      </div>
    </Dialog>
  );
}

export function DeclareExchangeDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (vhost: string, name: string) => void }) {
  const ctx = useRabbit();
  const [vhost, setVhost] = useState("/");
  const [name, setName] = useState("");
  const [type, setType] = useState("direct");
  const [durable, setDurable] = useState(true);
  const [autoDelete, setAutoDelete] = useState(false);
  const [internal, setInternal] = useState(false);
  const [rows, setRows] = useState<ArgRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVhost(writeVhost(ctx)); setName(""); setType("direct"); setDurable(true); setAutoDelete(false); setInternal(false); setRows([]); setError(null);
  }, [open]);

  const submit = async () => {
    setError(null);
    let args: Record<string, unknown>;
    try { args = rowsToObject(rows); } catch (e) { setError(errMsg(e)); return; }
    setBusy(true);
    try {
      await rmq.declareExchange(ctx.connId, vhost, name.trim(), type, durable, autoDelete, internal, args);
      toast.success(`Exchange ${name.trim()} declared`);
      onDone(vhost, name.trim());
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Declare exchange"
      width={600}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>Declare</Button>
      </>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field label="Virtual host"><VhostSelect value={vhost} onChange={setVhost} /></Field>
          <Field label="Name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="orders" onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_2fr] items-end gap-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {["direct", "fanout", "topic", "headers", "x-local-random", "x-consistent-hash", "x-delayed-message"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <div className="flex h-7 items-center gap-4">
            <Checkbox label="Durable" checked={durable} onChange={setDurable} />
            <Checkbox label="Auto-delete" checked={autoDelete} onChange={setAutoDelete} />
            <Checkbox label="Internal" checked={internal} onChange={setInternal} />
          </div>
        </div>
        {type.startsWith("x-") && type !== "x-local-random" && (
          <div className="text-[11px] text-warn">{type} requires the corresponding broker plugin to be enabled.</div>
        )}
        <Field label="Arguments">
          <ArgsEditor rows={rows} onChange={setRows} presets={type === "x-delayed-message" ? [...EXCHANGE_PRESETS, { key: "x-delayed-type", type: "string", value: "direct", hint: "Underlying exchange type" }] : EXCHANGE_PRESETS} />
        </Field>
        {error && <div className="selectable rounded border border-danger/30 bg-danger/10 px-2 py-1.5 font-mono text-xs text-danger">{error}</div>}
      </div>
    </Dialog>
  );
}
