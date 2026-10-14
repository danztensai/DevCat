import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, ExternalLink, Network, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge, Empty, ErrorBox, IconButton } from "../../components/ui";
import { errMsg } from "../../lib/api";
import { k8s } from "./api";
import { useAsync } from "./hooks";

export default function PortForwards({ connId }: { connId: string }) {
  const { data, error, reload } = useAsync(() => k8s.portForwardList(connId), [connId], 2000);
  const stop = async (id: string) => {
    try { await k8s.portForwardStop(id); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  if (error) return <ErrorBox error={error} />;
  if (data && !data.length) {
    return (
      <Empty icon={<Network className="size-8" />} title="No active port forwards">
        Start one from a pod or service: open it and use the port-forward action or click a container port.
      </Empty>
    );
  }
  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 grid h-7 grid-cols-[minmax(160px,2fr)_minmax(100px,1fr)_70px_90px_90px_80px_minmax(120px,1.5fr)_84px] items-center gap-x-3 border-b border-line bg-panel px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span>Name</span><span>Namespace</span><span>Kind</span><span className="text-right">Remote</span><span className="text-right">Local</span><span className="text-right">Conns</span><span>Status</span><span />
      </div>
      {(data ?? []).map((f) => {
        const url = `http://localhost:${f.localPort}`;
        return (
          <div key={f.id} className="grid h-8 grid-cols-[minmax(160px,2fr)_minmax(100px,1fr)_70px_90px_90px_80px_minmax(120px,1.5fr)_84px] items-center gap-x-3 border-b border-line/40 px-3 text-[12.5px] hover:bg-hover">
            <span className="truncate font-medium" title={f.kind === "service" ? `via pod ${f.pod}` : undefined}>{f.name}</span>
            <span className="truncate text-muted">{f.namespace}</span>
            <span className="text-muted">{f.kind}</span>
            <span className="text-right font-mono tabular-nums">{f.remotePort}{f.targetPort !== f.remotePort ? <span className="text-muted">→{f.targetPort}</span> : null}</span>
            <span className="text-right font-mono tabular-nums">{f.localPort}</span>
            <span className="text-right tabular-nums text-muted">{f.connections}</span>
            <span className="truncate" title={f.error ?? undefined}>{f.error ? <Badge tone="danger">error</Badge> : <Badge tone="ok">active</Badge>} <span className="text-xs text-danger">{f.error}</span></span>
            <span className="flex justify-end gap-0.5">
              <IconButton title={`Open ${url}`} onClick={() => openUrl(url).catch((e) => toast.error(errMsg(e)))}><ExternalLink className="size-3.5" /></IconButton>
              <IconButton title="Copy URL" onClick={() => { navigator.clipboard.writeText(url); toast.success("Copied"); }}><Copy className="size-3.5" /></IconButton>
              <IconButton title="Stop" className="hover:text-danger" onClick={() => stop(f.id)}><Square className="size-3.5" /></IconButton>
            </span>
          </div>
        );
      })}
    </div>
  );
}
