// SSH tunnel: the SSH server plus a table of port forwards.
import clsx from "clsx";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button, IconButton, Input, Select } from "../../components/ui";
import type { NetProfile, NetStatus, PortForward, SshConfig } from "../../lib/types";
import { FileInput, PasswordInput, Row, Segmented } from "../connections/dialog/formBits";
import { SectionTitle } from "./formBits";

const emptyServer = (): SshConfig => ({ enabled: true, host: "", port: 22, user: "", auth: "key", keyPath: null, password: null });
export const emptyForward = (): PortForward => ({ kind: "local", bindPort: 0, remoteHost: "", remotePort: 0 });

const num = (v: string) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n <= 65535 ? n : 0; };

/** "127.0.0.1:5433 → db.internal:5432" for one forward (bound port from status when known). */
export function forwardLabel(f: PortForward, bound?: number): string {
  const local = `127.0.0.1:${bound || f.bindPort || "auto"}`;
  return f.kind === "dynamic" ? `SOCKS5 proxy on ${local}` : `${local} → ${f.remoteHost || "?"}:${f.remotePort || "?"}`;
}

export function SshTunnelEditor({ p, set, saved, status }: { p: NetProfile; set: (patch: Partial<NetProfile>) => void; saved: boolean; status: NetStatus | null }) {
  const ssh = { ...emptyServer(), ...(p.ssh ?? {}), enabled: true };
  const up = (patch: Partial<SshConfig>) => set({ ssh: { ...ssh, ...patch } });
  const forwards = p.forwards;
  const setFwd = (i: number, patch: Partial<PortForward>) => set({ forwards: forwards.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const bound = status?.state === "connected" ? status.localPorts : [];
  const secretHint = saved ? "Saved in the OS keychain — leave empty to keep it." : undefined;

  return (
    <>
      <SectionTitle>SSH server</SectionTitle>
      <Row label="Host">
        <div className="flex gap-1.5">
          <Input value={ssh.host} placeholder="bastion.example.com" onChange={(e) => up({ host: e.target.value.trim() })} />
          <Input className="w-20! shrink-0" inputMode="numeric" value={ssh.port || ""} placeholder="22"
            onChange={(e) => up({ port: num(e.target.value) || 22 })} />
        </div>
      </Row>
      <Row label="User"><Input value={ssh.user} placeholder="ubuntu" onChange={(e) => up({ user: e.target.value.trim() })} /></Row>
      <Row label="Authentication">
        <div><Segmented value={ssh.auth} onChange={(v) => up({ auth: v })} options={[{ value: "key", label: "Private key" }, { value: "password", label: "Password" }]} /></div>
      </Row>
      {ssh.auth === "key" && (
        <Row label="Private key" hint="Empty = your SSH agent / default keys.">
          <FileInput value={ssh.keyPath ?? ""} placeholder="~/.ssh/id_ed25519" onChange={(v) => up({ keyPath: v || null })} />
        </Row>
      )}
      <Row label={ssh.auth === "key" ? "Passphrase" : "Password"} hint={secretHint}>
        <PasswordInput value={ssh.password ?? ""} placeholder={saved ? "••••••••  (unchanged)" : ssh.auth === "key" ? "(optional)" : ""} onChange={(v) => up({ password: v || null })} />
      </Row>

      <SectionTitle right={<Button type="button" size="sm" variant="ghost" onClick={() => set({ forwards: [...forwards, emptyForward()] })}><Plus className="size-3" />Add forward</Button>}>
        Forwards
      </SectionTitle>
      {forwards.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-3 py-3 text-center text-[12px] text-muted">
          No forwards yet.{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => set({ forwards: [emptyForward()] })}>Add one</button>
          {" "}— e.g. local port 5433 → db.internal:5432 makes a private database reachable at localhost:5433.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-line">
          <div className="grid grid-cols-[120px_88px_16px_1fr_80px_28px] items-center gap-1.5 border-b border-line bg-panel px-2 py-1 text-[11px] text-muted">
            <span>Type</span><span>Local port</span><span /><span>Remote host (as seen from the SSH server)</span><span>Remote port</span><span />
          </div>
          {forwards.map((f, i) => (
            <div key={i} className="border-b border-line/50 px-2 py-1.5 last:border-0">
              <div className="grid grid-cols-[120px_88px_16px_1fr_80px_28px] items-center gap-1.5">
                <Select value={f.kind} onChange={(e) => setFwd(i, { kind: e.target.value as PortForward["kind"] })}>
                  <option value="local">Local</option>
                  <option value="dynamic">SOCKS proxy</option>
                </Select>
                <Input inputMode="numeric" className="font-mono text-xs!" value={f.bindPort || ""} placeholder="auto"
                  onChange={(e) => setFwd(i, { bindPort: num(e.target.value) })} />
                <ArrowRight className={clsx("size-3.5 text-faint", f.kind === "dynamic" && "invisible")} />
                {f.kind === "local" ? (
                  <>
                    <Input className="font-mono text-xs!" value={f.remoteHost} placeholder="db.internal or 10.0.0.5"
                      onChange={(e) => setFwd(i, { remoteHost: e.target.value.trim() })} />
                    <Input inputMode="numeric" className="font-mono text-xs!" value={f.remotePort || ""} placeholder="5432"
                      onChange={(e) => setFwd(i, { remotePort: num(e.target.value) })} />
                  </>
                ) : (
                  <span className="col-span-2 text-[11px] text-faint">Routes any destination through the SSH server (SOCKS5).</span>
                )}
                <IconButton type="button" title="Remove forward" onClick={() => set({ forwards: forwards.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton>
              </div>
              <div className={clsx("mt-1 pl-1 font-mono text-[11px]", bound[i] ? "text-ok" : "text-faint")}>{forwardLabel(f, bound[i])}</div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-faint">
        “auto” picks a free port on each connect. For database connections use a fixed port: point the connection at {"127.0.0.1:<port>"} and set its Network (Advanced) to this tunnel so it starts first.
      </div>
    </>
  );
}
