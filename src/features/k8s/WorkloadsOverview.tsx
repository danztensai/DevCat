// Workloads → Overview: status counts per workload kind (Lens style).
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { Button, ErrorBox, Spinner } from "../../components/ui";
import { k8s, type K8sObject } from "./api";
import { podStatus } from "./format";
import { useAsync } from "./hooks";
import { KINDS } from "./resources";

type Bucket = "ok" | "warn" | "danger" | "idle";
const BUCKETS: { id: Bucket; color: string }[] = [
  { id: "ok", color: "var(--color-ok)" },
  { id: "warn", color: "var(--color-warn)" },
  { id: "danger", color: "var(--color-danger)" },
  { id: "idle", color: "var(--color-faint)" },
];

/** Classify an object of a workload kind into a status bucket + label. */
function classify(kind: string, o: K8sObject): [Bucket, string] {
  const s = o.status ?? {};
  const spec = o.spec ?? {};
  switch (kind) {
    case "pods": {
      const st = podStatus(o);
      if (st.text === "Running") return ["ok", "Running"];
      if (st.text === "Completed" || st.text === "Succeeded") return ["idle", "Succeeded"];
      if (st.tone === "danger") return ["danger", "Failed"];
      return ["warn", "Pending"];
    }
    case "deployments":
    case "statefulsets":
    case "replicasets": {
      const want = spec.replicas ?? 0;
      if (want === 0) return ["idle", "Scaled to 0"];
      return (s.readyReplicas ?? 0) >= want ? ["ok", "Ready"] : (s.readyReplicas ?? 0) > 0 ? ["warn", "Progressing"] : ["danger", "Unavailable"];
    }
    case "daemonsets": {
      const want = s.desiredNumberScheduled ?? 0;
      if (want === 0) return ["idle", "No nodes"];
      return (s.numberReady ?? 0) >= want ? ["ok", "Ready"] : ["warn", "Progressing"];
    }
    case "jobs":
      if (s.succeeded >= (spec.completions ?? 1)) return ["ok", "Succeeded"];
      if ((s.failed ?? 0) > 0 && !s.active) return ["danger", "Failed"];
      return ["warn", "Running"];
    case "cronjobs":
      return spec.suspend ? ["idle", "Suspended"] : (s.active?.length ? ["warn", "Running"] : ["ok", "Scheduled"]);
    default:
      return ["idle", "Unknown"];
  }
}

const ORDER = ["pods", "deployments", "daemonsets", "statefulsets", "replicasets", "jobs", "cronjobs"];

export default function WorkloadsOverview({ connId, namespaces, onNavigate }: {
  connId: string;
  namespaces: string[];
  onNavigate: (kind: string) => void;
}) {
  const nsKey = namespaces.join(",");
  const data = useAsync(async () => {
    const one = namespaces.length === 1 ? namespaces[0] : null;
    const lists = await Promise.all(ORDER.map((k) => k8s.list(connId, k, one).catch(() => [] as K8sObject[])));
    return lists.map((items) => (namespaces.length > 1 ? items.filter((o) => namespaces.includes(o.metadata.namespace ?? "")) : items));
  }, [connId, nsKey], 15000);

  if (data.error) return <div className="p-2"><ErrorBox error={data.error} /><Button className="mx-3" onClick={data.reload}><RefreshCw className="size-3.5" />Retry</Button></div>;
  if (!data.data) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {ORDER.map((kind, i) => {
          const items = data.data![i];
          const counts = new Map<string, { bucket: Bucket; n: number }>();
          for (const o of items) {
            const [bucket, label] = classify(kind, o);
            const c = counts.get(label) ?? { bucket, n: 0 };
            c.n++;
            counts.set(label, c);
          }
          const rows = [...counts.entries()].sort((a, b) => BUCKETS.findIndex((x) => x.id === a[1].bucket) - BUCKETS.findIndex((x) => x.id === b[1].bucket));
          return (
            <button
              key={kind}
              onClick={() => onNavigate(kind)}
              className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4 text-left hover:border-accent/50 hover:bg-raised"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{KINDS[kind].title}</span>
                <span className="text-2xl font-semibold tabular-nums">{items.length}</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-hover">
                {rows.map(([label, c]) => (
                  <div key={label} style={{ width: `${(c.n / Math.max(items.length, 1)) * 100}%`, background: BUCKETS.find((b) => b.id === c.bucket)!.color }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                {rows.length === 0 && <span className="text-faint">None</span>}
                {rows.map(([label, c]) => (
                  <span key={label} className={clsx("flex items-center gap-1.5", c.bucket === "danger" ? "text-danger" : "text-muted")}>
                    <span className="size-2 rounded-full" style={{ background: BUCKETS.find((b) => b.id === c.bucket)!.color }} />
                    {label} <b className="font-semibold text-fg tabular-nums">{c.n}</b>
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
