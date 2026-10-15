// Helm → Releases: read from the cluster's Helm release secrets (no helm CLI needed).
import Editor from "@monaco-editor/react";
import clsx from "clsx";
import { Package, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, ErrorBox, IconButton, Spinner } from "../../components/ui";
import { k8s } from "./api";
import { age, ts, useNow } from "./format";
import { useAsync } from "./hooks";

const tone = (s?: string): "ok" | "danger" | "warn" | "default" | "info" =>
  s === "deployed" ? "ok" : s === "failed" ? "danger" : s?.startsWith("pending") ? "warn" : s === "superseded" || s === "uninstalled" ? "default" : "info";

export default function HelmView({ connId, namespaces, search }: { connId: string; namespaces: string[]; search: string }) {
  const now = useNow();
  const nsKey = namespaces.join(",");
  const list = useAsync(async () => {
    const all = await k8s.helmReleases(connId, namespaces.length === 1 ? namespaces[0] : null);
    return namespaces.length > 1 ? all.filter((r) => namespaces.includes(r.namespace)) : all;
  }, [connId, nsKey], 30000);
  const [sel, setSel] = useState<{ namespace: string; name: string } | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((r) => !q || `${r.name} ${r.namespace} ${r.chart ?? ""} ${r.appVersion ?? ""}`.toLowerCase().includes(q));
  }, [list.data, search]);

  if (list.error) return <div className="p-2"><ErrorBox error={list.error} /><Button className="mx-3" onClick={list.reload}><RefreshCw className="size-3.5" />Retry</Button></div>;
  if (!list.data) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const cols = "minmax(180px,1.6fr) minmax(110px,1fr) minmax(140px,1.2fr) 70px minmax(80px,0.7fr) minmax(80px,0.7fr) 100px 70px";
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="sticky top-0 z-10 grid h-7 items-center gap-x-3 border-b border-line bg-panel px-3 text-[11px] font-semibold tracking-wide text-muted uppercase" style={{ gridTemplateColumns: cols }}>
            <span>Name</span><span>Namespace</span><span>Chart</span><span className="text-right">Revision</span><span>Version</span><span>App version</span><span>Status</span><span className="text-right">Updated</span>
          </div>
          {rows.map((r) => {
            const active = sel?.name === r.name && sel.namespace === r.namespace;
            return (
              <div
                key={`${r.namespace}/${r.name}`}
                onClick={() => setSel({ namespace: r.namespace, name: r.name })}
                className={clsx(
                  "grid h-7 cursor-default items-center gap-x-3 border-b border-line/40 px-3 text-[12.5px]",
                  active ? "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]" : "hover:bg-hover",
                )}
                style={{ gridTemplateColumns: cols }}
                title={r.error ?? r.description}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {r.icon ? <img src={r.icon} alt="" className="size-4 shrink-0 object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <Package className="size-3.5 shrink-0 text-muted" />}
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="truncate text-muted">{r.namespace}</span>
                <span className="truncate">{r.chart ?? "—"}</span>
                <span className="text-right tabular-nums">{r.revision}</span>
                <span className="truncate font-mono text-[11px] text-muted">{r.chartVersion ?? "—"}</span>
                <span className="truncate font-mono text-[11px] text-muted">{r.appVersion ?? "—"}</span>
                <span><Badge tone={tone(r.status)}>{r.status ?? "unknown"}</Badge></span>
                <span className="text-right tabular-nums text-muted">{r.updated ? age(ts(r.updated), now) : "—"}</span>
              </div>
            );
          })}
          {rows.length === 0 && <div className="p-6 text-center text-xs text-muted">No Helm releases{search ? ` matching “${search}”` : ""}.</div>}
        </div>
        <div className="flex h-6 shrink-0 items-center border-t border-line px-3 text-[11px] text-muted">
          {rows.length} release{rows.length === 1 ? "" : "s"} · read from Helm release secrets
        </div>
      </div>
      {sel && <ReleaseDrawer connId={connId} namespace={sel.namespace} name={sel.name} onClose={() => setSel(null)} />}
    </div>
  );
}

type DTab = "notes" | "values" | "defaults" | "manifest" | "history";

function ReleaseDrawer({ connId, namespace, name, onClose }: { connId: string; namespace: string; name: string; onClose: () => void }) {
  const [revision, setRevision] = useState<number | null>(null);
  const [tab, setTab] = useState<DTab>("values");
  const now = useNow();
  const d = useAsync(() => k8s.helmRelease(connId, namespace, name, revision), [connId, namespace, name, revision]);
  const s = d.data?.summary;
  const text = !d.data ? "" : tab === "values" ? d.data.values || "# No user-supplied values" : tab === "defaults" ? d.data.defaultValues : tab === "manifest" ? d.data.manifest ?? "" : d.data.notes ?? "";

  return (
    <div className="flex w-[560px] shrink-0 flex-col border-l border-line bg-panel shadow-[-8px_0_24px_rgba(0,0,0,0.25)]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
        <Package className="size-4 shrink-0 text-muted" />
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold"><span className="text-muted">Release:</span> {name}</div>
        {s && <Badge tone={tone(s.status)}>{s.status}</Badge>}
        <IconButton title="Close" onClick={onClose}><X className="size-4" /></IconButton>
      </div>
      {s && (
        <div className="grid shrink-0 grid-cols-[110px_1fr] gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-[12px]">
          <span className="text-muted">Namespace</span><span>{s.namespace}</span>
          <span className="text-muted">Chart</span><span>{s.chart} <span className="font-mono text-muted">{s.chartVersion}</span></span>
          <span className="text-muted">App version</span><span className="font-mono">{s.appVersion ?? "—"}</span>
          <span className="text-muted">Revision</span>
          <span>{s.revision}{revision !== null && <button className="ml-2 text-accent hover:underline" onClick={() => setRevision(null)}>show latest</button>}</span>
          <span className="text-muted">Updated</span><span>{s.updated ? `${age(ts(s.updated), now)} ago` : "—"}</span>
          {s.description && <><span className="text-muted">Description</span><span className="truncate" title={s.description}>{s.description}</span></>}
        </div>
      )}
      <div className="flex h-8 shrink-0 items-end gap-3 border-b border-line px-3 text-xs">
        {(["values", "defaults", "manifest", "notes", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={clsx("h-full border-b-2 px-0.5", tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {{ values: "Values", defaults: "Default values", manifest: "Manifest", notes: "Notes", history: "History" }[t]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {d.error ? <ErrorBox error={d.error} /> : !d.data ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : tab === "history" ? (
          <div className="h-full overflow-auto">
            {d.data.history.map((h) => (
              <button
                key={h.revision}
                onClick={() => { setRevision(h.revision); setTab("values"); }}
                className={clsx("grid w-full grid-cols-[40px_90px_1fr_70px] items-center gap-3 border-b border-line/40 px-3 py-1.5 text-left text-[12px] hover:bg-hover", s?.revision === h.revision && "bg-accent/10")}
              >
                <span className="tabular-nums">#{h.revision}</span>
                <Badge tone={tone(h.status)}>{h.status}</Badge>
                <span className="truncate text-muted" title={h.description}>{h.chart}-{h.chartVersion} · {h.description}</span>
                <span className="text-right tabular-nums text-muted">{h.updated ? age(ts(h.updated), now) : "—"}</span>
              </button>
            ))}
          </div>
        ) : (
          <Editor
            theme="devcat"
            language={tab === "notes" ? "plaintext" : "yaml"}
            value={text}
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, wordWrap: tab === "notes" ? "on" : "off", lineNumbers: tab === "notes" ? "off" : "on" }}
          />
        )}
      </div>
    </div>
  );
}
