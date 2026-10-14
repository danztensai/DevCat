// Form sections of the connection dialog. Each section edits a slice of ConnectionConfig.
import clsx from "clsx";
import { Check, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox, IconButton, Input, Select, Spinner } from "../../../components/ui";
import { KIND_META } from "../../../components/ui/KindIcon";
import { api, errMsg } from "../../../lib/api";
import type { ConnectionConfig, ConnectionKind, SshConfig } from "../../../lib/types";
import { FileInput, PasswordInput, Row, Segmented } from "./formBits";

export interface SectionProps {
  cfg: ConnectionConfig;
  set: (patch: Partial<ConnectionConfig>) => void;
  setOpt: (key: string, value: string | null) => void;
}

export const COLOR_PRESETS: { value: string | null; label: string }[] = [
  { value: null, label: "None" },
  { value: "#ef4444", label: "Production" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Staging" },
  { value: "#22c55e", label: "Development" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#a855f7", label: "Purple" },
  { value: "#64748b", label: "Gray" },
];

export const URL_KINDS: ConnectionKind[] = ["postgres", "mysql", "mongodb", "redis"];
export const SSH_KINDS: ConnectionKind[] = ["postgres", "mysql", "mssql", "mongodb", "redis"];
export const SSL_KINDS: ConnectionKind[] = ["postgres", "mysql", "mssql", "mongodb", "redis"];

const URL_PLACEHOLDER: Partial<Record<ConnectionKind, string>> = {
  postgres: "postgres://user:password@host:5432/dbname?sslmode=prefer",
  mysql: "mysql://user:password@host:3306/dbname",
  mongodb: "mongodb+srv://user:password@cluster0.example.net/?retryWrites=true",
  redis: "redis://:password@host:6379/0",
};

export function suggestName(cfg: ConnectionConfig): string {
  if (cfg.kind === "sqlite") return cfg.filePath?.split(/[\\/]/).pop() ?? "";
  if (cfg.kind === "kubernetes") return cfg.options.context || "Kubernetes";
  if (cfg.url) {
    try { return new URL(cfg.url).hostname; } catch { return ""; }
  }
  if (!cfg.host) return "";
  return cfg.database && cfg.kind !== "redis" && cfg.kind !== "rabbitmq" ? `${cfg.database}@${cfg.host}` : cfg.host;
}

export function IdentitySection({ cfg, set, groups }: SectionProps & { groups: string[] }) {
  return (
    <>
      <Row label="Name">
        <Input autoFocus value={cfg.name} placeholder={suggestName(cfg) || "My connection"} onChange={(e) => set({ name: e.target.value })} />
      </Row>
      <Row label="Color" hint={cfg.color === "#ef4444" ? "Production — DevCat will highlight this connection in red." : undefined}>
        <div className="flex h-7 items-center gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button
              type="button"
              key={c.label}
              title={c.label}
              onClick={() => set({ color: c.value })}
              className={clsx(
                "flex size-5 items-center justify-center rounded-full border transition-transform hover:scale-110",
                c.value ? "border-transparent" : "border-line bg-app",
                (cfg.color ?? null) === c.value && "ring-2 ring-fg/70 ring-offset-1 ring-offset-panel",
              )}
              style={c.value ? { background: c.value } : undefined}
            >
              {!c.value && <span className="h-px w-3 rotate-45 bg-faint" />}
              {c.value && (cfg.color ?? null) === c.value && <Check className="size-3 text-white" />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Group">
        <Input list="devcat-conn-groups" value={cfg.group ?? ""} placeholder="(none)" onChange={(e) => set({ group: e.target.value || null })} />
        <datalist id="devcat-conn-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      </Row>
    </>
  );
}

export function ServerSection({ cfg, set, useUrl, setUseUrl }: SectionProps & { useUrl: boolean; setUseUrl: (v: boolean) => void }) {
  const meta = KIND_META[cfg.kind];
  const canUrl = URL_KINDS.includes(cfg.kind);
  return (
    <>
      {canUrl && (
        <Row label="Connect with">
          <div><Segmented value={useUrl ? "url" : "host"} onChange={(v) => setUseUrl(v === "url")}
            options={[{ value: "host", label: "Host & port" }, { value: "url", label: "Connection URL" }]} /></div>
        </Row>
      )}
      {useUrl && canUrl ? (
        <Row label="URL" hint="Credentials in the URL are stored in the OS keychain together with the password.">
          <Input className="font-mono text-xs!" value={cfg.url ?? ""} placeholder={URL_PLACEHOLDER[cfg.kind]} onChange={(e) => set({ url: e.target.value })} />
        </Row>
      ) : (
        <>
          <Row label="Host">
            <div className="flex gap-1.5">
              <Input value={cfg.host} placeholder="localhost" onChange={(e) => set({ host: e.target.value })} />
              <Input
                className="w-24! shrink-0"
                inputMode="numeric"
                value={cfg.port ?? ""}
                placeholder={String(meta.defaultPort ?? "")}
                onChange={(e) => { const n = parseInt(e.target.value, 10); set({ port: Number.isFinite(n) ? n : null }); }}
              />
            </div>
          </Row>
          <Row label="User">
            <Input value={cfg.user} placeholder={cfg.kind === "redis" ? "default (optional)" : cfg.kind === "mssql" ? "sa" : cfg.kind === "postgres" ? "postgres" : cfg.kind === "mysql" ? "root" : ""} onChange={(e) => set({ user: e.target.value })} />
          </Row>
          <Row label="Password">
            <PasswordInput value={cfg.password ?? ""} onChange={(v) => set({ password: v })} />
          </Row>
          {cfg.kind === "redis" ? (
            <Row label="Database">
              <Select value={cfg.database ?? "0"} onChange={(e) => set({ database: e.target.value })} className="w-32!">
                {Array.from({ length: 16 }, (_, i) => <option key={i} value={String(i)}>db{i}</option>)}
              </Select>
            </Row>
          ) : (
            <Row label={cfg.kind === "mongodb" ? "Auth database" : "Database"} hint="Optional — leave empty to browse every database.">
              <Input value={cfg.database ?? ""} placeholder={cfg.kind === "mongodb" ? "admin" : cfg.kind === "postgres" ? "postgres" : ""} onChange={(e) => set({ database: e.target.value || null })} />
            </Row>
          )}
        </>
      )}
    </>
  );
}

export function SqliteSection({ cfg, set }: SectionProps) {
  return (
    <Row label="Database file" hint="Choose an existing file, or pick a location to create a new database.">
      <FileInput
        mode="open+save"
        value={cfg.filePath ?? ""}
        placeholder="/path/to/database.sqlite"
        onChange={(v) => set({ filePath: v || null })}
        filters={[{ name: "SQLite database", extensions: ["sqlite", "sqlite3", "db", "db3", "s3db"] }, { name: "All files", extensions: ["*"] }]}
      />
    </Row>
  );
}

export function KubernetesSection({ cfg, set, setOpt }: SectionProps) {
  const [contexts, setContexts] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const path = cfg.filePath ?? "";

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await api.k8sContexts(path || null);
        if (!cancelled) setContexts(list);
      } catch (e) {
        if (!cancelled) { setContexts(null); setError(errMsg(e)); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [path, nonce]);

  const ctx = cfg.options.context ?? "";
  return (
    <>
      <Row label="Kubeconfig">
        <FileInput value={path} placeholder="~/.kube/config" onChange={(v) => set({ filePath: v || null })} />
      </Row>
      <Row label="Context" hint={error ? <span className="text-danger">{error}</span> : undefined}>
        <div className="flex items-center gap-1.5">
          <Select value={ctx} onChange={(e) => setOpt("context", e.target.value || null)}>
            <option value="">(current context)</option>
            {ctx && contexts && !contexts.includes(ctx) && <option value={ctx}>{ctx}</option>}
            {contexts?.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          {loading ? <span className="flex size-6 items-center justify-center"><Spinner className="size-3.5" /></span> : (
            <IconButton type="button" title="Reload contexts" onClick={() => setNonce((n) => n + 1)}><RefreshCw className="size-3.5" /></IconButton>
          )}
        </div>
      </Row>
      <Row label="Namespace">
        <Input value={cfg.options.namespace ?? ""} placeholder="default" onChange={(e) => setOpt("namespace", e.target.value || null)} />
      </Row>
    </>
  );
}

export function RabbitSection({ cfg, set, setOpt }: SectionProps) {
  const tls = cfg.options.useTls === "true";
  return (
    <>
      <Row label="Management host">
        <div className="flex gap-1.5">
          <Input value={cfg.host} placeholder="localhost" onChange={(e) => set({ host: e.target.value })} />
          <Input
            className="w-24! shrink-0"
            inputMode="numeric"
            value={cfg.port ?? ""}
            placeholder="15672"
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set({ port: Number.isFinite(n) ? n : null });
              setOpt("managementPort", Number.isFinite(n) ? String(n) : null);
            }}
          />
        </div>
      </Row>
      <Row label="">
        <div className="flex items-center gap-4">
          <Checkbox label="Use HTTPS" checked={tls} onChange={(v) => { setOpt("useTls", v ? "true" : "false"); if (!v) setOpt("insecureTls", null); }} />
          {tls && (
            <span title="Accept self-signed or otherwise untrusted TLS certificates">
              <Checkbox label="Allow self-signed certificates" checked={cfg.options.insecureTls === "true"} onChange={(v) => setOpt("insecureTls", v ? "true" : null)} />
            </span>
          )}
        </div>
      </Row>
      <Row label="User"><Input value={cfg.user} placeholder="guest" onChange={(e) => set({ user: e.target.value })} /></Row>
      <Row label="Password"><PasswordInput value={cfg.password ?? ""} placeholder="guest" onChange={(v) => set({ password: v })} /></Row>
      <Row label="Virtual host"><Input value={cfg.database ?? ""} placeholder="/" onChange={(e) => set({ database: e.target.value || null })} /></Row>
      <Row label="Base path" hint="Only when the management UI is served behind a reverse-proxy prefix.">
        <Input value={cfg.options.basePath ?? ""} placeholder="/ (e.g. /rabbitmq)" onChange={(e) => setOpt("basePath", e.target.value || null)} />
      </Row>
    </>
  );
}

const SSL_MODES = [
  { value: "disable", label: "Disable", hint: "Plain, unencrypted connection." },
  { value: "prefer", label: "Prefer", hint: "Use TLS when the server supports it." },
  { value: "require", label: "Require", hint: "Always use TLS, don't verify the certificate." },
  { value: "verify-full", label: "Verify full", hint: "Use TLS and verify the certificate and host name." },
];

export function SslSection({ cfg, set }: SectionProps) {
  const simple = cfg.kind === "mongodb" || cfg.kind === "redis";
  const modes = simple ? SSL_MODES.filter((m) => m.value === "disable" || m.value === "require" || m.value === "verify-full") : SSL_MODES;
  const value = cfg.sslMode ?? (simple ? "disable" : "prefer");
  return (
    <>
      <Row label={simple ? "TLS" : "SSL mode"} hint={modes.find((m) => m.value === value)?.hint}>
        <Select value={value} onChange={(e) => set({ sslMode: e.target.value })} className="w-48">
          {modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
      </Row>
      {cfg.kind === "mssql" && (
        <Row label=""><span className="text-[11px] text-faint">SQL Server maps Disable/Prefer to "Encrypt=false/optional" and Require to "TrustServerCertificate".</span></Row>
      )}
    </>
  );
}

export const emptySsh = (): SshConfig => ({ enabled: false, host: "", port: 22, user: "", auth: "password", keyPath: null, password: null });

export function SshSection({ cfg, set }: SectionProps) {
  const ssh = cfg.ssh ?? emptySsh();
  const up = (p: Partial<SshConfig>) => set({ ssh: { ...ssh, ...p } });
  return (
    <>
      <Row label="">
        <Checkbox label="Connect through an SSH tunnel" checked={ssh.enabled} onChange={(v) => up({ enabled: v })} />
      </Row>
      <fieldset disabled={!ssh.enabled} className={clsx("flex flex-col gap-2.5", !ssh.enabled && "opacity-50")}>
        <Row label="SSH host">
          <div className="flex gap-1.5">
            <Input value={ssh.host} placeholder="bastion.example.com" onChange={(e) => up({ host: e.target.value })} />
            <Input className="w-24! shrink-0" inputMode="numeric" value={ssh.port || ""} placeholder="22"
              onChange={(e) => { const n = parseInt(e.target.value, 10); up({ port: Number.isFinite(n) ? n : 22 }); }} />
          </div>
        </Row>
        <Row label="SSH user"><Input value={ssh.user} placeholder="ubuntu" onChange={(e) => up({ user: e.target.value })} /></Row>
        <Row label="Authentication">
          <div><Segmented value={ssh.auth} onChange={(v) => up({ auth: v })}
            options={[{ value: "password", label: "Password" }, { value: "key", label: "Private key" }]} /></div>
        </Row>
        {ssh.auth === "key" && (
          <Row label="Private key">
            <FileInput value={ssh.keyPath ?? ""} placeholder="~/.ssh/id_ed25519" onChange={(v) => up({ keyPath: v || null })} />
          </Row>
        )}
        <Row label={ssh.auth === "key" ? "Passphrase" : "Password"}>
          <PasswordInput value={ssh.password ?? ""} placeholder={ssh.auth === "key" ? "(optional)" : ""} onChange={(v) => up({ password: v || null })} />
        </Row>
      </fieldset>
    </>
  );
}

/** Managed option keys edited by dedicated fields; hidden from the raw editor. */
const MANAGED_OPTIONS = new Set(["context", "namespace", "managementPort", "useTls", "insecureTls", "basePath"]);

export function AdvancedSection({ cfg, set, setOpt }: SectionProps) {
  const isDb = cfg.kind !== "kubernetes" && cfg.kind !== "rabbitmq";
  const entries = Object.entries(cfg.options).filter(([k]) => !MANAGED_OPTIONS.has(k));
  const [newKey, setNewKey] = useState("");
  const addKey = () => {
    const k = newKey.trim();
    if (!k) return;
    setOpt(k, cfg.options[k] ?? "");
    setNewKey("");
  };
  return (
    <>
      <Row label="" hint="Blocks data edits, DDL and destructive actions from the UI for this connection.">
        <Checkbox label="Read-only connection" checked={cfg.readOnly} onChange={(v) => set({ readOnly: v })} />
      </Row>
      {isDb && (
        <Row label="Driver options" hint="Extra key/value options passed to the driver.">
          <div className="flex flex-col gap-1">
            {entries.map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <Input value={k} readOnly className="w-40! shrink-0 font-mono text-xs! text-muted" />
                <Input value={v} className="font-mono text-xs!" onChange={(e) => setOpt(k, e.target.value)} />
                <IconButton type="button" title="Remove option" onClick={() => setOpt(k, null)}><Trash2 className="size-3.5" /></IconButton>
              </div>
            ))}
            <div className="flex gap-1.5">
              <Input value={newKey} placeholder="option name" className="w-40! shrink-0 font-mono text-xs!"
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKey(); } }} />
              <IconButton type="button" title="Add option" onClick={addKey}><Plus className="size-3.5" /></IconButton>
            </div>
          </div>
        </Row>
      )}
    </>
  );
}
