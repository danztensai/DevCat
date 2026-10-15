// "Import from ~/.ssh/config": pick hosts, each becomes a new SSH tunnel draft tab.
import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Dialog, ErrorBox, Input, Spinner } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { SshConfigHost } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { openDraftTab } from "./actions";
import { newProfile } from "./meta";

export function SshConfigImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [hosts, setHosts] = useState<SshConfigHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    setHosts(null);
    setError(null);
    setPicked(new Set());
    setFilter("");
    api.netSshConfigHosts().then(setHosts).catch((e) => { setError(errMsg(e)); setHosts([]); });
  }, [open]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (hosts ?? []).filter((h) => !q || h.alias.toLowerCase().includes(q) || h.host.toLowerCase().includes(q));
  }, [hosts, filter]);

  const toggle = (alias: string, on: boolean) =>
    setPicked((s) => { const n = new Set(s); if (on) n.add(alias); else n.delete(alias); return n; });

  const create = () => {
    const focus = useConnections.getState().focusProjectId;
    for (const h of hosts ?? []) {
      if (!picked.has(h.alias)) continue;
      const p = newProfile("ssh", focus);
      p.name = h.alias;
      p.ssh = { enabled: true, host: h.host || h.alias, port: h.port || 22, user: h.user ?? "", auth: h.identityFile ? "key" : "password", keyPath: h.identityFile ?? null, password: null };
      openDraftTab({ profile: p, configText: null });
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import from ~/.ssh/config"
      width={520}
      footer={
        <>
          <span className="mr-auto text-[11px] text-faint">Each host opens as a new SSH tunnel. Add port forwards, then save.</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked.size} onClick={create}>
            Create {picked.size || ""} tunnel{picked.size === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {hosts === null ? (
        <div className="flex h-24 items-center justify-center"><Spinner /></div>
      ) : error ? (
        <ErrorBox error={error} />
      ) : !hosts.length ? (
        <div className="py-6 text-center text-[13px] text-muted">No hosts found in ~/.ssh/config.</div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input autoFocus value={filter} placeholder="Filter hosts" onChange={(e) => setFilter(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(shown.map((h) => h.alias)))}>All</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>None</Button>
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-md border border-line">
            {shown.map((h) => (
              <div key={h.alias} className="flex h-8 items-center gap-2 border-b border-line/50 px-2 last:border-0 hover:bg-hover/60">
                <Checkbox label="" checked={picked.has(h.alias)} onChange={(v) => toggle(h.alias, v)} />
                <span className="min-w-0 flex-1 truncate text-[13px]" onClick={() => toggle(h.alias, !picked.has(h.alias))}>{h.alias}</span>
                <span className="max-w-[55%] truncate font-mono text-[11px] text-faint">
                  {h.user ? `${h.user}@` : ""}{h.host}{h.port && h.port !== 22 ? `:${h.port}` : ""}
                </span>
              </div>
            ))}
            {!shown.length && <div className="p-3 text-[12px] text-faint">No match.</div>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
