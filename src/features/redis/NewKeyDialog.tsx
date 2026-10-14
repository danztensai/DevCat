import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, IconButton, Input, Select, Textarea } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import { cmd, typeMeta } from "./util";

type NewType = "string" | "list" | "set" | "zset" | "hash" | "stream";
const TYPES: NewType[] = ["string", "hash", "list", "set", "zset", "stream"];

export function NewKeyDialog({ connId, db, prefix, onClose, onCreated }: { connId: string; db: string; prefix?: string; onClose: () => void; onCreated: (key: string) => void }) {
  const [type, setType] = useState<NewType>("string");
  const [name, setName] = useState(prefix ?? "");
  const [ttl, setTtl] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<{ a: string; b: string }[]>([{ a: "", b: "" }]);
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);

  const pairs = type === "hash" || type === "zset" || type === "stream";
  const cleanRows = rows.filter((r) => r.a !== "" || (pairs && r.b !== ""));
  const ttlN = ttl.trim() ? Number(ttl) : -1;
  const problems: string[] = [];
  if (!name) problems.push("Name is required");
  if (ttl.trim() && (!Number.isInteger(ttlN) || ttlN <= 0)) problems.push("TTL must be a positive integer");
  if (type !== "string" && !cleanRows.length) problems.push(`Add at least one ${type === "hash" || type === "stream" ? "field" : "member"}`);
  if (type === "zset" && cleanRows.some((r) => r.b.trim() === "" || Number.isNaN(Number(r.b)))) problems.push("Scores must be numbers");

  const value = () => {
    switch (type) {
      case "string": return text;
      case "list": case "set": return cleanRows.map((r) => r.a);
      case "zset": return cleanRows.map((r) => [r.a, Number(r.b)]);
      case "hash": return Object.fromEntries(cleanRows.map((r) => [r.a, r.b]));
      case "stream": return [{ id: "*", fields: Object.fromEntries(cleanRows.map((r) => [r.a, r.b])) }];
    }
  };

  const create = async () => {
    if (problems.length) return;
    setBusy(true);
    try {
      if (!overwrite) {
        const [r] = await api.execute(connId, cmd("EXISTS", name), { database: db, skipHistory: true });
        if (r?.message && /\(integer\) [1-9]/.test(r.message)) {
          setOverwrite(true);
          toast.warning(`"${name}" already exists — click Create again to overwrite it.`);
          return;
        }
      }
      await api.setKey(connId, db, { key: name, type, ttl: ttlN, value: value() });
      toast.success(`Created ${name}`);
      onCreated(name);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const colA = type === "hash" || type === "stream" ? "Field" : type === "list" ? "Element" : "Member";
  return (
    <Dialog open onClose={onClose} title="New key" width={540}
      footer={<>
        {problems.length > 0 && <span className="mr-auto text-xs text-faint">{problems[0]}</span>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={overwrite ? "danger" : "primary"} onClick={create} disabled={problems.length > 0} loading={busy}>{overwrite ? "Overwrite" : "Create"}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_140px_110px] gap-2">
          <Field label="Key name"><Input value={name} onChange={(e) => { setName(e.target.value); setOverwrite(false); }} className="font-mono" autoFocus /></Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as NewType)}>
              {TYPES.map((t) => <option key={t} value={t}>{typeMeta(t).label} — {t}</option>)}
            </Select>
          </Field>
          <Field label="TTL (seconds)"><Input value={ttl} onChange={(e) => setTtl(e.target.value)} placeholder="none" type="number" min={1} /></Field>
        </div>
        {type === "string" ? (
          <Field label="Value"><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} /></Field>
        ) : (
          <div>
            <div className="mb-1 grid grid-cols-[1fr_1fr_24px] gap-1 text-xs text-muted">
              <span>{colA}</span>{pairs ? <span>{type === "zset" ? "Score" : "Value"}</span> : <span />}<span />
            </div>
            <div className="flex max-h-64 flex-col gap-1 overflow-auto">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-1">
                  <Input value={r.a} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} className="font-mono text-xs"
                    onKeyDown={(e) => e.key === "Enter" && i === rows.length - 1 && setRows([...rows, { a: "", b: type === "zset" ? "0" : "" }])} />
                  {pairs ? (
                    <Input value={r.b} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, b: e.target.value } : x)))} className="font-mono text-xs"
                      placeholder={type === "zset" ? "0" : ""}
                      onKeyDown={(e) => e.key === "Enter" && i === rows.length - 1 && setRows([...rows, { a: "", b: type === "zset" ? "0" : "" }])} />
                  ) : <span />}
                  <IconButton title="Remove" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ a: "", b: "" }])}><X className="size-3.5" /></IconButton>
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setRows([...rows, { a: "", b: type === "zset" ? "0" : "" }])}><Plus className="size-3.5" />Add row</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
