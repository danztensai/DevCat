// Kubernetes port-forward: which DevCat Kubernetes connection (kubeconfig + context) to use and
// the services / pods to forward. Namespaces and names are suggested from the cluster.
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, Input, Select } from "../../components/ui";
import type { NetProfile, NetStatus, PortForward } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { useUi } from "../../store/ui";
import { k8s, type K8sObject } from "../k8s/api";
import { Row } from "../connections/dialog/formBits";
import { SectionTitle } from "./formBits";

export const K8S_CONN_OPTION = "k8sConnId";
export const emptyK8sForward = (): PortForward => ({ kind: "service", bindPort: 0, remoteHost: "", remotePort: 0, namespace: "" });

const num = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n <= 65535 ? n : 0; };

export function k8sForwardLabel(f: PortForward, bound?: number): string {
  const kind = f.kind === "pod" ? "pod" : "svc";
  return `127.0.0.1:${bound || f.bindPort || "auto"} → ${kind}/${f.remoteHost || "?"}:${f.remotePort || "?"} (${f.namespace || "default namespace"})`;
}

/** Services / pods in a namespace, for the name suggestions (cached per connection+kind+ns). */
function useTargets(connId: string, kind: "services" | "pods", ns: string) {
  const [items, setItems] = useState<K8sObject[]>([]);
  useEffect(() => {
    let live = true;
    if (!connId || !ns) { setItems([]); return; }
    k8s.list(connId, kind, ns).then((l) => live && setItems(l)).catch(() => live && setItems([]));
    return () => { live = false; };
  }, [connId, kind, ns]);
  return items;
}

function ForwardRow({ f, i, connId, namespaces, bound, set, remove }: {
  f: PortForward; i: number; connId: string; namespaces: string[]; bound?: number;
  set: (patch: Partial<PortForward>) => void; remove: () => void;
}) {
  const kind = f.kind === "pod" ? "pods" : "services";
  const targets = useTargets(connId, kind, f.namespace ?? "");
  const listId = `k8s-targets-${i}`;
  // Picking a known service fills in its first port.
  const pick = (name: string) => {
    const t = targets.find((x) => x.metadata.name === name);
    const port = kind === "services"
      ? t?.spec?.ports?.[0]?.port
      : t?.spec?.containers?.flatMap((c: { ports?: { containerPort: number }[] }) => c.ports ?? [])?.[0]?.containerPort;
    set({ remoteHost: name, ...(port && !f.remotePort ? { remotePort: port } : {}) });
  };
  return (
    <div className="border-b border-line/50 px-2 py-1.5 last:border-0">
      <div className="grid grid-cols-[96px_150px_1fr_72px_16px_80px_28px] items-center gap-1.5">
        <Select value={f.kind === "pod" ? "pod" : "service"} onChange={(e) => set({ kind: e.target.value as PortForward["kind"] })}>
          <option value="service">Service</option>
          <option value="pod">Pod</option>
        </Select>
        {namespaces.length ? (
          <Select value={f.namespace ?? ""} onChange={(e) => set({ namespace: e.target.value })}>
            <option value="">(default)</option>
            {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        ) : (
          <Input className="font-mono text-xs!" value={f.namespace ?? ""} placeholder="namespace" onChange={(e) => set({ namespace: e.target.value.trim() })} />
        )}
        <Input className="font-mono text-xs!" list={listId} value={f.remoteHost} placeholder={kind === "services" ? "postgres-prod-rw" : "pod name"}
          onChange={(e) => pick(e.target.value.trim())} />
        <datalist id={listId}>{targets.map((t) => <option key={t.metadata.name} value={t.metadata.name} />)}</datalist>
        <Input inputMode="numeric" className="font-mono text-xs!" value={f.remotePort || ""} placeholder="5432"
          onChange={(e) => set({ remotePort: num(e.target.value) })} />
        <ArrowRight className="size-3.5 text-faint" />
        <Input inputMode="numeric" className="font-mono text-xs!" value={f.bindPort || ""} placeholder="auto"
          onChange={(e) => set({ bindPort: num(e.target.value) })} />
        <IconButton type="button" title="Remove forward" onClick={remove}><Trash2 className="size-3.5" /></IconButton>
      </div>
      <div className={`mt-1 pl-1 font-mono text-[11px] ${bound ? "text-ok" : "text-faint"}`}>{k8sForwardLabel(f, bound)}</div>
    </div>
  );
}

export function K8sForwardEditor({ p, set, status }: { p: NetProfile; set: (patch: Partial<NetProfile>) => void; status: NetStatus | null }) {
  const connections = useConnections((s) => s.connections);
  const clusters = useMemo(() => connections.filter((c) => c.kind === "kubernetes"), [connections]);
  const connId = p.options[K8S_CONN_OPTION] ?? "";
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [nsError, setNsError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setNamespaces([]);
    setNsError(null);
    if (!connId) return;
    k8s.namespaces(connId).then((n) => live && setNamespaces(n)).catch((e) => live && setNsError(String(e)));
    return () => { live = false; };
  }, [connId]);

  const forwards = p.forwards;
  const setFwd = (i: number, patch: Partial<PortForward>) => set({ forwards: forwards.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const bound = status?.state === "connected" ? status.localPorts : [];

  return (
    <>
      <SectionTitle>Cluster</SectionTitle>
      <Row label="Kubernetes connection" hint="Its kubeconfig and context are used to reach the cluster.">
        {clusters.length ? (
          <Select value={connId} onChange={(e) => set({ options: { ...p.options, [K8S_CONN_OPTION]: e.target.value } })}>
            <option value="" disabled>Pick a connection…</option>
            {clusters.map((c) => <option key={c.id} value={c.id}>{c.name}{c.options?.context ? ` (${c.options.context})` : ""}</option>)}
          </Select>
        ) : (
          <div className="text-[12px] text-muted">
            No Kubernetes connections yet.{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => useUi.getState().openConnectionDialog(null, "kubernetes")}>Add one</button>, then pick it here.
          </div>
        )}
      </Row>
      {nsError && <div className="truncate text-[11px] text-warn" title={nsError}>Couldn't list namespaces ({nsError}). You can still type them.</div>}

      <SectionTitle right={<Button type="button" size="sm" variant="ghost" onClick={() => set({ forwards: [...forwards, emptyK8sForward()] })}><Plus className="size-3" />Add forward</Button>}>
        Forwards
      </SectionTitle>
      {forwards.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-3 py-3 text-center text-[12px] text-muted">
          No forwards yet.{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => set({ forwards: [emptyK8sForward()] })}>Add one</button>
          {" "}— e.g. service postgres-prod-rw:5432 in namespace database → local port 6543.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-line">
          <div className="grid grid-cols-[96px_150px_1fr_72px_16px_80px_28px] items-center gap-1.5 border-b border-line bg-panel px-2 py-1 text-[11px] text-muted">
            <span>Type</span><span>Namespace</span><span>Name</span><span>Port</span><span /><span>Local port</span><span />
          </div>
          {forwards.map((f, i) => (
            <ForwardRow key={i} f={f} i={i} connId={connId} namespaces={namespaces} bound={bound[i]}
              set={(patch) => setFwd(i, patch)} remove={() => set({ forwards: forwards.filter((_, j) => j !== i) })} />
          ))}
        </div>
      )}
      <div className="text-[11px] text-faint">
        Each connection through a forward gets its own port-forward, so one closing doesn't drop the others; for services the
        current pod is looked up for new connections, which follows a failover. Use a fixed local port for databases: point
        the connection at {"127.0.0.1:<port>"} and set its Network (Advanced) to this tunnel so it starts first.
      </div>
    </>
  );
}
