import Editor from "@monaco-editor/react";
import clsx from "clsx";
import { AlertTriangle, ChevronDown, ChevronRight, Download, Send } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Badge, Button, Checkbox, Field, Input, Select } from "../../components/ui";
import { errMsg } from "../../lib/api";
import { rmq, type AckMode, type GotMessage } from "./api";
import { useRabbit } from "./context";
import { ArgsEditor, rowsToObject, type ArgRow } from "./Dialogs";
import { fmtBytes, jsonPretty } from "./format";

const editorOptions = {
  minimap: { enabled: false },
  fontSize: 12,
  lineNumbers: "off" as const,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  wordWrap: "on" as const,
  folding: true,
  renderLineHighlight: "none" as const,
  overviewRulerLanes: 0,
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
};

// ---------------------------------------------------------------------------
// Publish

export function PublishForm({ vhost, exchange, fixedRoutingKey }: {
  vhost: string;
  /** "" = default exchange */
  exchange: string;
  /** Publishing to a queue through the default exchange: the routing key is the queue name. */
  fixedRoutingKey?: string;
}) {
  const { connId, readOnly } = useRabbit();
  const [routingKey, setRoutingKey] = useState("");
  const [payload, setPayload] = useState('{\n  "hello": "world"\n}');
  const [base64, setBase64] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState("2");
  const [headers, setHeaders] = useState<ArgRow[]>([]);
  const [props, setProps] = useState({ content_type: "application/json", correlation_id: "", reply_to: "", expiration: "", message_id: "", priority: "", type: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ routed: boolean; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProps, setShowProps] = useState(false);

  const isJson = !base64 && /json/i.test(props.content_type);
  const setProp = (k: keyof typeof props) => (e: ChangeEvent<HTMLInputElement>) => setProps({ ...props, [k]: e.target.value });

  const publish = async () => {
    setError(null);
    let hdrs: Record<string, unknown>;
    try { hdrs = rowsToObject(headers); } catch (e) { setError(errMsg(e)); return; }
    if (props.expiration && !/^\d+$/.test(props.expiration)) { setError("expiration must be a number of milliseconds"); return; }
    if (props.priority && !/^\d+$/.test(props.priority)) { setError("priority must be an integer"); return; }
    const properties: Record<string, unknown> = {
      delivery_mode: Number(deliveryMode),
      content_type: props.content_type, correlation_id: props.correlation_id, reply_to: props.reply_to,
      expiration: props.expiration, message_id: props.message_id, type: props.type,
      priority: props.priority ? Number(props.priority) : null,
      headers: Object.keys(hdrs).length ? hdrs : null,
    };
    setBusy(true);
    try {
      const rk = fixedRoutingKey ?? routingKey;
      const routed = await rmq.publish(connId, vhost, exchange, rk, payload, base64 ? "base64" : "string", properties);
      setResult({ routed, at: Date.now() });
      if (routed) toast.success("Message published");
      else toast.warning("Message published but not routed to any queue");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        <Field label="Routing key">
          {fixedRoutingKey != null
            ? <Input value={fixedRoutingKey} disabled title="Published via the default exchange; the routing key is the queue name" />
            : <Input value={routingKey} onChange={(e) => setRoutingKey(e.target.value)} placeholder="orders.created" />}
        </Field>
        <Field label="Delivery mode">
          <Select value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value)}>
            <option value="2">2 – Persistent</option>
            <option value="1">1 – Non-persistent</option>
          </Select>
        </Field>
      </div>

      <Field label="Headers">
        <ArgsEditor rows={headers} onChange={setHeaders} keyPlaceholder="header" />
      </Field>

      <div>
        <button className="flex items-center gap-1 text-xs text-muted hover:text-fg" onClick={() => setShowProps(!showProps)}>
          {showProps ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} Properties
          <span className="text-faint">· {props.content_type || "no content_type"}</span>
        </button>
        {showProps && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="content_type"><Input value={props.content_type} onChange={setProp("content_type")} placeholder="application/json" /></Field>
            <Field label="correlation_id"><Input value={props.correlation_id} onChange={setProp("correlation_id")} /></Field>
            <Field label="reply_to"><Input value={props.reply_to} onChange={setProp("reply_to")} /></Field>
            <Field label="message_id"><Input value={props.message_id} onChange={setProp("message_id")} /></Field>
            <Field label="expiration (ms)"><Input value={props.expiration} onChange={setProp("expiration")} placeholder="60000" /></Field>
            <Field label="priority"><Input value={props.priority} onChange={setProp("priority")} placeholder="0-255" /></Field>
            <Field label="type"><Input value={props.type} onChange={setProp("type")} /></Field>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-3">
          <span className="text-xs text-muted">Payload</span>
          <div className="flex-1" />
          {isJson && (
            <Button size="sm" variant="ghost" onClick={() => { const p = jsonPretty(payload); if (p) setPayload(p); else toast.error("Payload is not valid JSON"); }}>
              Format JSON
            </Button>
          )}
          <Checkbox label="Base64" checked={base64} onChange={setBase64} />
        </div>
        <div className="h-48 overflow-hidden rounded-md border border-line">
          <Editor
            theme="devcat"
            language={isJson ? "json" : "plaintext"}
            value={payload}
            onChange={(v) => setPayload(v ?? "")}
            options={editorOptions}
          />
        </div>
        {base64 && <div className="mt-1 text-[11px] text-faint">Payload is sent as base64 and decoded by the broker into raw bytes.</div>}
      </div>

      {error && <div className="selectable rounded border border-danger/30 bg-danger/10 px-2 py-1.5 font-mono text-xs text-danger">{error}</div>}

      <div className="flex items-center gap-2">
        <Button variant="primary" loading={busy} disabled={readOnly} onClick={publish} title={readOnly ? "Connection is read-only" : undefined}>
          <Send className="size-3.5" />Publish
        </Button>
        {result && (
          result.routed
            ? <Badge tone="ok">Routed · {new Date(result.at).toLocaleTimeString()}</Badge>
            : <Badge tone="warn">Not routed · no binding matched · {new Date(result.at).toLocaleTimeString()}</Badge>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Get messages

const ACK_MODES: { value: AckMode; label: string; destructive: boolean }[] = [
  { value: "ack_requeue_true", label: "Nack, requeue (peek)", destructive: false },
  { value: "reject_requeue_true", label: "Reject, requeue", destructive: false },
  { value: "ack_requeue_false", label: "Ack – remove from queue", destructive: true },
  { value: "reject_requeue_false", label: "Reject, no requeue – remove / dead-letter", destructive: true },
];

export function GetMessages({ vhost, queue }: { vhost: string; queue: string }) {
  const { connId, readOnly } = useRabbit();
  const [count, setCount] = useState("5");
  const [ackmode, setAckmode] = useState<AckMode>("ack_requeue_true");
  const [encoding, setEncoding] = useState<"auto" | "base64">("auto");
  const [truncate, setTruncate] = useState("50000");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<GotMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mode = ACK_MODES.find((m) => m.value === ackmode)!;

  const get = async () => {
    setError(null);
    setBusy(true);
    try {
      const n = Math.max(1, Math.min(1000, Number(count) || 1));
      const res = await rmq.getMessages(connId, vhost, queue, n, ackmode, encoding, Number(truncate) || null);
      setMsgs(res);
      if (res.length === 0) toast.info("Queue is empty");
      else if (mode.destructive) toast.success(`Fetched and removed ${res.length} message(s)`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[70px_1fr_100px_100px] gap-2">
        <Field label="Count"><Input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Ack mode">
          <Select value={ackmode} onChange={(e) => setAckmode(e.target.value as AckMode)}>
            {ACK_MODES.filter((m) => !readOnly || !m.destructive).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Encoding">
          <Select value={encoding} onChange={(e) => setEncoding(e.target.value as "auto" | "base64")}>
            <option value="auto">Auto</option>
            <option value="base64">Base64</option>
          </Select>
        </Field>
        <Field label="Truncate (bytes)"><Input value={truncate} onChange={(e) => setTruncate(e.target.value)} inputMode="numeric" /></Field>
      </div>
      {mode.destructive ? (
        <div className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span><b>Destructive:</b> fetched messages are permanently removed from <span className="font-mono">{queue}</span>{ackmode === "reject_requeue_false" ? " (or dead-lettered if a DLX is configured)" : ""}.</span>
        </div>
      ) : (
        <div className="text-[11px] text-faint">Messages are requeued after reading and will be marked as redelivered. Ordering may change.</div>
      )}
      <Button variant={mode.destructive ? "danger" : "default"} loading={busy} onClick={get}>
        <Download className="size-3.5" />Get message(s)
      </Button>
      {error && <div className="selectable rounded border border-danger/30 bg-danger/10 px-2 py-1.5 font-mono text-xs text-danger">{error}</div>}
      {msgs && msgs.length === 0 && <div className="text-xs text-muted">Queue is empty.</div>}
      {msgs?.map((m, i) => <MessageView key={i} m={m} index={i + 1} />)}
    </div>
  );
}

function MessageView({ m, index }: { m: GotMessage; index: number }) {
  const [open, setOpen] = useState(index <= 3);
  const pretty = m.payload_encoding === "string" ? jsonPretty(m.payload) : null;
  const [prettyOn, setPrettyOn] = useState(true);
  const text = pretty && prettyOn ? pretty : m.payload;
  const lines = text.split("\n").length;
  const { headers, ...props } = m.properties ?? {};
  const propRows = Object.entries(props).filter(([, v]) => v !== undefined && v !== "");
  const headerRows = Object.entries(headers ?? {});
  const shownBytes = m.payload_encoding === "string" ? new TextEncoder().encode(m.payload).length : Math.floor((m.payload.length * 3) / 4);

  return (
    <div className="rounded-md border border-line bg-app/40">
      <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-hover/40" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
        <span className="font-semibold">#{index}</span>
        <span className="truncate font-mono text-muted">{m.exchange || "(default)"} → {m.routing_key}</span>
        <div className="flex-1" />
        {m.redelivered && <Badge tone="warn">redelivered</Badge>}
        {m.payload_encoding === "base64" && <Badge tone="info">base64</Badge>}
        {shownBytes < m.payload_bytes && <Badge tone="warn">truncated</Badge>}
        <span className="text-faint">{fmtBytes(m.payload_bytes)} · {m.message_count} left</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line p-2">
          {(propRows.length > 0 || headerRows.length > 0) && (
            <div className="grid gap-2 md:grid-cols-2">
              <PropTable title="Properties" rows={propRows} />
              <PropTable title="Headers" rows={headerRows} />
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
              Payload
              {pretty && <Checkbox label="Pretty JSON" checked={prettyOn} onChange={setPrettyOn} />}
              <div className="flex-1" />
              <button className="hover:text-fg" onClick={() => { void navigator.clipboard.writeText(m.payload); toast.success("Payload copied"); }}>Copy</button>
            </div>
            <div className="overflow-hidden rounded border border-line" style={{ height: Math.min(360, Math.max(60, lines * 18 + 12)) }}>
              <Editor theme="devcat" language={pretty ? "json" : "plaintext"} value={text} options={{ ...editorOptions, readOnly: true, domReadOnly: true }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PropTable({ title, rows }: { title: string; rows: [string, unknown][] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] text-muted">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-faint">none</div>
      ) : (
        <div className="selectable overflow-hidden rounded border border-line text-[11px]">
          {rows.map(([k, v], i) => (
            <div key={k} className={clsx("grid grid-cols-[minmax(90px,40%)_1fr]", i > 0 && "border-t border-line/60")}>
              <div className="truncate bg-raised/60 px-1.5 py-0.5 font-mono text-muted" title={k}>{k}</div>
              <div className="break-all px-1.5 py-0.5 font-mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
