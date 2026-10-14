import { Eraser, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Checkbox, Spinner, Toolbar } from "../../components/ui";
import { rmq, type Queue } from "./api";
import { BindingsPanel } from "./Bindings";
import { act, usePoll, useRabbit } from "./context";
import { DeclareQueueDialog } from "./Dialogs";
import { argsSummary, fmtBytes, fmtNum, fmtRate, rate } from "./format";
import { GetMessages, PublishForm } from "./Messages";
import { lengthInput, QUEUED_SERIES, RATE_SERIES, rateInput } from "./series";
import {
  Confirm, DataTable, DetailPanel, ErrorBanner, Features, KV, Pager, QueueTypeBadge, Section, StateDot,
  TimeChart, useTimeSeries, type Col,
} from "./parts";
import { usePaged } from "./usePaged";

const key = (vhost: string, name: string) => `${vhost}\u0001${name}`;

export default function QueuesView() {
  const ctx = useRabbit();
  const list = usePaged<Queue>("queues", { key: "name", desc: false });
  const [sel, setSel] = useState<{ vhost: string; name: string } | null>(null);
  const [declare, setDeclare] = useState(false);

  useEffect(() => {
    if (ctx.focus?.view === "queues") setSel({ vhost: ctx.focus.vhost, name: ctx.focus.name });
  }, [ctx.focus]);

  const cols = useMemo<Col<Queue>[]>(() => [
    { id: "name", header: "Name", width: 260, sort: "name", render: (q) => <span className="font-mono">{q.name}</span>, title: (q) => q.name },
    ...(ctx.vhost ? [] : [{ id: "vhost", header: "Vhost", width: 90, sort: "vhost", render: (q: Queue) => <span className="text-muted">{q.vhost}</span> }]),
    { id: "type", header: "Type", width: 76, sort: "type", render: (q) => <QueueTypeBadge type={q.type} /> },
    { id: "features", header: "Features", width: 120, render: (q) => <Features durable={q.durable} autoDelete={q.auto_delete} exclusive={q.exclusive} args={q.arguments} />, title: (q) => argsSummary(q.arguments) },
    { id: "state", header: "State", width: 84, sort: "state", render: (q) => <StateDot state={q.state} /> },
    { id: "ready", header: "Ready", width: 76, align: "right", sort: "messages_ready", render: (q) => fmtNum(q.messages_ready) },
    { id: "unacked", header: "Unacked", width: 76, align: "right", sort: "messages_unacknowledged", render: (q) => <span className={(q.messages_unacknowledged ?? 0) > 0 ? "text-warn" : ""}>{fmtNum(q.messages_unacknowledged)}</span> },
    { id: "total", header: "Total", width: 76, align: "right", sort: "messages", render: (q) => <span className="font-medium">{fmtNum(q.messages)}</span> },
    { id: "in", header: "Incoming", width: 80, align: "right", sort: "message_stats.publish_details.rate", render: (q) => fmtRate(rate(q.message_stats?.publish_details)) },
    { id: "deliver", header: "Deliver", width: 80, align: "right", sort: "message_stats.deliver_get_details.rate", render: (q) => fmtRate(rate(q.message_stats?.deliver_get_details)) },
    { id: "ack", header: "Ack", width: 72, align: "right", sort: "message_stats.ack_details.rate", render: (q) => fmtRate(rate(q.message_stats?.ack_details)) },
    { id: "consumers", header: "Consumers", width: 84, align: "right", sort: "consumers", render: (q) => <span className={q.consumers === 0 && (q.messages ?? 0) > 0 ? "text-warn" : ""}>{fmtNum(q.consumers)}</span> },
  ], [ctx.vhost]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar>
          <span className="px-1 text-xs font-semibold">Queues</span>
          {list.loading && <Spinner className="size-3" />}
          <div className="flex-1" />
          {!ctx.readOnly && <Button size="sm" onClick={() => setDeclare(true)}><Plus className="size-3" />Declare queue</Button>}
        </Toolbar>
        {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
        <DataTable
          rows={list.rows}
          cols={cols}
          rowKey={(q) => key(q.vhost, q.name)}
          selectedKey={sel ? key(sel.vhost, sel.name) : null}
          onRowClick={(q) => setSel({ vhost: q.vhost, name: q.name })}
          sort={list.sort}
          onSort={list.setSort}
          loading={!list.data && !list.error}
          empty={ctx.search ? "No queues match the filter" : "No queues"}
        />
        {list.data && <Pager page={list.page} pageCount={list.data.page_count} filtered={list.data.filtered_count} total={list.data.total_count} onPage={list.setPage} />}
      </div>
      {sel && <QueueDetail key={key(sel.vhost, sel.name)} vhost={sel.vhost} name={sel.name} onClose={() => setSel(null)} onChanged={list.reload} />}
      <DeclareQueueDialog open={declare} onClose={() => setDeclare(false)} onDone={(vhost, name) => { void list.reload(); setSel({ vhost, name }); }} />
    </div>
  );
}

type DetailTab = "overview" | "consumers" | "bindings" | "get" | "publish";

function QueueDetail({ vhost, name, onClose, onChanged }: { vhost: string; name: string; onClose: () => void; onChanged: () => void }) {
  const { connId, readOnly } = useRabbit();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [confirm, setConfirm] = useState<"purge" | "delete" | null>(null);
  const [ifEmpty, setIfEmpty] = useState(false);
  const [ifUnused, setIfUnused] = useState(false);
  const d = usePoll(async () => ({ q: await rmq.get<Queue>(connId, "queues", vhost, name), at: Date.now() }), [connId, vhost, name]);
  const q = d.data?.q;

  const rateIn = useMemo(() => (d.data ? rateInput(d.data.q.message_stats, d.data.at) : null), [d.data]);
  const lenIn = useMemo(() => (d.data ? lengthInput(d.data.q, d.data.at) : null), [d.data]);
  const rates = useTimeSeries(`${connId}|q|${vhost}|${name}|r`, rateIn);
  const lengths = useTimeSeries(`${connId}|q|${vhost}|${name}|l`, lenIn);

  const consumers = q?.consumer_details ?? [];
  const isStream = q?.type === "stream";

  return (
    <DetailPanel
      title={name}
      badges={<>
        <Badge>{vhost}</Badge>
        {q && <QueueTypeBadge type={q.type} />}
        {q && <Features durable={q.durable} autoDelete={q.auto_delete} exclusive={q.exclusive} args={q.arguments} />}
        {q?.policy && <Badge tone="info">policy {q.policy}</Badge>}
      </>}
      actions={!readOnly && <>
        <Button size="sm" onClick={() => setConfirm("purge")} disabled={!q || isStream} title={isStream ? "Streams cannot be purged" : undefined}><Eraser className="size-3" />Purge</Button>
        <Button size="sm" variant="danger" onClick={() => setConfirm("delete")}><Trash2 className="size-3" />Delete</Button>
      </>}
      tabs={[
        { id: "overview", label: "Overview" },
        { id: "consumers", label: <>Consumers <span className="text-faint">{q?.consumers ?? ""}</span></> },
        { id: "bindings", label: "Bindings" },
        { id: "get", label: "Get messages" },
        { id: "publish", label: "Publish" },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
    >
      {d.error && <div className="mb-2"><ErrorBanner error={d.error} onRetry={d.reload} /></div>}
      {!q && !d.error && <Spinner />}
      {q && tab === "overview" && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["Ready", q.messages_ready], ["Unacked", q.messages_unacknowledged], ["Total", q.messages], ["Consumers", q.consumers]].map(([l, v]) => (
              <div key={l as string} className="rounded border border-line bg-panel py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted">{l}</div>
                <div className="text-lg font-semibold tabular-nums">{fmtNum(v as number)}</div>
              </div>
            ))}
          </div>
          <Section title="Message rates"><TimeChart data={rates} series={RATE_SERIES} fmt={fmtRate} height={150} /></Section>
          <Section title="Queued messages"><TimeChart data={lengths} series={QUEUED_SERIES} fmt={fmtNum} height={150} /></Section>
          <Section title="Details">
            <KV rows={[
              ["State", <StateDot state={q.state} />],
              ["Node", q.node ?? q.leader],
              ...(q.members ? [["Members", q.members.join(", ")] as [string, string]] : []),
              ["Memory", fmtBytes(q.memory)],
              ["Message bytes", fmtBytes(q.message_bytes)],
              ["Consumer utilisation", q.consumer_utilisation != null ? `${Math.round(q.consumer_utilisation * 100)}%` : "–"],
              ["Durable", String(q.durable)],
              ["Auto-delete", String(q.auto_delete)],
              ["Exclusive", String(q.exclusive ?? false)],
              ["Policy", q.policy || "–"],
              ["Arguments", Object.keys(q.arguments ?? {}).length ? <pre className="whitespace-pre-wrap">{JSON.stringify(q.arguments, null, 2)}</pre> : "–"],
              ...(q.idle_since ? [["Idle since", q.idle_since] as [string, string]] : []),
            ]} />
          </Section>
        </div>
      )}
      {q && tab === "consumers" && (
        consumers.length === 0 ? <div className="text-xs text-muted">No consumers.</div> : (
          <div className="overflow-hidden rounded border border-line text-xs">
            <div className="grid grid-cols-[1.4fr_1.6fr_60px_60px_70px] bg-raised px-2 py-1 text-[11px] text-muted">
              <div>Consumer tag</div><div>Channel</div><div>Ack</div><div>Prefetch</div><div>Status</div>
            </div>
            {consumers.map((c) => (
              <div key={c.consumer_tag + c.channel_details?.name} className="grid grid-cols-[1.4fr_1.6fr_60px_60px_70px] items-center border-t border-line/60 px-2 py-0.5">
                <div className="truncate font-mono" title={c.consumer_tag}>{c.consumer_tag}</div>
                <div className="truncate font-mono text-muted" title={c.channel_details?.name}>{c.channel_details?.name}</div>
                <div>{c.ack_required ? "manual" : "auto"}</div>
                <div className="tabular-nums">{c.prefetch_count}</div>
                <div><Badge tone={c.active === false ? "warn" : "ok"}>{c.activity_status ?? (c.active === false ? "waiting" : "up")}</Badge></div>
              </div>
            ))}
          </div>
        )
      )}
      {tab === "bindings" && <BindingsPanel vhost={vhost} kind="queue" name={name} />}
      {tab === "get" && <GetMessages vhost={vhost} queue={name} />}
      {tab === "publish" && (
        <div className="space-y-2">
          <div className="text-[11px] text-faint">Publishes through the default exchange with the queue name as routing key.</div>
          <PublishForm vhost={vhost} exchange="" fixedRoutingKey={name} />
        </div>
      )}

      <Confirm
        open={confirm === "purge"}
        title="Purge queue"
        confirmLabel="Purge"
        onClose={() => setConfirm(null)}
        onConfirm={async () => { await act(rmq.purgeQueue(connId, vhost, name), `Purged ${name}`); void d.reload(); onChanged(); }}
      >
        Remove all <b>{fmtNum(q?.messages_ready)}</b> ready messages from <span className="font-mono">{name}</span>? Unacknowledged messages are not affected. This cannot be undone.
      </Confirm>
      <Confirm
        open={confirm === "delete"}
        title="Delete queue"
        confirmLabel="Delete queue"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await act(rmq.deleteQueue(connId, vhost, name, ifEmpty, ifUnused), `Deleted ${name}`);
          onChanged();
          onClose();
        }}
      >
        <div className="space-y-3">
          <div>Delete <span className="font-mono">{name}</span> in vhost <span className="font-mono">{vhost}</span>{(q?.messages ?? 0) > 0 && <> and its <b>{fmtNum(q?.messages)}</b> messages</>}?</div>
          <div className="flex gap-4">
            <Checkbox label="Only if empty" checked={ifEmpty} onChange={setIfEmpty} />
            <Checkbox label="Only if unused" checked={ifUnused} onChange={setIfUnused} />
          </div>
        </div>
      </Confirm>
    </DetailPanel>
  );
}
