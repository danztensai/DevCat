// Per-resource action menus (row ⋮ button / right-click), Lens style.
import {
  Copy, Eye, FileCode2, Layers, Network, Pause, Play, RotateCcw, Scaling, ScrollText, SquareTerminal, Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { errMsg } from "../../lib/api";
import type { MenuItem } from "../connections/ContextMenu";
import { k8s, type K8sObject } from "./api";
import { PortForwardDialog, ScaleDialog, useConfirm } from "./dialogs";
import { labelSelectorString, selectorString } from "./format";

export const SCALABLE = new Set(["deployments", "statefulsets", "replicasets", "replicationcontrollers"]);
export const RESTARTABLE = new Set(["deployments", "statefulsets", "daemonsets"]);
/** Kinds whose pods can be reached through `spec.selector` (logs / shell on the workload). */
export const POD_OWNERS = new Set(["deployments", "statefulsets", "daemonsets", "replicasets", "replicationcontrollers", "jobs"]);

export type DetailsTab = "details" | "events" | "yaml";

export interface RowActionHost {
  connId: string;
  readOnly: boolean;
  /** Open logs / shell for a pod; `pods` lists sibling pods for the pod switcher. */
  openSession: (type: "logs" | "shell", pod: K8sObject, opts?: { owner?: string; pods?: string[] }) => void;
  showDetails: (kindKey: string, obj: K8sObject, tab?: DetailsTab) => void;
  /** Called after an object was deleted (e.g. close the drawer). */
  onDeleted?: (obj: K8sObject) => void;
  browseCrd?: (crd: K8sObject) => void;
}

const ic = (I: typeof Eye) => <I className="size-3.5" />;

/** Pods selected by a workload, running ones first. */
export async function podsOf(connId: string, obj: K8sObject): Promise<K8sObject[]> {
  // ReplicationControllers use a plain label map; everything else a LabelSelector.
  const sel = obj.kind === "ReplicationController" ? selectorString(obj.spec?.selector) : labelSelectorString(obj.spec?.selector);
  if (!sel) return [];
  const pods = await k8s.list(connId, "pods", obj.metadata.namespace, sel);
  const rank = (p: K8sObject) => (p.metadata.deletionTimestamp ? 2 : p.status?.phase === "Running" ? 0 : 1);
  return pods.sort((a, b) => rank(a) - rank(b) || a.metadata.name.localeCompare(b.metadata.name));
}

/** Open logs / shell for a workload: resolve its pods and open the first, with a pod switcher. */
export async function openForWorkload(host: RowActionHost, type: "logs" | "shell", obj: K8sObject) {
  try {
    const pods = await podsOf(host.connId, obj);
    if (!pods.length) {
      toast.info(`${obj.kind} ${obj.metadata.name} has no pods${obj.spec?.replicas === 0 ? " (scaled to 0)" : ""}`);
      return;
    }
    host.openSession(type, pods[0], { owner: `${obj.kind} ${obj.metadata.name}`, pods: pods.map((p) => p.metadata.name) });
  } catch (e) {
    toast.error(errMsg(e));
  }
}

/** Hook owning the dialogs used by the menus. Render `node` once. */
export function useRowActions(host: RowActionHost): { menuFor: (kindKey: string, obj: K8sObject) => MenuItem[]; node: ReactNode } {
  const confirm = useConfirm();
  const [scale, setScale] = useState<{ kind: string; obj: K8sObject } | null>(null);
  const [pf, setPf] = useState<K8sObject | null>(null);
  const { connId, readOnly } = host;

  const menuFor = (kindKey: string, obj: K8sObject): MenuItem[] => {
    const ns = obj.metadata.namespace;
    const name = obj.metadata.name;
    const label = `${ns ? `${ns}/` : ""}${name}`;
    const items: MenuItem[] = [{ label: "Show details", icon: ic(Eye), onClick: () => host.showDetails(kindKey, obj) }];

    if (kindKey === "pods") {
      items.push(
        { label: "Logs", icon: ic(ScrollText), onClick: () => host.openSession("logs", obj) },
        ...(!readOnly ? [
          { label: "Shell", icon: ic(SquareTerminal), onClick: () => host.openSession("shell", obj) },
          { label: "Port forward…", icon: ic(Network), onClick: () => setPf(obj) },
        ] : []),
      );
    } else if (POD_OWNERS.has(kindKey)) {
      items.push({ label: "Logs", icon: ic(ScrollText), onClick: () => void openForWorkload(host, "logs", obj) });
      if (!readOnly) items.push({ label: "Shell", icon: ic(SquareTerminal), onClick: () => void openForWorkload(host, "shell", obj) });
    } else if (kindKey === "services" && !readOnly) {
      items.push({ label: "Port forward…", icon: ic(Network), onClick: () => setPf(obj) });
    } else if (kindKey === "customresourcedefinitions" && host.browseCrd) {
      items.push({ label: "Browse instances", icon: ic(Layers), onClick: () => host.browseCrd!(obj) });
    }

    if (!readOnly) {
      if (SCALABLE.has(kindKey)) items.push({ label: "Scale…", icon: ic(Scaling), onClick: () => setScale({ kind: kindKey, obj }) });
      if (RESTARTABLE.has(kindKey)) {
        items.push({
          label: "Restart", icon: ic(RotateCcw), onClick: () => confirm.ask({
            title: `Restart ${obj.kind}`,
            confirmLabel: "Restart",
            body: <>Perform a rolling restart of <b className="font-mono">{label}</b>? Pods will be replaced gradually.</>,
            run: async () => { await k8s.restart(connId, kindKey, ns, name); toast.success(`Restarting ${name}`); },
          }),
        });
      }
      if (kindKey === "cronjobs") {
        const suspended = !!obj.spec?.suspend;
        items.push({
          label: suspended ? "Resume" : "Suspend", icon: ic(suspended ? Play : Pause), onClick: () => confirm.ask({
            title: suspended ? "Resume CronJob" : "Suspend CronJob",
            confirmLabel: suspended ? "Resume" : "Suspend",
            body: <>{suspended ? "Resume" : "Suspend"} scheduling of <b className="font-mono">{label}</b>?</>,
            run: async () => { await k8s.cronjobSuspend(connId, ns!, name, !suspended); },
          }),
        });
      }
    }

    items.push(
      "separator",
      { label: readOnly ? "View YAML" : "Edit", icon: ic(FileCode2), onClick: () => host.showDetails(kindKey, obj, "yaml") },
      { label: "Copy name", icon: ic(Copy), onClick: () => { navigator.clipboard.writeText(name).catch(() => {}); } },
    );

    if (!readOnly) {
      items.push("separator", {
        label: "Delete", icon: ic(Trash2), danger: true, onClick: () => confirm.ask({
          title: `Delete ${obj.kind}`,
          danger: true,
          confirmLabel: "Delete",
          body: <>Delete <b className="font-mono">{label}</b>? This cannot be undone.{obj.kind === "Namespace" && <div className="mt-2 text-danger">All resources in this namespace will be deleted.</div>}</>,
          run: async () => { await k8s.delete(connId, kindKey, ns, name); toast.success(`Deleted ${name}`); host.onDeleted?.(obj); },
        }),
      });
    }
    return items;
  };

  const node = (
    <>
      <ScaleDialog open={!!scale} connId={connId} kind={scale?.kind ?? ""} obj={scale?.obj ?? null} onClose={() => setScale(null)} />
      <PortForwardDialog open={!!pf} connId={connId} obj={pf} onClose={() => setPf(null)} />
      {confirm.node}
    </>
  );
  return { menuFor, node };
}
