import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Dialog, Field, IconButton, Input, Select, Spinner, Textarea, Toolbar } from "../../components/ui";
import { errMsg } from "../../lib/api";
import { rmq, type Permission, type Policy, type RmqNode, type User, type Vhost } from "./api";
import { act, usePoll, useRabbit, writeVhost } from "./context";
import { fmtNum, fmtRate, rate } from "./format";
import { NodeCard } from "./Overview";
import { Confirm, DataTable, ErrorBanner, KV, Pager, Section, type Col } from "./parts";
import { usePaged } from "./usePaged";

// ---------------------------------------------------------------------------
// Vhosts

export function VhostsView({ onPick }: { onPick: (vhost: string) => void }) {
  const ctx = useRabbit();
  const list = usePaged<Vhost>("vhosts", { key: "name", desc: false }, { vhostScoped: false });
  const cols = useMemo<Col<Vhost>[]>(() => [
    { id: "name", header: "Name", width: 180, sort: "name", render: (v) => <span className={clsx("font-mono", v.name === ctx.vhost && "text-accent")}>{v.name}</span> },
    { id: "desc", header: "Description", width: 200, render: (v) => <span className="text-muted">{v.description || v.metadata?.description || ""}</span> },
    { id: "dqt", header: "Default queue type", width: 130, render: (v) => <span className="text-muted">{v.default_queue_type ?? v.metadata?.default_queue_type ?? "classic"}</span> },
    { id: "ready", header: "Ready", width: 80, align: "right", sort: "messages_ready", render: (v) => fmtNum(v.messages_ready) },
    { id: "unacked", header: "Unacked", width: 80, align: "right", sort: "messages_unacknowledged", render: (v) => fmtNum(v.messages_unacknowledged) },
    { id: "total", header: "Total", width: 80, align: "right", sort: "messages", render: (v) => fmtNum(v.messages) },
    { id: "pub", header: "Publish", width: 80, align: "right", sort: "message_stats.publish_details.rate", render: (v) => fmtRate(rate(v.message_stats?.publish_details)) },
    { id: "del", header: "Deliver", width: 80, align: "right", sort: "message_stats.deliver_get_details.rate", render: (v) => fmtRate(rate(v.message_stats?.deliver_get_details)) },
    { id: "state", header: "Cluster state", width: 120, render: (v) => {
      const states = Object.values(v.cluster_state ?? {});
      const bad = states.filter((s) => s !== "running").length;
      return states.length === 0 ? "" : bad ? <Badge tone="danger">{bad} node(s) down</Badge> : <Badge tone="ok">running</Badge>;
    } },
    { id: "tags", header: "Tags", width: 120, render: (v) => <span className="text-muted">{(v.tags ?? v.metadata?.tags ?? []).join(", ")}</span> },
  ], [ctx.vhost]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <span className="px-1 text-xs font-semibold">Virtual hosts</span>
        {list.loading && <Spinner className="size-3" />}
        <div className="flex-1" />
        <span className="text-[11px] text-faint">Click a vhost to scope the console to it</span>
      </Toolbar>
      {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
      <DataTable
        rows={list.rows} cols={cols} rowKey={(v) => v.name} selectedKey={ctx.vhost || null}
        onRowClick={(v) => onPick(v.name)}
        sort={list.sort} onSort={list.setSort} loading={!list.data && !list.error} empty="No vhosts"
      />
      {list.data && <Pager page={list.page} pageCount={list.data.page_count} filtered={list.data.filtered_count} total={list.data.total_count} onPage={list.setPage} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users, permissions & policies

type AccessTab = "users" | "permissions" | "policies";

export function AccessView() {
  const [tab, setTab] = useState<AccessTab>("users");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        {(["users", "permissions", "policies"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx("h-6 rounded px-2.5 text-xs capitalize", t === tab ? "bg-hover text-fg" : "text-muted hover:text-fg")}
          >{t}</button>
        ))}
      </Toolbar>
      {tab === "users" && <UsersTable />}
      {tab === "permissions" && <PermissionsTable />}
      {tab === "policies" && <PoliciesTable />}
    </div>
  );
}

function UsersTable() {
  const list = usePaged<User>("users", { key: "name", desc: false }, { vhostScoped: false });
  const cols: Col<User>[] = [
    { id: "name", header: "Name", width: 200, sort: "name", render: (u) => <span className="font-mono">{u.name}</span> },
    { id: "tags", header: "Tags", width: 260, render: (u) => {
      const tags = Array.isArray(u.tags) ? u.tags : String(u.tags || "").split(",").filter(Boolean);
      return <span className="inline-flex gap-1">{tags.map((t) => <Badge key={t} tone={t === "administrator" ? "accent" : "default"}>{t}</Badge>)}</span>;
    } },
    { id: "hash", header: "Hashing", width: 200, render: (u) => <span className="text-muted">{u.hashing_algorithm?.replace("rabbit_password_hashing_", "")}</span> },
    { id: "limits", header: "Limits", width: 160, render: (u) => <span className="text-muted">{u.limits && Object.keys(u.limits).length ? JSON.stringify(u.limits) : ""}</span> },
  ];
  return <PagedTable list={list} cols={cols} rowKey={(u) => u.name} empty="No users (or insufficient permissions)" />;
}

function PermissionsTable() {
  const ctx = useRabbit();
  const list = usePaged<Permission>("permissions", { key: "user", desc: false });
  const cols: Col<Permission>[] = [
    { id: "user", header: "User", width: 180, sort: "user", render: (p) => <span className="font-mono">{p.user}</span> },
    ...(ctx.vhost ? [] : [{ id: "vhost", header: "Vhost", width: 120, sort: "vhost", render: (p: Permission) => <span className="text-muted">{p.vhost}</span> }]),
    { id: "configure", header: "Configure", width: 160, render: (p) => <code className="text-fg/80">{p.configure}</code> },
    { id: "write", header: "Write", width: 160, render: (p) => <code className="text-fg/80">{p.write}</code> },
    { id: "read", header: "Read", width: 160, render: (p) => <code className="text-fg/80">{p.read}</code> },
  ];
  return <PagedTable list={list} cols={cols} rowKey={(p) => `${p.user}\u0001${p.vhost}`} empty="No permissions" />;
}

function PoliciesTable() {
  const ctx = useRabbit();
  const list = usePaged<Policy>("policies", { key: "priority", desc: true });
  const [edit, setEdit] = useState<Policy | "new" | null>(null);
  const [del, setDel] = useState<Policy | null>(null);
  const cols: Col<Policy>[] = [
    { id: "name", header: "Name", width: 180, sort: "name", render: (p) => <span className="font-mono">{p.name}</span> },
    ...(ctx.vhost ? [] : [{ id: "vhost", header: "Vhost", width: 90, sort: "vhost", render: (p: Policy) => <span className="text-muted">{p.vhost}</span> }]),
    { id: "pattern", header: "Pattern", width: 150, sort: "pattern", render: (p) => <code className="text-fg/80">{p.pattern}</code> },
    { id: "apply", header: "Apply to", width: 110, sort: "apply-to", render: (p) => p["apply-to"] },
    { id: "prio", header: "Priority", width: 70, align: "right", sort: "priority", render: (p) => p.priority },
    { id: "def", header: "Definition", width: 260, render: (p) => <code className="text-muted">{JSON.stringify(p.definition)}</code>, title: (p) => JSON.stringify(p.definition, null, 2) },
    { id: "actions", header: "", width: 40, render: (p) => !ctx.readOnly && (
      <IconButton title="Delete policy" onClick={(e) => { e.stopPropagation(); setDel(p); }}><Trash2 className="size-3" /></IconButton>
    ) },
  ];
  return (
    <>
      <PagedTable
        list={list} cols={cols} rowKey={(p) => `${p.vhost}\u0001${p.name}`} empty="No policies"
        onRowClick={ctx.readOnly ? undefined : (p) => setEdit(p)}
        actions={!ctx.readOnly && <Button size="sm" onClick={() => setEdit("new")}><Plus className="size-3" />Add policy</Button>}
      />
      <PolicyDialog policy={edit} onClose={() => setEdit(null)} onDone={list.reload} />
      <Confirm
        open={!!del}
        title="Delete policy"
        confirmLabel="Delete"
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await act(rmq.request(ctx.connId, "DELETE", `/policies/${encodeURIComponent(del.vhost)}/${encodeURIComponent(del.name)}`), `Deleted policy ${del.name}`);
          void list.reload();
        }}
      >
        Delete policy <span className="font-mono">{del?.name}</span> in vhost <span className="font-mono">{del?.vhost}</span>? Matching queues/exchanges revert to their declared arguments.
      </Confirm>
    </>
  );
}

function PolicyDialog({ policy, onClose, onDone }: { policy: Policy | "new" | null; onClose: () => void; onDone: () => void }) {
  const ctx = useRabbit();
  const isNew = policy === "new";
  const [form, setForm] = useState({ vhost: "/", name: "", pattern: ".*", applyTo: "queues", priority: "0", definition: "{\n  \n}" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!policy) return;
    setError(null);
    if (policy === "new") setForm({ vhost: writeVhost(ctx), name: "", pattern: "^", applyTo: "queues", priority: "0", definition: '{\n  "max-length": 10000\n}' });
    else setForm({ vhost: policy.vhost, name: policy.name, pattern: policy.pattern, applyTo: policy["apply-to"], priority: String(policy.priority), definition: JSON.stringify(policy.definition, null, 2) });
  }, [policy]);

  const save = async () => {
    setError(null);
    let definition: unknown;
    try { definition = JSON.parse(form.definition); } catch { setError("Definition must be valid JSON"); return; }
    setBusy(true);
    try {
      await rmq.request(ctx.connId, "PUT", `/policies/${encodeURIComponent(form.vhost)}/${encodeURIComponent(form.name.trim())}`, {
        pattern: form.pattern, definition, priority: Number(form.priority) || 0, "apply-to": form.applyTo,
      });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog
      open={!!policy}
      onClose={onClose}
      title={isNew ? "Add policy" : `Edit policy ${form.name}`}
      width={560}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!form.name.trim()} onClick={save}>Save</Button>
      </>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Virtual host">
            <Select value={form.vhost} onChange={set("vhost")} disabled={!isNew}>
              {(ctx.vhosts.includes(form.vhost) ? ctx.vhosts : [form.vhost, ...ctx.vhosts]).map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Name"><Input value={form.name} onChange={set("name")} disabled={!isNew} /></Field>
          <Field label="Pattern (regex)"><Input value={form.pattern} onChange={set("pattern")} className="font-mono" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Apply to">
              <Select value={form.applyTo} onChange={set("applyTo")}>
                {["queues", "classic_queues", "quorum_queues", "streams", "exchanges", "all"].map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            </Field>
            <Field label="Priority"><Input value={form.priority} onChange={set("priority")} inputMode="numeric" /></Field>
          </div>
        </div>
        <Field label="Definition (JSON)" hint="e.g. max-length, message-ttl, dead-letter-exchange, delivery-limit, queue-leader-locator">
          <Textarea rows={8} value={form.definition} onChange={set("definition")} />
        </Field>
        {error && <div className="selectable rounded border border-danger/30 bg-danger/10 px-2 py-1.5 font-mono text-xs text-danger">{error}</div>}
      </div>
    </Dialog>
  );
}

function PagedTable<T>({ list, cols, rowKey, empty, onRowClick, actions }: {
  list: ReturnType<typeof usePaged<T>>; cols: Col<T>[]; rowKey: (r: T) => string; empty: string;
  onRowClick?: (r: T) => void; actions?: ReactNode;
}) {
  return (
    <>
      {(actions || list.loading) && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
          {list.loading && <Spinner className="size-3" />}
          <div className="flex-1" />
          {actions}
        </div>
      )}
      {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
      <DataTable rows={list.rows} cols={cols} rowKey={rowKey} onRowClick={onRowClick} sort={list.sort} onSort={list.setSort} loading={!list.data && !list.error} empty={empty} />
      {list.data && <Pager page={list.page} pageCount={list.data.page_count} filtered={list.data.filtered_count} total={list.data.total_count} onPage={list.setPage} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Nodes

export function NodesView() {
  const { connId } = useRabbit();
  const nodes = usePoll(() => rmq.nodes(connId), [connId]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <span className="px-1 text-xs font-semibold">Nodes</span>
        {nodes.loading && <Spinner className="size-3" />}
      </Toolbar>
      {nodes.error && <ErrorBanner error={nodes.error} onRetry={nodes.reload} />}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {!nodes.data && !nodes.error && <Spinner />}
        {(nodes.data ?? []).map((n) => <NodeDetail key={n.name} n={n} />)}
      </div>
    </div>
  );
}

function NodeDetail({ n }: { n: RmqNode }) {
  const plugins: string[] = n.enabled_plugins ?? [];
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <NodeCard n={n} />
      <Section title="Details">
        <KV rows={[
          ["Type", n.type ?? "–"],
          ["OS pid", n.os_pid ?? "–"],
          ["Cores", n.processors ?? "–"],
          ["Run queue", n.run_queue ?? "–"],
          ["Rates mode", n.rates_mode ?? "–"],
          ["Partitions", n.partitions?.length ? <span className="text-danger">{n.partitions.join(", ")}</span> : "none"],
          ["Config files", (n.config_files ?? []).join(", ") || "–"],
          ["Plugins", plugins.length ? plugins.join(", ") : "–"],
        ]} />
      </Section>
    </div>
  );
}
