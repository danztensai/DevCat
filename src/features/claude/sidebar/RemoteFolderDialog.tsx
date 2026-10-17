// "Open folder on SSH host…": pick a host (from ~/.ssh/config, recent ones, or typed) and a
// folder there, browsing it like the file tree. The workspace then works on that folder over
// the system ssh (src-tauri/src/claude/remote.rs).
import clsx from "clsx";
import { ArrowUp, Folder, FolderGit2, Loader2, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Button, Dialog, Field, Input } from "../../../components/ui";
import { api, errMsg } from "../../../lib/api";
import { isRemote, remoteHost, remoteParts, remoteUri } from "../../../lib/remotePath";
import type { FileEntry, SshConfigHost } from "../../../lib/types";
import { useWorkspace } from "./workspace";

export const useRemoteDialog = create<{ open: boolean; set: (o: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

export function openRemoteFolderDialog() {
  useRemoteDialog.getState().set(true);
}

/** "me@box:2222" / "devbox" → ssh destination + port. */
function splitHost(s: string): { dest: string; port: number | null } {
  const t = s.trim();
  const m = /^(.*):(\d+)$/.exec(t);
  return m ? { dest: m[1], port: Number(m[2]) } : { dest: t, port: null };
}

export function RemoteFolderDialog() {
  const { open, set } = useRemoteDialog();
  const recent = useWorkspace((s) => s.recent);
  const setCwd = useWorkspace((s) => s.setCwd);
  const [configHosts, setConfigHosts] = useState<SshConfigHost[]>([]);
  const [host, setHost] = useState("");
  const [path, setPath] = useState("~");
  const [dir, setDir] = useState<string | null>(null);
  const [list, setList] = useState<FileEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recentHosts = useMemo(() => [...new Set(recent.filter(isRemote).map(remoteHost))], [recent]);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setList(null);
    setDir(null);
    api.netSshConfigHosts().then((h) => setConfigHosts(Array.isArray(h) ? h : [])).catch(() => setConfigHosts([]));
  }, [open]);

  const uriFor = (p: string) => {
    const { dest, port } = splitHost(host);
    return remoteUri(dest, port, p.trim() || "~");
  };

  /** Resolve and list `p` on the host. */
  const browse = async (p: string) => {
    if (!host.trim()) { setError("Enter a host first"); return; }
    setBusy(true);
    setError(null);
    try {
      const real = await api.remoteResolveDir(uriFor(p));
      const entries = await api.fsList(real, false);
      setDir(real);
      setPath(remoteParts(real)?.path ?? p);
      setList(entries.filter((e) => e.isDir));
    } catch (e) {
      setError(errMsg(e));
      setList(null);
    } finally {
      setBusy(false);
    }
  };

  const openHere = async () => {
    setBusy(true);
    setError(null);
    try {
      const real = dir && remoteParts(dir)?.path === path ? dir : await api.remoteResolveDir(uriFor(path));
      setCwd(real);
      set(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const parent = (p: string) => (p === "/" ? null : p.replace(/\/[^/]+\/?$/, "") || "/");
  const up = dir ? parent(remoteParts(dir)?.path ?? "/") : null;

  return (
    <Dialog open={open} onClose={() => set(false)} width={620}
      title={<span className="flex items-center gap-2"><Server className="size-4" />Open folder on SSH host</span>}
      footer={<div className="flex w-full items-center justify-between gap-2">
        <span className="truncate text-[11.5px] text-faint">{dir ? `Opens ${remoteHost(dir)}: ${path}` : "Uses your ssh setup: ~/.ssh/config, keys and ssh-agent"}</span>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" onClick={() => set(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!host.trim()} onClick={() => void openHere()}>Open folder</Button>
        </div>
      </div>}>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <Field label="Host" hint="A Host from ~/.ssh/config, or user@host[:port]">
            <Input autoFocus list="devcat-ssh-hosts" value={host} placeholder="devbox or me@10.0.0.5" onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void browse(path); }} />
            <datalist id="devcat-ssh-hosts">
              {recentHosts.map((h) => <option key={`r-${h}`} value={h}>recent</option>)}
              {configHosts.map((h) => <option key={h.alias} value={h.alias}>{`${h.user ? `${h.user}@` : ""}${h.host}${h.port !== 22 ? `:${h.port}` : ""}`}</option>)}
            </datalist>
          </Field>
          <Field label="Folder" hint="~ is your home folder there">
            <div className="flex gap-2">
              <Input className="font-mono" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void browse(path); }} />
              <Button disabled={!host.trim() || busy} onClick={() => void browse(path)}>Browse</Button>
            </div>
          </Field>
        </div>
        {error && (
          <div className="space-y-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            <div className="whitespace-pre-wrap">{error}</div>
            {/Permission denied|password|passphrase/i.test(error) && (
              <div className="flex items-center gap-2 text-muted">
                <span className="flex-1">Logging in with a password? Open the folder anyway and start a terminal there: you type the password once, and files then use that connection.</span>
                <Button size="sm" onClick={() => { setCwd(uriFor(path)); set(false); }}>Open anyway</Button>
              </div>
            )}
          </div>
        )}
        <div className="h-64 overflow-y-auto rounded-md border border-line bg-app">
          {busy && !list ? (
            <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted"><Loader2 className="size-4 animate-spin" />Connecting…</div>
          ) : !list ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-[12px] text-faint">
              <Server className="size-6" />
              <div>Enter a host and press <b className="text-muted">Browse</b> to pick a folder there.</div>
              <div>Agents run on that machine (Claude Code must be installed there); files open over ssh.</div>
            </div>
          ) : (
            <div className="py-1">
              {up !== null && (
                <button className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12.5px] hover:bg-hover" onClick={() => void browse(up)}>
                  <ArrowUp className="size-3.5 text-muted" /><span className="text-muted">..</span>
                </button>
              )}
              {list.length === 0 && <div className="px-3 py-2 text-[12px] text-faint">No folders here.</div>}
              {list.map((e) => (
                <button key={e.path} className={clsx("flex w-full items-center gap-2 px-3 py-1 text-left text-[12.5px] hover:bg-hover")} onDoubleClick={() => void browse(remoteParts(e.path)?.path ?? "/")}
                  onClick={() => setPath(remoteParts(e.path)?.path ?? path)}>
                  {e.isRepo ? <FolderGit2 className="size-3.5 text-accent" /> : <Folder className="size-3.5 text-accent" />}
                  <span className="truncate">{e.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="text-[11.5px] text-faint">Click a folder to select it, double-click to go in.</div>
      </div>
    </Dialog>
  );
}
