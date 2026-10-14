import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Checkbox, Dialog, Field, Input, Select } from "../../components/ui";
import { errMsg } from "../../lib/api";
import { k8s, type K8sObject } from "./api";

export function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", danger, onConfirm, onClose }: {
  open: boolean; title: ReactNode; children: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={title} width={440} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={run} autoFocus>{confirmLabel}</Button>
      </>
    }>
      <div className="text-[13px] leading-relaxed text-fg/90">{children}</div>
    </Dialog>
  );
}

/** Generic "are you sure" state helper: `ask({...})` opens the dialog. */
export interface ConfirmSpec { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; run: () => Promise<void> | void }
export function useConfirm() {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const node = (
    <ConfirmDialog
      open={!!spec}
      title={spec?.title}
      confirmLabel={spec?.confirmLabel}
      danger={spec?.danger}
      onConfirm={async () => { await spec?.run(); }}
      onClose={() => setSpec(null)}
    >
      {spec?.body}
    </ConfirmDialog>
  );
  return { ask: setSpec, node };
}

export function ScaleDialog({ open, connId, kind, obj, onClose }: { open: boolean; connId: string; kind: string; obj: K8sObject | null; onClose: () => void }) {
  const current = obj?.spec?.replicas ?? 0;
  const [value, setValue] = useState(String(current));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setValue(String(current)); }, [open, current]);
  if (!obj) return null;
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 0;
  const run = async () => {
    setBusy(true);
    try {
      await k8s.scale(connId, kind, obj.metadata.namespace, obj.metadata.name, n);
      toast.success(`Scaled ${obj.metadata.name} to ${n}`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Scale ${obj.kind} ${obj.metadata.name}`} width={400} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!valid || n === current} onClick={run}>Scale</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        <div className="text-xs text-muted">Current replicas: <span className="text-fg tabular-nums">{current}</span></div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setValue(String(Math.max(0, (Number(value) || 0) - 1)))}>−</Button>
          <Input className="w-24 text-center tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && run()} autoFocus />
          <Button onClick={() => setValue(String((Number(value) || 0) + 1))}>+</Button>
        </div>
        {n === 0 && <div className="text-xs text-warn">Scaling to 0 stops all pods of this workload.</div>}
      </div>
    </Dialog>
  );
}

export interface PortOption { port: number; label: string }

export function portsOf(obj: K8sObject): PortOption[] {
  if (obj.kind === "Service") {
    return (obj.spec?.ports ?? []).filter((p: K8sObject) => (p.protocol ?? "TCP") === "TCP").map((p: K8sObject) => ({
      port: p.port, label: `${p.port}${p.name ? ` (${p.name})` : ""} → ${p.targetPort ?? p.port}`,
    }));
  }
  const out: PortOption[] = [];
  for (const c of obj.spec?.containers ?? []) {
    for (const p of c.ports ?? []) {
      if ((p.protocol ?? "TCP") !== "TCP") continue;
      out.push({ port: p.containerPort, label: `${p.containerPort}${p.name ? ` (${p.name})` : ""} · ${c.name}` });
    }
  }
  return out;
}

export function PortForwardDialog({ open, connId, obj, initialPort, onClose }: {
  open: boolean; connId: string; obj: K8sObject | null; initialPort?: number; onClose: () => void;
}) {
  const ports = obj ? portsOf(obj) : [];
  const [remote, setRemote] = useState("");
  const [local, setLocal] = useState("");
  const [openBrowser, setOpenBrowser] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const p = initialPort ?? ports[0]?.port;
    setRemote(p ? String(p) : "");
    setLocal("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPort, obj?.metadata.uid]);
  if (!obj) return null;
  const isService = obj.kind === "Service";
  const r = Number(remote);
  const l = local.trim() ? Number(local) : null;
  const valid = Number.isInteger(r) && r > 0 && r < 65536 && (l === null || (Number.isInteger(l) && l > 0 && l < 65536));
  const run = async () => {
    setBusy(true);
    try {
      const info = await k8s.portForwardStart(connId, obj.metadata.namespace!, obj.metadata.name, isService ? "service" : "pod", r, l);
      const url = `http://localhost:${info.localPort}`;
      toast.success(`Forwarding ${url} → ${obj.metadata.name}:${info.remotePort}`, {
        action: { label: "Open", onClick: () => { openUrl(url).catch(() => {}); } },
      });
      if (openBrowser) openUrl(url).catch(() => {});
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Port forward ${isService ? "service" : "pod"} ${obj.metadata.name}`} width={440} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!valid} onClick={run}>Start</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        {ports.length > 0 && (
          <Field label={isService ? "Service port" : "Container port"}>
            <Select value={ports.some((p) => String(p.port) === remote) ? remote : ""} onChange={(e) => e.target.value && setRemote(e.target.value)}>
              <option value="">Custom…</option>
              {ports.map((p) => <option key={`${p.port}-${p.label}`} value={p.port}>{p.label}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Remote port"><Input value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="8080" /></Field>
          <Field label="Local port" hint="Empty = random free port"><Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="auto" /></Field>
        </div>
        <Checkbox label="Open in browser" checked={openBrowser} onChange={setOpenBrowser} />
      </div>
    </Dialog>
  );
}
