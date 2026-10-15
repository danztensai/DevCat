// Applications: workloads grouped by their standard app labels (Lens style).
import clsx from "clsx";
import { ChevronRight, EllipsisVertical, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, ErrorBox, Spinner } from "../../components/ui";
import { useContextMenu, type MenuItem } from "../connections/ContextMenu";
import { k8s, type K8sObject } from "./api";
import { age, ts, useNow } from "./format";
import { useAsync } from "./hooks";
import { kindKeyFor } from "./resources";

const KINDS = ["deployments", "statefulsets", "daemonsets", "cronjobs"] as const;

function appKey(o: K8sObject): string {
  const l = o.metadata.labels ?? {};
  return l["app.kubernetes.io/instance"] ?? l["app.kubernetes.io/name"] ?? l["app"] ?? l["k8s-app"] ?? o.metadata.name;
}

/** [ready, desired] pods for a workload. */
function readiness(o: K8sObject): [number, number] {
  const s = o.status ?? {};
  switch (o.kind) {
    case "DaemonSet": return [s.numberReady ?? 0, s.desiredNumberScheduled ?? 0];
    case "CronJob": return [s.active?.length ?? 0, s.active?.length ?? 0];
    default: return [s.readyReplicas ?? 0, o.spec?.replicas ?? 0];
  }
}

interface App {
  key: string;
  name: string;
  namespace: string;
  version?: string;
  managedBy?: string;
  partOf?: string;
  workloads: K8sObject[];
  ready: number;
  desired: number;
  created: number;
}

export default function Applications({ connId, namespaces, search, menuFor, onSelect }: {
  connId: string;
  namespaces: string[];
  search: string;
  menuFor: (kindKey: string, o: K8sObject) => MenuItem[];
  onSelect: (kindKey: string, o: K8sObject) => void;
}) {
  const now = useNow();
  const nsKey = namespaces.join(",");
  const data = useAsync(async () => {
    const one = namespaces.length === 1 ? namespaces[0] : null;
    const lists = await Promise.all(KINDS.map((k) => k8s.list(connId, k, one).catch(() => [] as K8sObject[])));
    return lists.flat().filter((o) => namespaces.length <= 1 || namespaces.includes(o.metadata.namespace ?? ""));
  }, [connId, nsKey], 15000);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const menu = useContextMenu();

  const apps = useMemo(() => {
    const m = new Map<string, App>();
    for (const o of data.data ?? []) {
      const name = appKey(o);
      const ns = o.metadata.namespace ?? "";
      const key = `${ns}/${name}`;
      const l = o.metadata.labels ?? {};
      const a = m.get(key) ?? { key, name, namespace: ns, workloads: [], ready: 0, desired: 0, created: Infinity };
      a.version ??= l["app.kubernetes.io/version"];
      a.managedBy ??= l["app.kubernetes.io/managed-by"];
      a.partOf ??= l["app.kubernetes.io/part-of"];
      a.workloads.push(o);
      const [r, d] = readiness(o);
      a.ready += r;
      a.desired += d;
      a.created = Math.min(a.created, ts(o.metadata.creationTimestamp));
      m.set(key, a);
    }
    const q = search.trim().toLowerCase();
    return [...m.values()]
      .filter((a) => !q || `${a.name} ${a.namespace} ${a.partOf ?? ""} ${a.workloads.map((w) => w.metadata.name).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
  }, [data.data, search]);

  if (data.error) return <div className="p-2"><ErrorBox error={data.error} /><Button className="mx-3" onClick={data.reload}><RefreshCw className="size-3.5" />Retry</Button></div>;
  if (!data.data) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const cols = "minmax(220px,2fr) minmax(110px,1fr) 90px minmax(90px,0.8fr) 90px 70px 90px";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 grid h-7 items-center gap-x-3 border-b border-line bg-panel px-3 text-[11px] font-semibold tracking-wide text-muted uppercase" style={{ gridTemplateColumns: cols }}>
          <span>Application</span><span>Namespace</span><span>Version</span><span>Managed by</span><span className="text-right">Pods</span><span className="text-right">Age</span><span>Status</span>
        </div>
        {apps.map((a) => {
          const healthy = a.ready >= a.desired;
          const expanded = !!open[a.key];
          return (
            <div key={a.key} className="border-b border-line/40">
              <button
                onClick={() => setOpen((s) => ({ ...s, [a.key]: !expanded }))}
                className="grid h-8 w-full items-center gap-x-3 px-3 text-left text-[12.5px] hover:bg-hover"
                style={{ gridTemplateColumns: cols }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight className={clsx("size-3.5 shrink-0 text-faint transition-transform", expanded && "rotate-90")} />
                  <span className="truncate font-medium">{a.name}</span>
                  <span className="shrink-0 text-[11px] text-faint">{a.workloads.length}</span>
                </span>
                <span className="truncate text-muted">{a.namespace}</span>
                <span className="truncate font-mono text-[11px] text-muted">{a.version ?? "—"}</span>
                <span className="truncate text-muted">{a.managedBy ?? "—"}</span>
                <span className={clsx("text-right tabular-nums", healthy ? "text-fg" : "text-warn")}>{a.ready}/{a.desired}</span>
                <span className="text-right tabular-nums text-muted">{Number.isFinite(a.created) ? age(a.created, now) : "—"}</span>
                <span>{a.desired === 0 ? <Badge>Stopped</Badge> : healthy ? <Badge tone="ok">Healthy</Badge> : <Badge tone="warn">Degraded</Badge>}</span>
              </button>
              {expanded && a.workloads.map((w) => {
                const k = kindKeyFor(w.kind);
                const [r, d] = readiness(w);
                return (
                  <div
                    key={w.metadata.uid}
                    onClick={() => onSelect(k, w)}
                    onContextMenu={(e) => menu.show(e, menuFor(k, w))}
                    className="grid h-7 cursor-default items-center gap-x-3 bg-app/40 px-3 text-[12px] hover:bg-hover"
                    style={{ gridTemplateColumns: cols }}
                  >
                    <span className="flex min-w-0 items-center gap-2 pl-6">
                      <span className="shrink-0 text-[11px] text-muted">{w.kind}</span>
                      <span className="truncate">{w.metadata.name}</span>
                    </span>
                    <span />
                    <span />
                    <span />
                    <span className={clsx("text-right tabular-nums", r >= d ? "text-muted" : "text-warn")}>{w.kind === "CronJob" ? `${r} active` : `${r}/${d}`}</span>
                    <span className="text-right tabular-nums text-muted">{age(ts(w.metadata.creationTimestamp), now)}</span>
                    <span className="flex justify-end">
                      <button
                        title="Actions"
                        onClick={(e) => { e.stopPropagation(); const rc = e.currentTarget.getBoundingClientRect(); menu.show({ clientX: rc.right - 192, clientY: rc.bottom + 2 }, menuFor(k, w)); }}
                        className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
                      >
                        <EllipsisVertical className="size-4" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {apps.length === 0 && <div className="p-6 text-center text-xs text-muted">No applications{search ? ` matching “${search}”` : ""}.</div>}
      </div>
      <div className="flex h-6 shrink-0 items-center border-t border-line px-3 text-[11px] text-muted">
        {apps.length} application{apps.length === 1 ? "" : "s"} · grouped by app.kubernetes.io/instance, app.kubernetes.io/name or app labels
      </div>
      {menu.element}
    </div>
  );
}
