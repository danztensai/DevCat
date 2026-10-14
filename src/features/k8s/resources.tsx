// Kind registry: navigation structure + per-kind table columns.
import clsx from "clsx";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui";
import type { K8sObject, UsageItem } from "./api";
import {
  age, eventTime, fmtBytes, fmtCpu, labelSelectorString, nodeRoles, nodeStatus, parseQty, podContainers,
  podStatus, selectorString, statusTone, ts, type Tone,
} from "./format";

export interface CellCtx {
  now: number;
  /** pod metrics keyed by "ns/name", node metrics keyed by name */
  metrics: Map<string, UsageItem> | null;
}

export interface Column {
  id: string;
  header: string;
  /** CSS grid track size, e.g. "minmax(220px,2fr)" or "90px" */
  width: string;
  /** Sort key */
  value: (o: K8sObject, c: CellCtx) => string | number;
  render?: (o: K8sObject, c: CellCtx) => ReactNode;
  align?: "right";
  /** Text used for search (defaults to value) */
  search?: boolean;
}

export interface KindDef {
  key: string;
  title: string;
  namespaced: boolean;
  columns: Column[];
}

// ---- reusable columns -------------------------------------------------------

const nameCol: Column = {
  id: "name", header: "Name", width: "minmax(200px,3fr)", search: true,
  value: (o) => o.metadata.name,
  render: (o) => <span className="truncate font-medium text-fg" title={o.metadata.name}>{o.metadata.name}</span>,
};
const nsCol: Column = {
  id: "namespace", header: "Namespace", width: "minmax(100px,1fr)", search: true,
  value: (o) => o.metadata.namespace ?? "",
  render: (o) => <span className="truncate text-muted">{o.metadata.namespace}</span>,
};
const ageCol: Column = {
  id: "age", header: "Age", width: "64px", align: "right",
  value: (o) => -ts(o.metadata.creationTimestamp),
  render: (o, c) => <span className="text-muted tabular-nums">{age(ts(o.metadata.creationTimestamp), c.now)}</span>,
};

export function StatusText({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={clsx("truncate", {
      "text-ok": tone === "ok", "text-warn": tone === "warn", "text-danger": tone === "danger",
      "text-info": tone === "info", "text-muted": tone === "default",
    })} title={text}>{text}</span>
  );
}

function text(id: string, header: string, width: string, get: (o: K8sObject) => string | number | undefined | null, opts: Partial<Column> = {}): Column {
  return {
    id, header, width,
    value: (o) => get(o) ?? "",
    render: (o) => { const v = get(o); return <span className="truncate" title={String(v ?? "")}>{v ?? "—"}</span>; },
    ...opts,
  };
}

function num(id: string, header: string, get: (o: K8sObject) => number | undefined | null, width = "72px"): Column {
  return { id, header, width, align: "right", value: (o) => get(o) ?? 0, render: (o) => <span className="tabular-nums">{get(o) ?? 0}</span> };
}

function ratio(id: string, header: string, get: (o: K8sObject) => [number, number], width = "72px"): Column {
  return {
    id, header, width, align: "right",
    value: (o) => { const [a, b] = get(o); return b ? a / b : a; },
    render: (o) => {
      const [a, b] = get(o);
      return <span className={clsx("tabular-nums", a < b ? "text-warn" : "text-fg")}>{a}/{b}</span>;
    },
  };
}

function statusCol(get: (o: K8sObject) => { text: string; tone: Tone }, width = "minmax(90px,1fr)"): Column {
  return { id: "status", header: "Status", width, search: true, value: (o) => get(o).text, render: (o) => <StatusText {...get(o)} /> };
}

/** Bar meter used for CPU / memory columns. */
function Meter({ value, max, label }: { value: number; max?: number; label: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex w-full items-center gap-1.5" title={max ? `${label} (${pct.toFixed(0)}%)` : label}>
      <span className="w-12 shrink-0 text-right tabular-nums">{label}</span>
      {max ? (
        <div className="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-hover">
          <div className={clsx("h-full rounded-full", pct > 90 ? "bg-danger" : pct > 75 ? "bg-warn" : "bg-info")} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function ContainerDots({ p }: { p: K8sObject }) {
  const statuses: K8sObject[] = p.status?.containerStatuses ?? [];
  const specs: K8sObject[] = p.spec?.containers ?? [];
  return (
    <span className="flex flex-wrap gap-0.5">
      {specs.map((c) => {
        const s = statuses.find((x) => x.name === c.name);
        const tone = s?.ready ? "bg-ok" : s?.state?.terminated ? (s.state.terminated.exitCode === 0 ? "bg-faint" : "bg-danger") : s?.state?.waiting ? (/Err|BackOff|Crash/.test(s.state.waiting.reason ?? "") ? "bg-danger" : "bg-warn") : "bg-warn";
        const state = s ? Object.keys(s.state ?? {})[0] : "pending";
        const reason = s?.state?.waiting?.reason ?? s?.state?.terminated?.reason ?? "";
        return <span key={c.name} className={clsx("size-2 rounded-sm", tone)} title={`${c.name}: ${state}${reason ? ` (${reason})` : ""}`} />;
      })}
    </span>
  );
}

function ownerKind(o: K8sObject) {
  const ref = o.metadata.ownerReferences?.find((r) => r.controller) ?? o.metadata.ownerReferences?.[0];
  return ref ? ref.kind : "";
}

// ---- kind definitions --------------------------------------------------------

const POD_COLUMNS: Column[] = [
  nameCol, nsCol,
  { id: "containers", header: "Containers", width: "84px", value: (o) => podContainers(o).ready, render: (o) => <ContainerDots p={o} /> },
  {
    id: "restarts", header: "Restarts", width: "70px", align: "right", value: (o) => podContainers(o).restarts,
    render: (o, c) => {
      const { restarts, lastRestart } = podContainers(o);
      return <span className={clsx("tabular-nums", restarts > 0 && "text-warn")} title={lastRestart ? `last ${age(lastRestart, c.now)} ago` : undefined}>{restarts}</span>;
    },
  },
  {
    id: "cpu", header: "CPU", width: "70px", align: "right",
    value: (o, c) => c.metrics?.get(`${o.metadata.namespace}/${o.metadata.name}`)?.cpu ?? -1,
    render: (o, c) => <span className="tabular-nums text-muted">{fmtCpu(c.metrics?.get(`${o.metadata.namespace}/${o.metadata.name}`)?.cpu)}</span>,
  },
  {
    id: "memory", header: "Memory", width: "72px", align: "right",
    value: (o, c) => c.metrics?.get(`${o.metadata.namespace}/${o.metadata.name}`)?.memory ?? -1,
    render: (o, c) => <span className="tabular-nums text-muted">{fmtBytes(c.metrics?.get(`${o.metadata.namespace}/${o.metadata.name}`)?.memory)}</span>,
  },
  text("owner", "Controlled By", "minmax(80px,0.8fr)", ownerKind),
  text("node", "Node", "minmax(100px,1.2fr)", (o) => o.spec?.nodeName, { search: true }),
  text("qos", "QoS", "84px", (o) => o.status?.qosClass),
  ageCol,
  statusCol(podStatus, "minmax(110px,1fr)"),
];

function workloadStatus(o: K8sObject): { text: string; tone: Tone } {
  const want = o.spec?.replicas ?? 1;
  const ready = o.status?.readyReplicas ?? 0;
  const cond: K8sObject[] = o.status?.conditions ?? [];
  if (cond.some((c) => c.type === "ReplicaFailure" && c.status === "True")) return { text: "ReplicaFailure", tone: "danger" };
  if (want === 0) return { text: "Scaled to 0", tone: "default" };
  if (ready >= want) return { text: "Running", tone: "ok" };
  if (cond.some((c) => c.type === "Progressing" && c.status === "False")) return { text: "Stalled", tone: "danger" };
  return { text: "Updating", tone: "warn" };
}

function jobStatus(o: K8sObject): { text: string; tone: Tone } {
  const cond: K8sObject[] = o.status?.conditions ?? [];
  if (cond.some((c) => c.type === "Failed" && c.status === "True")) return { text: "Failed", tone: "danger" };
  if (cond.some((c) => c.type === "Complete" && c.status === "True")) return { text: "Complete", tone: "info" };
  if (cond.some((c) => c.type === "Suspended" && c.status === "True")) return { text: "Suspended", tone: "warn" };
  return { text: "Running", tone: "ok" };
}

function svcPorts(o: K8sObject) {
  return (o.spec?.ports ?? []).map((p: K8sObject) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol ?? "TCP"}`).join(", ");
}

function svcExternal(o: K8sObject) {
  const ing = (o.status?.loadBalancer?.ingress ?? []).map((i: K8sObject) => i.ip || i.hostname);
  return [...ing, ...(o.spec?.externalIPs ?? [])].join(", ") || (o.spec?.type === "ExternalName" ? o.spec?.externalName : "");
}

const keysCount = (o: K8sObject) => Object.keys(o.data ?? {}).length + Object.keys(o.binaryData ?? {}).length;

const nodeCpu = (o: K8sObject, c: CellCtx) => c.metrics?.get(o.metadata.name)?.cpu;
const nodeMem = (o: K8sObject, c: CellCtx) => c.metrics?.get(o.metadata.name)?.memory;

export const KINDS: Record<string, KindDef> = {
  pods: { key: "pods", title: "Pods", namespaced: true, columns: POD_COLUMNS },
  deployments: {
    key: "deployments", title: "Deployments", namespaced: true, columns: [
      nameCol, nsCol,
      ratio("pods", "Pods", (o) => [o.status?.readyReplicas ?? 0, o.spec?.replicas ?? 0]),
      num("replicas", "Replicas", (o) => o.spec?.replicas),
      num("uptodate", "Up-to-date", (o) => o.status?.updatedReplicas, "84px"),
      num("available", "Available", (o) => o.status?.availableReplicas, "78px"),
      ageCol, statusCol(workloadStatus),
    ],
  },
  statefulsets: {
    key: "statefulsets", title: "StatefulSets", namespaced: true, columns: [
      nameCol, nsCol,
      ratio("pods", "Pods", (o) => [o.status?.readyReplicas ?? 0, o.spec?.replicas ?? 0]),
      num("replicas", "Replicas", (o) => o.spec?.replicas),
      text("service", "Service", "minmax(80px,1fr)", (o) => o.spec?.serviceName),
      ageCol, statusCol(workloadStatus),
    ],
  },
  daemonsets: {
    key: "daemonsets", title: "DaemonSets", namespaced: true, columns: [
      nameCol, nsCol,
      num("desired", "Desired", (o) => o.status?.desiredNumberScheduled),
      num("current", "Current", (o) => o.status?.currentNumberScheduled),
      ratio("ready", "Ready", (o) => [o.status?.numberReady ?? 0, o.status?.desiredNumberScheduled ?? 0]),
      num("uptodate", "Up-to-date", (o) => o.status?.updatedNumberScheduled, "84px"),
      num("available", "Available", (o) => o.status?.numberAvailable, "78px"),
      text("selector", "Node Selector", "minmax(100px,1fr)", (o) => selectorString(o.spec?.template?.spec?.nodeSelector)),
      ageCol,
    ],
  },
  replicasets: {
    key: "replicasets", title: "ReplicaSets", namespaced: true, columns: [
      nameCol, nsCol,
      num("desired", "Desired", (o) => o.spec?.replicas),
      num("current", "Current", (o) => o.status?.replicas),
      ratio("ready", "Ready", (o) => [o.status?.readyReplicas ?? 0, o.spec?.replicas ?? 0]),
      text("owner", "Controlled By", "minmax(90px,1fr)", ownerKind),
      ageCol,
    ],
  },
  jobs: {
    key: "jobs", title: "Jobs", namespaced: true, columns: [
      nameCol, nsCol,
      ratio("completions", "Completions", (o) => [o.status?.succeeded ?? 0, o.spec?.completions ?? 1], "90px"),
      {
        id: "duration", header: "Duration", width: "76px", align: "right",
        value: (o) => (ts(o.status?.completionTime) || Date.now()) - ts(o.status?.startTime),
        render: (o, c) => <span className="tabular-nums text-muted">{o.status?.startTime ? age(ts(o.status.startTime), ts(o.status?.completionTime) || c.now) : "—"}</span>,
      },
      text("owner", "Controlled By", "minmax(80px,1fr)", ownerKind),
      ageCol, statusCol(jobStatus),
    ],
  },
  cronjobs: {
    key: "cronjobs", title: "CronJobs", namespaced: true, columns: [
      nameCol, nsCol,
      text("schedule", "Schedule", "minmax(90px,1fr)", (o) => o.spec?.schedule, { render: (o) => <span className="truncate font-mono text-xs">{o.spec?.schedule}</span> }),
      { id: "suspend", header: "Suspend", width: "70px", value: (o) => (o.spec?.suspend ? 1 : 0), render: (o) => o.spec?.suspend ? <Badge tone="warn">Yes</Badge> : <span className="text-muted">No</span> },
      num("active", "Active", (o) => (o.status?.active ?? []).length, "60px"),
      {
        id: "last", header: "Last Schedule", width: "96px", align: "right",
        value: (o) => -ts(o.status?.lastScheduleTime),
        render: (o, c) => <span className="tabular-nums text-muted">{o.status?.lastScheduleTime ? `${age(ts(o.status.lastScheduleTime), c.now)} ago` : "—"}</span>,
      },
      ageCol,
    ],
  },
  services: {
    key: "services", title: "Services", namespaced: true, columns: [
      nameCol, nsCol,
      text("type", "Type", "96px", (o) => o.spec?.type),
      text("clusterIP", "Cluster IP", "minmax(96px,0.8fr)", (o) => o.spec?.clusterIP, { search: true }),
      text("ports", "Ports", "minmax(110px,1.2fr)", svcPorts, { search: true }),
      text("external", "External IP", "minmax(90px,0.8fr)", svcExternal),
      text("selector", "Selector", "minmax(100px,1.2fr)", (o) => selectorString(o.spec?.selector)),
      ageCol,
    ],
  },
  endpoints: {
    key: "endpoints", title: "Endpoints", namespaced: true, columns: [
      nameCol, nsCol,
      text("endpoints", "Endpoints", "minmax(200px,3fr)", (o) => (o.subsets ?? []).flatMap((s: K8sObject) => (s.addresses ?? []).flatMap((a: K8sObject) => (s.ports ?? []).map((p: K8sObject) => `${a.ip}:${p.port}`))).join(", ")),
      ageCol,
    ],
  },
  ingresses: {
    key: "ingresses", title: "Ingresses", namespaced: true, columns: [
      nameCol, nsCol,
      text("class", "Class", "96px", (o) => o.spec?.ingressClassName ?? o.metadata.annotations?.["kubernetes.io/ingress.class"]),
      text("hosts", "Hosts", "minmax(140px,2fr)", (o) => (o.spec?.rules ?? []).map((r: K8sObject) => r.host ?? "*").join(", "), { search: true }),
      text("address", "Address", "minmax(90px,1fr)", (o) => (o.status?.loadBalancer?.ingress ?? []).map((i: K8sObject) => i.ip || i.hostname).join(", ")),
      text("ports", "Ports", "64px", (o) => (o.spec?.tls?.length ? "80, 443" : "80")),
      ageCol,
    ],
  },
  ingressclasses: { key: "ingressclasses", title: "Ingress Classes", namespaced: false, columns: [nameCol, text("controller", "Controller", "minmax(160px,2fr)", (o) => o.spec?.controller), ageCol] },
  networkpolicies: {
    key: "networkpolicies", title: "Network Policies", namespaced: true, columns: [
      nameCol, nsCol,
      text("selector", "Pod Selector", "minmax(140px,2fr)", (o) => labelSelectorString(o.spec?.podSelector) || "<all>"),
      text("types", "Policy Types", "120px", (o) => (o.spec?.policyTypes ?? []).join(", ")),
      ageCol,
    ],
  },
  configmaps: {
    key: "configmaps", title: "ConfigMaps", namespaced: true, columns: [
      nameCol, nsCol,
      text("keys", "Keys", "minmax(160px,2fr)", (o) => Object.keys({ ...(o.data ?? {}), ...(o.binaryData ?? {}) }).join(", ")),
      num("count", "#", keysCount, "48px"),
      ageCol,
    ],
  },
  secrets: {
    key: "secrets", title: "Secrets", namespaced: true, columns: [
      nameCol, nsCol,
      text("type", "Type", "minmax(140px,1.4fr)", (o) => o.type),
      text("keys", "Keys", "minmax(140px,1.6fr)", (o) => Object.keys(o.data ?? {}).join(", ")),
      num("count", "#", keysCount, "48px"),
      ageCol,
    ],
  },
  resourcequotas: { key: "resourcequotas", title: "Resource Quotas", namespaced: true, columns: [nameCol, nsCol, text("hard", "Hard", "minmax(200px,3fr)", (o) => Object.entries(o.status?.hard ?? o.spec?.hard ?? {}).map(([k, v]) => `${k}: ${o.status?.used?.[k] ?? "0"}/${v}`).join(", ")), ageCol] },
  limitranges: { key: "limitranges", title: "Limit Ranges", namespaced: true, columns: [nameCol, nsCol, ageCol] },
  horizontalpodautoscalers: {
    key: "horizontalpodautoscalers", title: "HPAs", namespaced: true, columns: [
      nameCol, nsCol,
      text("ref", "Reference", "minmax(130px,1.4fr)", (o) => `${o.spec?.scaleTargetRef?.kind}/${o.spec?.scaleTargetRef?.name}`),
      text("metrics", "Targets", "minmax(130px,1.4fr)", (o) => (o.spec?.metrics ?? []).map((m: K8sObject, i: number) => {
        const r = m.resource;
        const cur = o.status?.currentMetrics?.[i]?.resource?.current;
        if (r) return `${r.name}: ${cur?.averageUtilization ?? "?"}%/${r.target?.averageUtilization ?? r.target?.averageValue ?? "?"}${r.target?.averageUtilization != null ? "%" : ""}`;
        return m.type;
      }).join(", ")),
      num("min", "Min", (o) => o.spec?.minReplicas ?? 1, "48px"),
      num("max", "Max", (o) => o.spec?.maxReplicas, "48px"),
      num("replicas", "Replicas", (o) => o.status?.currentReplicas, "72px"),
      ageCol,
    ],
  },
  poddisruptionbudgets: {
    key: "poddisruptionbudgets", title: "Pod Disruption Budgets", namespaced: true, columns: [
      nameCol, nsCol,
      text("min", "Min Available", "100px", (o) => o.spec?.minAvailable),
      text("max", "Max Unavailable", "110px", (o) => o.spec?.maxUnavailable),
      num("allowed", "Allowed", (o) => o.status?.disruptionsAllowed),
      ageCol,
    ],
  },
  priorityclasses: { key: "priorityclasses", title: "Priority Classes", namespaced: false, columns: [nameCol, num("value", "Value", (o) => o.value, "110px"), text("default", "Global Default", "110px", (o) => (o.globalDefault ? "true" : "false")), ageCol] },
  persistentvolumeclaims: {
    key: "persistentvolumeclaims", title: "Persistent Volume Claims", namespaced: true, columns: [
      nameCol, nsCol,
      text("class", "Storage Class", "minmax(100px,1fr)", (o) => o.spec?.storageClassName),
      { id: "size", header: "Size", width: "70px", align: "right", value: (o) => parseQty(o.status?.capacity?.storage ?? o.spec?.resources?.requests?.storage), render: (o) => <span className="tabular-nums">{o.status?.capacity?.storage ?? o.spec?.resources?.requests?.storage}</span> },
      text("volume", "Volume", "minmax(120px,1.4fr)", (o) => o.spec?.volumeName),
      text("modes", "Access", "80px", (o) => (o.spec?.accessModes ?? []).map(shortMode).join(",")),
      ageCol, statusCol((o) => ({ text: o.status?.phase ?? "Unknown", tone: statusTone(o.status?.phase ?? "") })),
    ],
  },
  persistentvolumes: {
    key: "persistentvolumes", title: "Persistent Volumes", namespaced: false, columns: [
      nameCol,
      { id: "size", header: "Capacity", width: "76px", align: "right", value: (o) => parseQty(o.spec?.capacity?.storage), render: (o) => <span className="tabular-nums">{o.spec?.capacity?.storage}</span> },
      text("modes", "Access", "80px", (o) => (o.spec?.accessModes ?? []).map(shortMode).join(",")),
      text("reclaim", "Reclaim", "80px", (o) => o.spec?.persistentVolumeReclaimPolicy),
      text("claim", "Claim", "minmax(140px,1.6fr)", (o) => (o.spec?.claimRef ? `${o.spec.claimRef.namespace}/${o.spec.claimRef.name}` : ""), { search: true }),
      text("class", "Storage Class", "minmax(100px,1fr)", (o) => o.spec?.storageClassName),
      ageCol, statusCol((o) => ({ text: o.status?.phase ?? "Unknown", tone: statusTone(o.status?.phase ?? "") })),
    ],
  },
  storageclasses: {
    key: "storageclasses", title: "Storage Classes", namespaced: false, columns: [
      { ...nameCol, render: (o) => <span className="flex items-center gap-1.5 truncate font-medium">{o.metadata.name}{o.metadata.annotations?.["storageclass.kubernetes.io/is-default-class"] === "true" && <Badge tone="accent">default</Badge>}</span> },
      text("provisioner", "Provisioner", "minmax(160px,2fr)", (o) => o.provisioner),
      text("reclaim", "Reclaim", "80px", (o) => o.reclaimPolicy),
      text("binding", "Binding Mode", "140px", (o) => o.volumeBindingMode),
      ageCol,
    ],
  },
  nodes: {
    key: "nodes", title: "Nodes", namespaced: false, columns: [
      nameCol,
      {
        id: "cpu", header: "CPU", width: "minmax(110px,1fr)", value: (o, c) => (nodeCpu(o, c) ?? -1) / (parseQty(o.status?.allocatable?.cpu) || 1),
        render: (o, c) => { const u = nodeCpu(o, c); const max = parseQty(o.status?.allocatable?.cpu); return u == null ? <span className="text-muted tabular-nums">{fmtCpu(max)} cores</span> : <Meter value={u} max={max} label={fmtCpu(u)} />; },
      },
      {
        id: "memory", header: "Memory", width: "minmax(110px,1fr)", value: (o, c) => (nodeMem(o, c) ?? -1) / (parseQty(o.status?.allocatable?.memory) || 1),
        render: (o, c) => { const u = nodeMem(o, c); const max = parseQty(o.status?.allocatable?.memory); return u == null ? <span className="text-muted tabular-nums">{fmtBytes(max)}</span> : <Meter value={u} max={max} label={fmtBytes(u)} />; },
      },
      num("taints", "Taints", (o) => (o.spec?.taints ?? []).length, "56px"),
      text("roles", "Roles", "minmax(80px,0.8fr)", nodeRoles),
      text("version", "Version", "minmax(90px,0.8fr)", (o) => o.status?.nodeInfo?.kubeletVersion),
      text("ip", "Internal IP", "minmax(96px,0.8fr)", (o) => (o.status?.addresses ?? []).find((a: K8sObject) => a.type === "InternalIP")?.address, { search: true }),
      ageCol, statusCol(nodeStatus, "minmax(80px,1fr)"),
    ],
  },
  namespaces: {
    key: "namespaces", title: "Namespaces", namespaced: false, columns: [
      nameCol,
      text("labels", "Labels", "minmax(200px,3fr)", (o) => Object.entries(o.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")),
      ageCol, statusCol((o) => ({ text: o.status?.phase ?? "Active", tone: statusTone(o.status?.phase ?? "Active") }), "90px"),
    ],
  },
  events: {
    key: "events", title: "Events", namespaced: true, columns: [
      {
        id: "type", header: "Type", width: "72px", value: (o) => o.type,
        render: (o) => <StatusText text={o.type ?? ""} tone={o.type === "Warning" ? "warn" : "default"} />,
      },
      text("reason", "Reason", "minmax(90px,0.8fr)", (o) => o.reason, { search: true }),
      text("object", "Involved Object", "minmax(150px,1.4fr)", (o) => `${o.involvedObject?.kind}/${o.involvedObject?.name}`, { search: true }),
      nsCol,
      text("message", "Message", "minmax(220px,3fr)", (o) => o.message ?? o.note, { search: true, render: (o) => <span className="truncate text-muted" title={o.message}>{o.message ?? o.note}</span> }),
      text("source", "Source", "minmax(80px,0.7fr)", (o) => o.source?.component ?? o.reportingComponent),
      num("count", "Count", (o) => o.count ?? o.series?.count ?? 1, "56px"),
      {
        id: "last", header: "Last Seen", width: "76px", align: "right",
        value: (o) => -eventTime(o),
        render: (o, c) => <span className="tabular-nums text-muted">{age(eventTime(o), c.now)}</span>,
      },
    ],
  },
  serviceaccounts: { key: "serviceaccounts", title: "Service Accounts", namespaced: true, columns: [nameCol, nsCol, num("secrets", "Secrets", (o) => (o.secrets ?? []).length), ageCol] },
  roles: { key: "roles", title: "Roles", namespaced: true, columns: [nameCol, nsCol, num("rules", "Rules", (o) => (o.rules ?? []).length), ageCol] },
  clusterroles: { key: "clusterroles", title: "Cluster Roles", namespaced: false, columns: [nameCol, num("rules", "Rules", (o) => (o.rules ?? []).length), ageCol] },
  rolebindings: {
    key: "rolebindings", title: "Role Bindings", namespaced: true, columns: [
      nameCol, nsCol,
      text("role", "Role", "minmax(120px,1.2fr)", (o) => `${o.roleRef?.kind}/${o.roleRef?.name}`),
      text("subjects", "Subjects", "minmax(160px,2fr)", (o) => (o.subjects ?? []).map((s: K8sObject) => `${s.kind}:${s.name}`).join(", "), { search: true }),
      ageCol,
    ],
  },
  clusterrolebindings: {
    key: "clusterrolebindings", title: "Cluster Role Bindings", namespaced: false, columns: [
      nameCol,
      text("role", "Role", "minmax(120px,1.2fr)", (o) => `${o.roleRef?.kind}/${o.roleRef?.name}`),
      text("subjects", "Subjects", "minmax(160px,2fr)", (o) => (o.subjects ?? []).map((s: K8sObject) => `${s.kind}:${s.name}`).join(", "), { search: true }),
      ageCol,
    ],
  },
  customresourcedefinitions: {
    key: "customresourcedefinitions", title: "Custom Resource Definitions", namespaced: false, columns: [
      { ...nameCol, header: "Resource", value: (o) => o.spec?.names?.kind ?? o.metadata.name, render: (o) => <span className="truncate font-medium" title={o.metadata.name}>{o.spec?.names?.kind}</span> },
      text("group", "Group", "minmax(160px,2fr)", (o) => o.spec?.group, { search: true }),
      text("version", "Version", "90px", (o) => storedVersion(o)),
      text("scope", "Scope", "90px", (o) => o.spec?.scope),
      ageCol,
    ],
  },
};

function shortMode(m: string) {
  return ({ ReadWriteOnce: "RWO", ReadOnlyMany: "ROX", ReadWriteMany: "RWX", ReadWriteOncePod: "RWOP" } as Record<string, string>)[m] ?? m;
}

// ---- custom resources ---------------------------------------------------------

export function storedVersion(crd: K8sObject): string {
  const vs: K8sObject[] = crd.spec?.versions ?? [];
  return (vs.find((v) => v.storage) ?? vs.find((v) => v.served) ?? vs[0])?.name ?? "";
}

/** Backend kind key for a CRD's instances: "group/version/Kind". */
export function crdKindKey(crd: K8sObject): string {
  return `${crd.spec.group}/${storedVersion(crd)}/${crd.spec.names.kind}`;
}

/** Minimal JSONPath for additionalPrinterColumns (".status.phase", ".spec.items[0].name"). */
export function jsonPath(o: unknown, path: string): unknown {
  const parts = path.replace(/^\$?\./, "").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = o;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function crdKindDef(crd: K8sObject): KindDef {
  const version = (crd.spec?.versions ?? []).find((v: K8sObject) => v.name === storedVersion(crd));
  const printer: K8sObject[] = (version?.additionalPrinterColumns ?? crd.spec?.additionalPrinterColumns ?? [])
    .filter((c: K8sObject) => c.jsonPath !== ".metadata.creationTimestamp" && (c.priority ?? 0) === 0);
  const namespaced = crd.spec?.scope === "Namespaced";
  const cols: Column[] = [nameCol];
  if (namespaced) cols.push(nsCol);
  for (const p of printer.slice(0, 6)) {
    const get = (o: K8sObject) => {
      const v = jsonPath(o, p.jsonPath);
      if (v == null) return "";
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    };
    if (p.type === "date") {
      cols.push({
        id: `pc-${p.name}`, header: p.name, width: "80px", align: "right",
        value: (o) => -ts(get(o)),
        render: (o, c) => <span className="tabular-nums text-muted">{age(ts(get(o)), c.now)}</span>,
      });
    } else if (p.type === "integer" || p.type === "number") {
      cols.push({ id: `pc-${p.name}`, header: p.name, width: "80px", align: "right", value: (o) => Number(get(o)) || 0, render: (o) => <span className="tabular-nums">{get(o)}</span> });
    } else {
      const status = /status|ready|phase|state/i.test(p.name);
      cols.push({
        id: `pc-${p.name}`, header: p.name, width: "minmax(80px,1fr)", value: get, search: true,
        render: status ? (o) => <StatusText text={get(o)} tone={statusTone(get(o))} /> : (o) => <span className="truncate" title={get(o)}>{get(o)}</span>,
      });
    }
  }
  cols.push(ageCol);
  return { key: crdKindKey(crd), title: crd.spec?.names?.kind ?? crd.metadata.name, namespaced, columns: cols };
}

export function genericKindDef(key: string, namespaced = true): KindDef {
  return { key, title: key.split("/").pop() ?? key, namespaced, columns: namespaced ? [nameCol, nsCol, ageCol] : [nameCol, ageCol] };
}

// ---- navigation ------------------------------------------------------------------

export type View =
  | { type: "overview" }
  | { type: "list"; kind: string }
  | { type: "portforwards" };

export interface NavGroup { id: string; title: string; items: { label: string; view: View }[] }

const list = (kind: string, label = KINDS[kind].title): { label: string; view: View } => ({ label, view: { type: "list", kind } });

export const NAV: NavGroup[] = [
  { id: "workloads", title: "Workloads", items: [list("pods"), list("deployments"), list("daemonsets"), list("statefulsets"), list("replicasets"), list("jobs"), list("cronjobs")] },
  { id: "config", title: "Config", items: [list("configmaps"), list("secrets"), list("resourcequotas"), list("limitranges"), list("horizontalpodautoscalers"), list("poddisruptionbudgets"), list("priorityclasses")] },
  { id: "network", title: "Network", items: [list("services"), list("endpoints"), list("ingresses"), list("ingressclasses"), list("networkpolicies"), { label: "Port Forwarding", view: { type: "portforwards" } }] },
  { id: "storage", title: "Storage", items: [list("persistentvolumeclaims"), list("persistentvolumes"), list("storageclasses")] },
  { id: "access", title: "Access Control", items: [list("serviceaccounts"), list("clusterroles"), list("roles"), list("clusterrolebindings"), list("rolebindings")] },
];

/** Maps an ownerReference / involvedObject Kind to a list key. */
export function kindKeyFor(kind: string, apiVersion?: string): string {
  const k = Object.values(KINDS).find((d) => d.key !== "customresourcedefinitions" && kindName(d.key) === kind);
  if (k) return k.key;
  return apiVersion ? `${apiVersion}/${kind}` : kind;
}

const KIND_NAMES: Record<string, string> = {
  pods: "Pod", deployments: "Deployment", statefulsets: "StatefulSet", daemonsets: "DaemonSet", replicasets: "ReplicaSet",
  jobs: "Job", cronjobs: "CronJob", services: "Service", endpoints: "Endpoints", ingresses: "Ingress", ingressclasses: "IngressClass",
  networkpolicies: "NetworkPolicy", configmaps: "ConfigMap", secrets: "Secret", resourcequotas: "ResourceQuota", limitranges: "LimitRange",
  horizontalpodautoscalers: "HorizontalPodAutoscaler", poddisruptionbudgets: "PodDisruptionBudget", priorityclasses: "PriorityClass",
  persistentvolumeclaims: "PersistentVolumeClaim", persistentvolumes: "PersistentVolume", storageclasses: "StorageClass",
  nodes: "Node", namespaces: "Namespace", events: "Event", serviceaccounts: "ServiceAccount", roles: "Role", clusterroles: "ClusterRole",
  rolebindings: "RoleBinding", clusterrolebindings: "ClusterRoleBinding", customresourcedefinitions: "CustomResourceDefinition",
};

export function kindName(key: string): string {
  return KIND_NAMES[key] ?? key.split("/").pop() ?? key;
}
