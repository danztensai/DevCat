import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button, Field, IconButton, Input, Select, Spinner } from "../../components/ui";
import { errMsg } from "../../lib/api";
import { rmq, type Binding } from "./api";
import { usePoll, useRabbit } from "./context";
import { ArgsEditor, rowsToObject, type ArgRow } from "./Dialogs";
import { argsSummary } from "./format";

/** Bindings for a queue (where it is the destination) or an exchange (both directions). */
export function BindingsPanel({ vhost, kind, name }: { vhost: string; kind: "queue" | "exchange"; name: string }) {
  const { connId, readOnly } = useRabbit();
  const res = usePoll(async () => {
    if (kind === "queue") return { incoming: await rmq.bindings(connId, vhost, "queue", name), outgoing: [] as Binding[] };
    const [outgoing, incoming] = await Promise.all([
      rmq.bindings(connId, vhost, "source", name),
      rmq.bindings(connId, vhost, "destination", name),
    ]);
    return { incoming, outgoing };
  }, [connId, vhost, kind, name]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const remove = async (b: Binding) => {
    setDeleting(b.properties_key + b.source + b.destination);
    try {
      await rmq.deleteBinding(connId, vhost, b.source, b.destination_type === "queue" ? "q" : "e", b.destination, b.properties_key);
      toast.success("Binding removed");
      await res.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDeleting(null);
    }
  };

  const table = (list: Binding[], other: "source" | "destination") => (
    <div className="overflow-hidden rounded border border-line text-xs">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_28px] bg-raised px-2 py-1 text-[11px] text-muted">
        <div>{other === "source" ? "From exchange" : "To"}</div><div>Routing key</div><div>Arguments</div><div />
      </div>
      {list.length === 0 && <div className="px-2 py-2 text-[11px] text-faint">No bindings</div>}
      {list.map((b) => {
        const isDefault = b.source === "";
        const k = b.properties_key + b.source + b.destination;
        return (
          <div key={k + b.destination_type} className="grid grid-cols-[1.4fr_1fr_1fr_28px] items-center border-t border-line/60 px-2 py-0.5">
            <div className="truncate font-mono">
              {other === "source"
                ? (isDefault ? <span className="text-faint">(default exchange)</span> : b.source)
                : <>{b.destination_type === "exchange" && <span className="mr-1 text-info">ex</span>}{b.destination}</>}
            </div>
            <div className="truncate font-mono text-fg/80" title={b.routing_key}>{b.routing_key || <span className="text-faint">–</span>}</div>
            <div className="truncate font-mono text-muted" title={argsSummary(b.arguments)}>{argsSummary(b.arguments)}</div>
            <div>
              {!isDefault && !readOnly && (
                deleting === k ? <Spinner className="size-3" /> : (
                  <IconButton title="Unbind" onClick={() => remove(b)}><Trash2 className="size-3" /></IconButton>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      {res.error && <div className="text-xs text-danger">{res.error}</div>}
      {!res.data && !res.error && <Spinner />}
      {res.data && kind === "queue" && table(res.data.incoming, "source")}
      {res.data && kind === "exchange" && (
        <>
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Outgoing · this exchange → destination</div>
            {table(res.data.outgoing, "destination")}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Incoming · source → this exchange</div>
            {table(res.data.incoming, "source")}
          </div>
        </>
      )}
      {!readOnly && <AddBinding vhost={vhost} kind={kind} name={name} onDone={res.reload} />}
    </div>
  );
}

function AddBinding({ vhost, kind, name, onDone }: { vhost: string; kind: "queue" | "exchange"; name: string; onDone: () => void }) {
  const { connId } = useRabbit();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState("");
  const [destType, setDestType] = useState<"q" | "e">("q");
  const [rk, setRk] = useState("");
  const [rows, setRows] = useState<ArgRow[]>([]);
  const [busy, setBusy] = useState(false);
  // suggestions: exchanges when binding a queue, queues/exchanges when binding from an exchange
  const suggestionKind = kind === "queue" || destType === "e" ? "exchanges" : "queues";
  const suggestions = usePoll(
    () => rmq.list<{ name: string }>(connId, suggestionKind, vhost).then((l) => l.map((x) => x.name).filter(Boolean)),
    [connId, vhost, suggestionKind],
    { enabled: open },
  );

  const submit = async () => {
    let args: Record<string, unknown>;
    try { args = rowsToObject(rows); } catch (e) { toast.error(errMsg(e)); return; }
    setBusy(true);
    try {
      if (kind === "queue") await rmq.createBinding(connId, vhost, other.trim(), "q", name, rk, args);
      else await rmq.createBinding(connId, vhost, name, destType, other.trim(), rk, args);
      toast.success("Binding created");
      setOther(""); setRk(""); setRows([]);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-3" />Add binding</Button>;

  return (
    <div className="space-y-2 rounded-md border border-line bg-app/40 p-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {kind === "queue" ? "Bind this queue from an exchange" : "Bind from this exchange to…"}
      </div>
      <div className={kind === "exchange" ? "grid grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2" : "grid grid-cols-2 items-end gap-2"}>
        {kind === "exchange" ? (
          <Field label="Type">
            <Select value={destType} onChange={(e) => setDestType(e.target.value as "q" | "e")}>
              <option value="q">Queue</option>
              <option value="e">Exchange</option>
            </Select>
          </Field>
        ) : null}
        <Field label={kind === "queue" ? "From exchange" : destType === "q" ? "To queue" : "To exchange"}>
          <Input list={listId} value={other} onChange={(e) => setOther(e.target.value)} placeholder="name" />
        </Field>
        <Field label="Routing key"><Input value={rk} onChange={(e) => setRk(e.target.value)} placeholder="#" /></Field>
      </div>
      <datalist id={listId}>{(suggestions.data ?? []).map((n) => <option key={n} value={n} />)}</datalist>
      <Field label="Arguments">
        <ArgsEditor rows={rows} onChange={setRows} presets={[{ key: "x-match", type: "string", value: "all", hint: "Headers exchange: all | any" }]} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={!other.trim()} onClick={submit}>Bind</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
