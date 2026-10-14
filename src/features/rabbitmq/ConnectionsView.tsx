import { Lock, Power } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Input, Spinner, Toolbar } from "../../components/ui";
import { rmq, type Channel, type Connection, type ConsumerDetail } from "./api";
import { act, usePoll, useRabbit } from "./context";
import { argsSummary, fmtBytes, fmtDuration, fmtNum, fmtRate, rate } from "./format";
import { Confirm, DataTable, DetailPanel, ErrorBanner, KV, Pager, Section, StateDot, type Col } from "./parts";
import { usePaged } from "./usePaged";

function clientLabel(c: Connection): string {
  const p = c.client_properties ?? {};
  return [p.product, p.version].filter(Boolean).join(" ") || p.platform || "";
}

// ---------------------------------------------------------------------------
// Connections

export function ConnectionsView() {
  const ctx = useRabbit();
  const list = usePaged<Connection>("connections", { key: "name", desc: false });
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (ctx.focus?.view === "connections") setSel(ctx.focus.name);
  }, [ctx.focus]);

  const cols = useMemo<Col<Connection>[]>(() => [
    { id: "name", header: "Name", width: 250, sort: "name", render: (c) => <span className="font-mono">{c.name}</span>, title: (c) => c.name },
    { id: "cname", header: "Client name", width: 150, render: (c) => <span className="text-fg/80">{c.user_provided_name ?? c.client_properties?.connection_name ?? ""}</span> },
    { id: "user", header: "User", width: 90, sort: "user", render: (c) => c.user },
    ...(ctx.vhost ? [] : [{ id: "vhost", header: "Vhost", width: 80, sort: "vhost", render: (c: Connection) => <span className="text-muted">{c.vhost}</span> }]),
    { id: "client", header: "Client", width: 150, render: (c) => <span className="text-muted">{clientLabel(c)}</span>, title: clientLabel },
    { id: "proto", header: "Protocol", width: 90, render: (c) => <span className="inline-flex items-center gap-1">{c.ssl && <Lock className="size-3 text-ok" />}{c.protocol}</span> },
    { id: "state", header: "State", width: 80, sort: "state", render: (c) => <StateDot state={c.state} /> },
    { id: "ch", header: "Channels", width: 70, align: "right", sort: "channels", render: (c) => fmtNum(c.channels) },
    { id: "recv", header: "From client", width: 90, align: "right", sort: "recv_oct_details.rate", render: (c) => fmtBytes(rate(c.recv_oct_details)) + "/s" },
    { id: "send", header: "To client", width: 90, align: "right", sort: "send_oct_details.rate", render: (c) => fmtBytes(rate(c.send_oct_details)) + "/s" },
  ], [ctx.vhost]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar>
          <span className="px-1 text-xs font-semibold">Connections</span>
          {list.loading && <Spinner className="size-3" />}
        </Toolbar>
        {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
        <DataTable
          rows={list.rows} cols={cols} rowKey={(c) => c.name}
          selectedKey={sel} onRowClick={(c) => setSel(c.name)}
          sort={list.sort} onSort={list.setSort}
          loading={!list.data && !list.error}
          empty="No client connections"
        />
        {list.data && <Pager page={list.page} pageCount={list.data.page_count} filtered={list.data.filtered_count} total={list.data.total_count} onPage={list.setPage} />}
      </div>
      {sel && <ConnectionDetail key={sel} name={sel} onClose={() => setSel(null)} onChanged={list.reload} />}
    </div>
  );
}

function ConnectionDetail({ name, onClose, onChanged }: { name: string; onClose: () => void; onChanged: () => void }) {
  const { connId, readOnly } = useRabbit();
  const [tab, setTab] = useState<"overview" | "client" | "channels">("overview");
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("Closed from DevCat");
  const d = usePoll(() => rmq.get<Connection>(connId, "connections", null, name), [connId, name]);
  const chans = usePoll(
    () => rmq.request<Channel[]>(connId, "GET", `/connections/${encodeURIComponent(name)}/channels`),
    [connId, name],
    { enabled: tab === "channels" },
  );
  const c = d.data;
  const props = c?.client_properties ?? {};
  const { capabilities, ...rest } = props as { capabilities?: Record<string, unknown> } & Record<string, unknown>;

  return (
    <DetailPanel
      title={name}
      badges={c && <>
        <Badge>{c.vhost}</Badge>
        <Badge>{c.user}</Badge>
        {c.ssl && <Badge tone="ok">TLS</Badge>}
        <Badge tone={c.state === "running" ? "ok" : "warn"}>{c.state}</Badge>
      </>}
      actions={!readOnly && <Button size="sm" variant="danger" onClick={() => setClosing(true)} disabled={!c}><Power className="size-3" />Close</Button>}
      tabs={[{ id: "overview", label: "Overview" }, { id: "client", label: "Client properties" }, { id: "channels", label: <>Channels <span className="text-faint">{c?.channels ?? ""}</span></> }]}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
    >
      {d.error && <div className="mb-2"><ErrorBanner error={d.error} onRetry={d.reload} /></div>}
      {!c && !d.error && <Spinner />}
      {c && tab === "overview" && (
        <Section title="Connection">
          <KV rows={[
            ["Client name", c.user_provided_name ?? props.connection_name ?? "–"],
            ["Client", clientLabel(c) || "–"],
            ["Peer", `${c.peer_host}:${c.peer_port}`],
            ["Node", c.node],
            ["Protocol", c.protocol],
            ["Connected", c.connected_at ? `${new Date(c.connected_at).toLocaleString()} (${fmtDuration(Date.now() - c.connected_at)} ago)` : "–"],
            ["Heartbeat", c.timeout != null ? `${c.timeout}s` : "–"],
            ["Frame max", c.frame_max != null ? fmtBytes(c.frame_max) : "–"],
            ["Channel max", c.channel_max ?? "–"],
            ["Received", `${fmtBytes(c.recv_oct)} · ${fmtBytes(rate(c.recv_oct_details))}/s`],
            ["Sent", `${fmtBytes(c.send_oct)} · ${fmtBytes(rate(c.send_oct_details))}/s`],
            ...(c.ssl ? [["TLS", `${c.ssl_protocol ?? ""} ${c.ssl_cipher ?? ""}`.trim() || "yes"] as [string, string]] : []),
            ["Auth mechanism", c.auth_mechanism ?? "–"],
          ]} />
        </Section>
      )}
      {c && tab === "client" && (
        <div className="space-y-3">
          <Section title="Client properties">
            <KV rows={Object.entries(rest).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])} />
          </Section>
          {capabilities && (
            <Section title="Capabilities">
              <div className="flex flex-wrap gap-1">
                {Object.entries(capabilities).map(([k, v]) => <Badge key={k} tone={v ? "ok" : "default"}>{k}</Badge>)}
              </div>
            </Section>
          )}
        </div>
      )}
      {tab === "channels" && (
        chans.error ? <ErrorBanner error={chans.error} onRetry={chans.reload} /> : !chans.data ? <Spinner /> : (
          <div className="overflow-hidden rounded border border-line text-xs">
            <div className="grid grid-cols-[50px_1fr_70px_70px_80px_80px] bg-raised px-2 py-1 text-[11px] text-muted">
              <div>#</div><div>Mode</div><div>Consumers</div><div>Prefetch</div><div>Unacked</div><div>State</div>
            </div>
            {chans.data.length === 0 && <div className="px-2 py-2 text-[11px] text-faint">No channels</div>}
            {chans.data.map((ch) => (
              <div key={ch.name} className="grid grid-cols-[50px_1fr_70px_70px_80px_80px] items-center border-t border-line/60 px-2 py-0.5 tabular-nums">
                <div>{ch.number}</div>
                <div className="text-muted">{[ch.confirm && "confirm", ch.transactional && "tx"].filter(Boolean).join(", ") || "–"}</div>
                <div>{ch.consumer_count ?? 0}</div>
                <div>{ch.prefetch_count ?? 0}</div>
                <div>{fmtNum(ch.messages_unacknowledged)}</div>
                <div><StateDot state={ch.state} /></div>
              </div>
            ))}
          </div>
        )
      )}

      <Confirm
        open={closing}
        title="Close connection"
        confirmLabel="Force close"
        onClose={() => setClosing(false)}
        onConfirm={async () => {
          await act(rmq.closeConnection(connId, name, reason), "Connection closed");
          onChanged();
          onClose();
        }}
      >
        <div className="space-y-3">
          <div>Force-close <span className="font-mono">{name}</span>{c ? <> ({c.user}@{c.vhost})</> : null}? The client will see a connection-forced error and may reconnect.</div>
          <Field label="Reason (sent to the client)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Confirm>
    </DetailPanel>
  );
}

// ---------------------------------------------------------------------------
// Channels

export function ChannelsView() {
  const ctx = useRabbit();
  const list = usePaged<Channel>("channels", { key: "name", desc: false });
  const cols = useMemo<Col<Channel>[]>(() => [
    { id: "name", header: "Channel", width: 280, sort: "name", render: (c) => <span className="font-mono">{c.name}</span>, title: (c) => c.name },
    { id: "user", header: "User", width: 90, sort: "user", render: (c) => c.user },
    ...(ctx.vhost ? [] : [{ id: "vhost", header: "Vhost", width: 80, sort: "vhost", render: (c: Channel) => <span className="text-muted">{c.vhost}</span> }]),
    { id: "mode", header: "Mode", width: 80, render: (c) => <span className="text-muted">{[c.confirm && "C", c.transactional && "T"].filter(Boolean).join(" ")}</span>, title: () => "C = confirm, T = transactional" },
    { id: "state", header: "State", width: 80, sort: "state", render: (c) => <StateDot state={c.state} /> },
    { id: "consumers", header: "Consumers", width: 80, align: "right", sort: "consumer_count", render: (c) => fmtNum(c.consumer_count) },
    { id: "prefetch", header: "Prefetch", width: 70, align: "right", sort: "prefetch_count", render: (c) => fmtNum(c.prefetch_count) },
    { id: "unacked", header: "Unacked", width: 76, align: "right", sort: "messages_unacknowledged", render: (c) => <span className={(c.messages_unacknowledged ?? 0) > 0 ? "text-warn" : ""}>{fmtNum(c.messages_unacknowledged)}</span> },
    { id: "unconf", header: "Unconfirmed", width: 86, align: "right", sort: "messages_unconfirmed", render: (c) => fmtNum(c.messages_unconfirmed) },
    { id: "pub", header: "Publish", width: 76, align: "right", sort: "message_stats.publish_details.rate", render: (c) => fmtRate(rate(c.message_stats?.publish_details)) },
    { id: "del", header: "Deliver", width: 76, align: "right", sort: "message_stats.deliver_get_details.rate", render: (c) => fmtRate(rate(c.message_stats?.deliver_get_details)) },
    { id: "ack", header: "Ack", width: 70, align: "right", sort: "message_stats.ack_details.rate", render: (c) => fmtRate(rate(c.message_stats?.ack_details)) },
  ], [ctx.vhost]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <span className="px-1 text-xs font-semibold">Channels</span>
        {list.loading && <Spinner className="size-3" />}
      </Toolbar>
      {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
      <DataTable
        rows={list.rows} cols={cols} rowKey={(c) => c.name}
        onRowClick={(c) => c.connection_details && ctx.open({ view: "connections", vhost: c.vhost, name: c.connection_details.name })}
        sort={list.sort} onSort={list.setSort}
        loading={!list.data && !list.error} empty="No channels"
      />
      {list.data && <Pager page={list.page} pageCount={list.data.page_count} filtered={list.data.filtered_count} total={list.data.total_count} onPage={list.setPage} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Consumers

export function ConsumersView() {
  const ctx = useRabbit();
  const list = usePaged<ConsumerDetail>("consumers", { key: "queue.name", desc: false });
  const cols = useMemo<Col<ConsumerDetail>[]>(() => [
    { id: "queue", header: "Queue", width: 220, sort: "queue.name", render: (c) => <span className="font-mono">{c.queue?.name}</span>, title: (c) => c.queue?.name ?? "" },
    ...(ctx.vhost ? [] : [{ id: "vhost", header: "Vhost", width: 80, sort: "queue.vhost", render: (c: ConsumerDetail) => <span className="text-muted">{c.queue?.vhost}</span> }]),
    { id: "tag", header: "Consumer tag", width: 220, sort: "consumer_tag", render: (c) => <span className="font-mono text-fg/80">{c.consumer_tag}</span>, title: (c) => c.consumer_tag },
    { id: "channel", header: "Channel", width: 240, sort: "channel_details.name", render: (c) => <span className="font-mono text-muted">{c.channel_details?.name}</span>, title: (c) => c.channel_details?.name ?? "" },
    { id: "ack", header: "Ack", width: 64, render: (c) => (c.ack_required ? "manual" : "auto") },
    { id: "excl", header: "Exclusive", width: 70, render: (c) => (c.exclusive ? "yes" : "") },
    { id: "prefetch", header: "Prefetch", width: 70, align: "right", sort: "prefetch_count", render: (c) => fmtNum(c.prefetch_count) },
    { id: "status", header: "Status", width: 80, render: (c) => <Badge tone={c.active === false ? "warn" : "ok"}>{c.activity_status ?? (c.active === false ? "waiting" : "up")}</Badge> },
    { id: "args", header: "Arguments", width: 140, render: (c) => <span className="text-muted">{argsSummary(c.arguments)}</span>, title: (c) => argsSummary(c.arguments) },
  ], [ctx.vhost]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <span className="px-1 text-xs font-semibold">Consumers</span>
        {list.loading && <Spinner className="size-3" />}
      </Toolbar>
      {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
      <DataTable
        rows={list.rows} cols={cols}
        rowKey={(c) => `${c.channel_details?.name}\u0001${c.consumer_tag}`}
        onRowClick={(c) => c.queue && ctx.open({ view: "queues", vhost: c.queue.vhost, name: c.queue.name })}
        sort={list.sort} onSort={list.setSort}
        loading={!list.data && !list.error} empty="No consumers"
      />
      {list.data && <Pager page={list.page} pageCount={list.data.page_count} filtered={list.data.filtered_count} total={list.data.total_count} onPage={list.setPage} />}
    </div>
  );
}
