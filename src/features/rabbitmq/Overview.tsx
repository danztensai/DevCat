import { Server } from "lucide-react";
import { useMemo } from "react";
import { Badge, Spinner } from "../../components/ui";
import { rmq, type MessageStats, type Overview as OverviewT, type RmqNode, type Vhost } from "./api";
import { usePoll, useRabbit } from "./context";
import { fmtBytes, fmtDuration, fmtNum, fmtRate, rate } from "./format";
import { ErrorBanner, Section, StatCard, TimeChart, UsageBar, useTimeSeries } from "./parts";
import { lengthInput, QUEUED_SERIES, RATE_SERIES, rateInput, type Lengths } from "./series";


export default function Overview() {
  const { connId, vhost } = useRabbit();
  const ov = usePoll(async () => {
    const [o, v] = await Promise.all([
      rmq.overview(connId),
      vhost ? rmq.get<Vhost>(connId, "vhosts", null, vhost) : Promise.resolve(null),
    ]);
    return { o, v, vhost, at: Date.now() };
  }, [connId, vhost]);
  const nodes = usePoll(() => rmq.nodes(connId), [connId]);

  const d = ov.data && ov.data.vhost === vhost ? ov.data : null;
  const o: OverviewT | undefined = d?.o;
  const scope: { stats?: MessageStats; lengths?: Lengths } = d?.v
    ? { stats: d.v.message_stats, lengths: d.v }
    : { stats: o?.message_stats, lengths: o?.queue_totals };

  const rateIn = useMemo(() => (d ? rateInput(d.v ? d.v.message_stats : d.o.message_stats, d.at) : null), [d]);
  const lenIn = useMemo(() => (d ? lengthInput(d.v ?? d.o.queue_totals, d.at) : null), [d]);
  const rates = useTimeSeries(`${connId}|${vhost}|rates`, rateIn);
  const lengths = useTimeSeries(`${connId}|${vhost}|len`, lenIn);

  if (!o && ov.error) return <ErrorBanner error={ov.error} onRetry={ov.reload} />;
  if (!o) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const t = o.object_totals;
  const ql = scope.lengths ?? {};
  const st = scope.stats ?? {};
  const scopeLabel = vhost ? `vhost ${vhost}` : "cluster";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {ov.error && <ErrorBanner error={ov.error} onRetry={ov.reload} />}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="text-sm font-semibold text-fg">{o.cluster_name ?? o.node}</span>
          <Badge tone="accent">RabbitMQ {o.rabbitmq_version}</Badge>
          <Badge>Erlang {o.erlang_version}</Badge>
          {o.management_version && <Badge>mgmt {o.management_version}</Badge>}
          {vhost && <Badge tone="info">rates & queued: {scopeLabel}</Badge>}
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
          <StatCard label="Connections" value={fmtNum(t?.connections)} />
          <StatCard label="Channels" value={fmtNum(t?.channels)} />
          <StatCard label="Queues" value={fmtNum(t?.queues)} sub={`${fmtNum(t?.exchanges)} exchanges`} />
          <StatCard label="Consumers" value={fmtNum(t?.consumers)} />
          <StatCard label="Ready" value={fmtNum(ql.messages_ready)} sub={scopeLabel} />
          <StatCard label="Unacked" value={fmtNum(ql.messages_unacknowledged)} sub={scopeLabel} tone={(ql.messages_unacknowledged ?? 0) > 0 ? "warn" : undefined} />
          <StatCard label="Publish" value={fmtRate(rate(st.publish_details))} sub={`deliver ${fmtRate(rate(st.deliver_get_details))}`} />
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <Section title={<>Message rates <span className="font-normal text-faint">· last 10 min · {scopeLabel}</span></>}>
            <TimeChart data={rates} series={RATE_SERIES} fmt={fmtRate} empty={o.message_stats ? "Collecting samples…" : "No message rate statistics available on this broker"} />
          </Section>
          <Section title={<>Queued messages <span className="font-normal text-faint">· last 10 min · {scopeLabel}</span></>}>
            <TimeChart data={lengths} series={QUEUED_SERIES} fmt={fmtNum} />
          </Section>
        </div>

        <Section title="Node health" actions={nodes.loading && !nodes.data ? <Spinner className="size-3" /> : undefined}>
          {nodes.error && !nodes.data ? (
            <div className="text-xs text-danger">{nodes.error}</div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {(nodes.data ?? []).map((n) => <NodeCard key={n.name} n={n} />)}
            </div>
          )}
        </Section>

        {o.listeners && o.listeners.length > 0 && (
          <Section title="Listeners">
            <div className="selectable grid grid-cols-[auto_auto_auto_1fr] gap-x-6 gap-y-1 text-xs">
              <div className="text-muted">Protocol</div><div className="text-muted">Bound to</div><div className="text-muted">Port</div><div className="text-muted">Node</div>
              {o.listeners.map((l) => (
                <div key={`${l.node}-${l.protocol}-${l.port}-${l.ip_address}`} className="contents font-mono">
                  <div>{l.protocol}</div><div>{l.ip_address}</div><div>{l.port}</div><div className="truncate text-muted">{l.node}</div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

export function NodeCard({ n }: { n: RmqNode }) {
  const alarms = [n.mem_alarm && "memory", n.disk_free_alarm && "disk"].filter(Boolean) as string[];
  return (
    <div className="space-y-2 rounded-md border border-line bg-app/40 p-3">
      <div className="flex items-center gap-2">
        <Server className="size-3.5 text-muted" />
        <span className="truncate font-mono text-xs font-medium">{n.name}</span>
        <div className="flex-1" />
        {n.running ? <Badge tone="ok">running</Badge> : <Badge tone="danger">down</Badge>}
        {alarms.map((a) => <Badge key={a} tone="danger">{a} alarm</Badge>)}
        {(n.partitions?.length ?? 0) > 0 && <Badge tone="danger">partitioned</Badge>}
      </div>
      {n.running ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <UsageBar label="Memory" used={n.mem_used} total={n.mem_limit} fmt={fmtBytes} alarm={n.mem_alarm} />
          <DiskBar n={n} />
          <UsageBar label="File descriptors" used={n.fd_used} total={n.fd_total} fmt={fmtNum} />
          {n.sockets_total ? <UsageBar label="Sockets" used={n.sockets_used} total={n.sockets_total} fmt={fmtNum} /> : null}
          <UsageBar label="Erlang processes" used={n.proc_used} total={n.proc_total} fmt={fmtNum} />
          <div className="flex items-end justify-between text-[11px] text-muted">
            <span>Uptime <span className="text-fg/80">{fmtDuration(n.uptime)}</span></span>
            {n.processors != null && <span>{n.processors} cores · run queue {n.run_queue ?? 0}</span>}
          </div>
        </div>
      ) : (
        <div className="text-xs text-danger">Node is not running.</div>
      )}
    </div>
  );
}

/** Disk is shown as free space relative to the alarm threshold (higher is better). */
function DiskBar({ n }: { n: RmqNode }) {
  const free = n.disk_free, limit = n.disk_free_limit;
  // fill = how close free space is to the limit: limit/free (100% = at alarm)
  const pressure = free && limit ? Math.min(1, limit / free) : 0;
  return (
    <UsageBar
      label="Disk free"
      used={pressure * 100}
      total={100}
      fmt={fmtNum}
      alarm={n.disk_free_alarm}
      text={`${fmtBytes(free)} free · limit ${fmtBytes(limit)}`}
    />
  );
}
