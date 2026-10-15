// Typed wrappers around the k8s_* Tauri commands and events (src-tauri/src/infra/k8s).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Raw Kubernetes object as returned by the backend (managedFields stripped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type K8sObject = Record<string, any> & {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    uid: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: { apiVersion: string; kind: string; name: string; uid: string; controller?: boolean }[];
    deletionTimestamp?: string;
    resourceVersion?: string;
    finalizers?: string[];
  };
};

export interface ConnectInfo { version: string; platform: string; context: string; server: string; namespace: string }

export interface ResourceStat { capacity: number; allocatable: number; requests: number; limits: number; usage?: number | null }

export interface ClusterOverview {
  version: string;
  platform: string;
  context: string;
  server: string;
  nodesTotal: number;
  nodesReady: number;
  podsTotal: number;
  podsByPhase: Record<string, number>;
  podsCapacity: number;
  containerRestarts: number;
  deploymentsTotal: number;
  deploymentsReady: number;
  namespaces: number;
  cpu: ResourceStat;
  memory: ResourceStat;
  metricsAvailable: boolean;
  warnings: K8sObject[];
  errors: string[];
}

export interface UsageItem {
  name: string;
  namespace?: string | null;
  /** cores */
  cpu: number;
  /** bytes */
  memory: number;
  containers: { name: string; cpu: number; memory: number }[];
}

export interface MetricsResult { available: boolean; error?: string | null; items: UsageItem[] }

export interface PortForwardInfo {
  id: string;
  connId: string;
  namespace: string;
  kind: "pod" | "service";
  name: string;
  pod: string;
  remotePort: number;
  targetPort: number;
  localPort: number;
  connections: number;
  error?: string | null;
}

export type WatchEventType = "Added" | "Modified" | "Deleted" | "Restarted" | "Error";
export interface WatchEvent { streamId: string; type: WatchEventType; object: K8sObject | K8sObject[] | null; error?: string | null }
export interface LogBatch { streamId: string; lines: string[] }
export interface StreamEnd { streamId: string; error?: string | null }
export interface ExecOutput { sessionId: string; data: string }
export interface ExecExit { sessionId: string; status?: string | null; error?: string | null }

export interface LogOptions {
  container?: string | null;
  tailLines?: number | null;
  follow: boolean;
  previous: boolean;
  timestamps: boolean;
  sinceSeconds?: number | null;
}

export const k8s = {
  contexts: (kubeconfigPath?: string | null) => invoke<string[]>("k8s_contexts", { kubeconfigPath }),
  connect: (connId: string) => invoke<ConnectInfo>("k8s_connect", { connId }),
  disconnect: (connId: string) => invoke<void>("k8s_disconnect", { connId }),
  namespaces: (connId: string) => invoke<string[]>("k8s_namespaces", { connId }),
  helmReleases: (connId: string, namespace?: string | null) => invoke<HelmRelease[]>("k8s_helm_releases", { connId, namespace }),
  helmRelease: (connId: string, namespace: string, name: string, revision?: number | null) =>
    invoke<HelmReleaseDetail>("k8s_helm_release", { connId, namespace, name, revision }),
  list: (connId: string, kind: string, namespace?: string | null, labelSelector?: string | null) =>
    invoke<K8sObject[]>("k8s_list", { connId, kind, namespace, labelSelector }),
  get: (connId: string, kind: string, namespace: string | null | undefined, name: string) =>
    invoke<K8sObject>("k8s_get", { connId, kind, namespace, name }),
  getYaml: (connId: string, kind: string, namespace: string | null | undefined, name: string) =>
    invoke<string>("k8s_get_yaml", { connId, kind, namespace, name }),
  applyYaml: (connId: string, yaml: string) => invoke<string>("k8s_apply_yaml", { connId, yaml }),
  delete: (connId: string, kind: string, namespace: string | null | undefined, name: string, force = false) =>
    invoke<void>("k8s_delete", { connId, kind, namespace, name, force }),
  scale: (connId: string, kind: string, namespace: string | null | undefined, name: string, replicas: number) =>
    invoke<void>("k8s_scale", { connId, kind, namespace, name, replicas }),
  restart: (connId: string, kind: string, namespace: string | null | undefined, name: string) =>
    invoke<void>("k8s_restart", { connId, kind, namespace, name }),
  cronjobSuspend: (connId: string, namespace: string, name: string, suspend: boolean) =>
    invoke<void>("k8s_cronjob_suspend", { connId, namespace, name, suspend }),
  eventsFor: (connId: string, kind: string, namespace: string | null | undefined, name: string) =>
    invoke<K8sObject[]>("k8s_events_for", { connId, kind, namespace, name }),
  overview: (connId: string) => invoke<ClusterOverview>("k8s_cluster_overview", { connId }),
  metrics: (connId: string, kind: "nodes" | "pods", namespace?: string | null) =>
    invoke<MetricsResult>("k8s_metrics", { connId, kind, namespace }),

  logsStart: (connId: string, namespace: string, pod: string, o: LogOptions) =>
    invoke<string>("k8s_logs_start", {
      connId, namespace, pod, container: o.container ?? null, tailLines: o.tailLines ?? null,
      follow: o.follow, previous: o.previous, timestamps: o.timestamps, sinceSeconds: o.sinceSeconds ?? null,
    }),
  watchStart: (connId: string, kind: string, namespace?: string | null, labelSelector?: string | null) =>
    invoke<string>("k8s_watch_start", { connId, kind, namespace, labelSelector }),
  streamStop: (streamId: string) => invoke<void>("k8s_stream_stop", { streamId }),

  execStart: (connId: string, namespace: string, pod: string, container: string | null, command: string[], cols: number, rows: number) =>
    invoke<string>("k8s_exec_start", { connId, namespace, pod, container, command, cols, rows }),
  execInput: (sessionId: string, data: string) => invoke<void>("k8s_exec_input", { sessionId, data }),
  execResize: (sessionId: string, cols: number, rows: number) => invoke<void>("k8s_exec_resize", { sessionId, cols, rows }),
  execStop: (sessionId: string) => invoke<void>("k8s_exec_stop", { sessionId }),

  portForwardStart: (connId: string, namespace: string, podOrService: string, kind: "pod" | "service", remotePort: number, localPort?: number | null) =>
    invoke<PortForwardInfo>("k8s_port_forward_start", { connId, namespace, podOrService, kind, remotePort, localPort: localPort ?? null }),
  portForwardList: (connId?: string | null) => invoke<PortForwardInfo[]>("k8s_port_forward_list", { connId }),
  portForwardStop: (id: string) => invoke<void>("k8s_port_forward_stop", { id }),

  saveText: (path: string, contents: string) => invoke<void>("k8s_save_text", { path, contents }),
};

// ---- event fan-out -------------------------------------------------------
// One global Tauri listener per event name, dispatching to per-stream handlers by id.
// Avoids N listeners × every event when many streams are open.

type Handler<T> = (payload: T) => void;

function channel<T extends object>(event: string, key: keyof T) {
  const handlers = new Map<string, Handler<T>>();
  // Events that arrive before a handler registers (start() races) are buffered briefly.
  const early = new Map<string, T[]>();
  let unlisten: Promise<UnlistenFn> | null = null;
  const ensure = () => {
    unlisten ??= listen<T>(event, (e) => {
      const id = String(e.payload[key]);
      const h = handlers.get(id);
      if (h) h(e.payload);
      else {
        const q = early.get(id) ?? [];
        if (q.length < 2000) q.push(e.payload);
        early.set(id, q);
        if (early.size > 200) early.delete(early.keys().next().value as string);
      }
    });
    return unlisten;
  };
  return {
    ready: ensure,
    on(id: string, h: Handler<T>) {
      ensure();
      handlers.set(id, h);
      const q = early.get(id);
      if (q) { early.delete(id); q.forEach(h); }
      return () => { handlers.delete(id); early.delete(id); };
    },
  };
}

export const events = {
  watch: channel<WatchEvent>("k8s-watch", "streamId"),
  log: channel<LogBatch>("k8s-log", "streamId"),
  logEnd: channel<StreamEnd>("k8s-log-end", "streamId"),
  execOutput: channel<ExecOutput>("k8s-exec-output", "sessionId"),
  execExit: channel<ExecExit>("k8s-exec-exit", "sessionId"),
};

/** Make sure all global listeners are attached before starting streams. */
export function eventsReady() {
  return Promise.all([events.watch.ready(), events.log.ready(), events.logEnd.ready(), events.execOutput.ready(), events.execExit.ready()]);
}

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: number;
  status: string;
  chart?: string;
  chartVersion?: string;
  appVersion?: string;
  icon?: string;
  chartDescription?: string;
  updated?: string;
  firstDeployed?: string;
  description?: string;
  error?: string;
}

export interface HelmReleaseDetail {
  summary: HelmRelease;
  /** user-supplied values (YAML) */
  values: string;
  /** chart default values (YAML) */
  defaultValues: string;
  manifest?: string;
  notes?: string;
  history: HelmRelease[];
}
