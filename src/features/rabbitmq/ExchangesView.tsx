import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Checkbox, Spinner, Toolbar } from "../../components/ui";
import { rmq, type Exchange } from "./api";
import { BindingsPanel } from "./Bindings";
import { act, usePoll, useRabbit } from "./context";
import { DeclareExchangeDialog } from "./Dialogs";
import { argsSummary, counterRates, fmtRate, rate } from "./format";
import { PublishForm } from "./Messages";
import { Confirm, DataTable, DetailPanel, ErrorBanner, Features, KV, Pager, Section, SERIES, TimeChart, useTimeSeries, type Col, type SeriesDef } from "./parts";
import { usePaged } from "./usePaged";

const key = (vhost: string, name: string) => `${vhost}\u0001${name}`;
const displayName = (n: string) => n || "(AMQP default)";
/** The default exchange and amq.* exchanges cannot be deleted. */
const builtin = (n: string) => n === "" || n.startsWith("amq.");

const TYPE_TONE: Record<string, "info" | "accent" | "ok" | "default"> = { direct: "default", fanout: "accent", topic: "info", headers: "ok" };

const IO_SERIES: SeriesDef[] = [
  { key: "in", label: "Publish in", color: SERIES[0] },
  { key: "out", label: "Publish out", color: SERIES[1] },
];

export default function ExchangesView() {
  const ctx = useRabbit();
  const list = usePaged<Exchange>("exchanges", { key: "name", desc: false });
  const [sel, setSel] = useState<{ vhost: string; name: string } | null>(null);
  const [declare, setDeclare] = useState(false);

  useEffect(() => {
    if (ctx.focus?.view === "exchanges") setSel({ vhost: ctx.focus.vhost, name: ctx.focus.name });
  }, [ctx.focus]);

  const cols = useMemo<Col<Exchange>[]>(() => [
    { id: "name", header: "Name", width: 280, sort: "name", render: (x) => <span className={x.name ? "font-mono" : "font-mono text-muted"}>{displayName(x.name)}</span>, title: (x) => x.name },
    ...(ctx.vhost ? [] : [{ id: "vhost", header: "Vhost", width: 90, sort: "vhost", render: (x: Exchange) => <span className="text-muted">{x.vhost}</span> }]),
    { id: "type", header: "Type", width: 90, sort: "type", render: (x) => <Badge tone={TYPE_TONE[x.type] ?? "default"}>{x.type}</Badge> },
    { id: "features", header: "Features", width: 120, render: (x) => <Features durable={x.durable} autoDelete={x.auto_delete} internal={x.internal} args={x.arguments} />, title: (x) => argsSummary(x.arguments) },
    { id: "policy", header: "Policy", width: 100, render: (x) => <span className="text-muted">{x.policy || ""}</span> },
    { id: "in", header: "Rate in", width: 90, align: "right", sort: "message_stats.publish_in_details.rate", render: (x) => fmtRate(rate(x.message_stats?.publish_in_details)) },
    { id: "out", header: "Rate out", width: 90, align: "right", sort: "message_stats.publish_out_details.rate", render: (x) => fmtRate(rate(x.message_stats?.publish_out_details)) },
  ], [ctx.vhost]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar>
          <span className="px-1 text-xs font-semibold">Exchanges</span>
          {list.loading && <Spinner className="size-3" />}
          <div className="flex-1" />
          {!ctx.readOnly && <Button size="sm" onClick={() => setDeclare(true)}><Plus className="size-3" />Declare exchange</Button>}
        </Toolbar>
        {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
        <DataTable
          rows={list.rows}
          cols={cols}
          rowKey={(x) => key(x.vhost, x.name)}
          selectedKey={sel ? key(sel.vhost, sel.name) : null}
          onRowClick={(x) => setSel({ vhost: x.vhost, name: x.name })}
          sort={list.sort}
          onSort={list.setSort}
          loading={!list.data && !list.error}
          empty={ctx.search ? "No exchanges match the filter" : "No exchanges"}
        />
        {list.data && <Pager page={list.page} pageCount={list.data.page_count} filtered={list.data.filtered_count} total={list.data.total_count} onPage={list.setPage} />}
      </div>
      {sel && <ExchangeDetail key={key(sel.vhost, sel.name)} vhost={sel.vhost} name={sel.name} onClose={() => setSel(null)} onChanged={list.reload} />}
      <DeclareExchangeDialog open={declare} onClose={() => setDeclare(false)} onDone={(vhost, name) => { void list.reload(); setSel({ vhost, name }); }} />
    </div>
  );
}

type DetailTab = "overview" | "bindings" | "publish";

function ExchangeDetail({ vhost, name, onClose, onChanged }: { vhost: string; name: string; onClose: () => void; onChanged: () => void }) {
  const { connId, readOnly } = useRabbit();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [confirm, setConfirm] = useState(false);
  const [ifUnused, setIfUnused] = useState(false);
  // the HTTP API addresses the default exchange as "amq.default"
  const d = usePoll(async () => ({ x: await rmq.get<Exchange>(connId, "exchanges", vhost, name || "amq.default"), at: Date.now() }), [connId, vhost, name]);
  const x = d.data?.x;

  const ioIn = useMemo(() => {
    if (!d.data) return null;
    const s = d.data.x.message_stats ?? {};
    return {
      at: d.data.at,
      sampled: { in: counterRates(s.publish_in_details?.samples), out: counterRates(s.publish_out_details?.samples) },
      live: { in: rate(s.publish_in_details), out: rate(s.publish_out_details) },
    };
  }, [d.data]);
  const io = useTimeSeries(`${connId}|x|${vhost}|${name}`, ioIn);

  return (
    <DetailPanel
      title={displayName(name)}
      badges={<>
        <Badge>{vhost}</Badge>
        {x && <Badge tone={TYPE_TONE[x.type] ?? "default"}>{x.type}</Badge>}
        {x && <Features durable={x.durable} autoDelete={x.auto_delete} internal={x.internal} args={x.arguments} />}
      </>}
      actions={!readOnly && !builtin(name) && (
        <Button size="sm" variant="danger" onClick={() => setConfirm(true)}><Trash2 className="size-3" />Delete</Button>
      )}
      tabs={[
        { id: "overview", label: "Overview" },
        { id: "bindings", label: "Bindings" },
        { id: "publish", label: "Publish message" },
      ]}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
    >
      {d.error && <div className="mb-2"><ErrorBanner error={d.error} onRetry={d.reload} /></div>}
      {!x && !d.error && <Spinner />}
      {x && tab === "overview" && (
        <div className="space-y-3">
          <Section title="Message rates"><TimeChart data={io} series={IO_SERIES} fmt={fmtRate} height={160} /></Section>
          <Section title="Details">
            <KV rows={[
              ["Type", x.type],
              ["Durable", String(x.durable)],
              ["Auto-delete", String(x.auto_delete)],
              ["Internal", String(x.internal)],
              ["Policy", x.policy || "–"],
              ["Arguments", Object.keys(x.arguments ?? {}).length ? <pre className="whitespace-pre-wrap">{JSON.stringify(x.arguments, null, 2)}</pre> : "–"],
            ]} />
          </Section>
        </div>
      )}
      {tab === "bindings" && (name
        ? <BindingsPanel vhost={vhost} kind="exchange" name={name} />
        : <div className="text-xs text-muted">The default exchange is implicitly bound to every queue, with the queue name as routing key. It cannot be bound or unbound explicitly.</div>)}
      {tab === "publish" && (
        x?.internal
          ? <div className="text-xs text-warn">Internal exchanges cannot be published to directly.</div>
          : <PublishForm vhost={vhost} exchange={name} />
      )}

      <Confirm
        open={confirm}
        title="Delete exchange"
        confirmLabel="Delete exchange"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await act(rmq.deleteExchange(connId, vhost, name, ifUnused), `Deleted ${name}`);
          onChanged();
          onClose();
        }}
      >
        <div className="space-y-3">
          <div>Delete exchange <span className="font-mono">{name}</span> in vhost <span className="font-mono">{vhost}</span>? All its bindings are removed too.</div>
          <Checkbox label="Only if unused (no bindings)" checked={ifUnused} onChange={setIfUnused} />
        </div>
      </Confirm>
    </DetailPanel>
  );
}
