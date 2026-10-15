// Network profile tab: status, settings editor (OpenVPN / WireGuard / SSH tunnel) and live logs.
import clsx from "clsx";
import { AlertTriangle, Copy, Info, Power, PowerOff, Save, ScrollText, Settings2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { Badge, Button, Empty, ErrorBox, IconButton, Spinner, Toolbar } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { NetKind, NetProfile, NetProfileFull, NetStatus, NetTools } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { useTabs } from "../../store/tabs";
import type { Tab } from "../../tabs/types";
import { connectProfile, deleteProfile, disconnectProfile, draftFor, useNetTabNav } from "./actions";
import { IdentityRows, SectionTitle } from "./formBits";
import { LogsView } from "./LogsView";
import {
  basename, copyText, isBusy, isUp, isVpn, NET_KIND_META, NetKindIcon, newProfile, relativeTime, STATE_LABEL, StatusDot, stateTone, useNow,
} from "./meta";
import { emptyOvpnForm, generateOvpn } from "./ovpnGen";
import { forwardLabel, SshTunnelEditor } from "./SshTunnelEditor";
import { useNet, useNetStatus } from "./store";
import { OpenVpnEditor, WireGuardEditor, type EditMode } from "./VpnEditors";
import { emptyWgForm, generateWg } from "./wgGen";

type NetworkTabSpec = Extract<Tab, { type: "network" }>;

interface Loaded {
  p: NetProfile;
  text: string;
  mode: EditMode;
  /** snapshot of the last saved state ("" = never saved → always dirty) */
  baseline: string;
  notice?: string;
}

const snap = (p: NetProfile, text: string) => JSON.stringify([{ ...p, vpnPassword: p.vpnPassword || null }, isVpn(p.kind) ? text : null]);

const blankText = (kind: NetKind) => (kind === "openvpn" ? generateOvpn(emptyOvpnForm()) : kind === "wireguard" ? generateWg(emptyWgForm()) : "");

/** Profile as returned by the backend, with write-only secrets cleared for editing. */
const forEdit = (p: NetProfile): NetProfile => ({
  ...p,
  forwards: p.forwards ?? [],
  options: p.options ?? {},
  vpnPassword: null,
  ssh: p.ssh ? { ...p.ssh, password: null } : p.ssh,
});

async function loadInitial(tab: NetworkTabSpec): Promise<Loaded> {
  if (tab.profileId) {
    const full = await api.netGet(tab.profileId);
    const p = forEdit(full.profile);
    const text = full.configText ?? "";
    return { p, text, mode: "config", baseline: snap(p, text) };
  }
  const draft = draftFor(tab.id);
  if (draft) return fromDraft(draft, true);
  if (tab.importPath) {
    try {
      return fromDraft(await api.netImport(tab.importPath), true);
    } catch (e) {
      // Backend import unavailable: read the file ourselves and let the user save it.
      const text = await readTextFile(tab.importPath).catch(() => { throw e; });
      const kind: NetKind = /^\s*\[Interface\]/im.test(text) ? "wireguard" : "openvpn";
      const p = newProfile(kind, useConnections.getState().focusProjectId);
      p.name = basename(tab.importPath).replace(/\.(ovpn|conf)$/i, "");
      return { p, text, mode: "config", baseline: "", notice: `Imported as text (${errMsg(e)}).` };
    }
  }
  const kind = tab.kind ?? "openvpn";
  const p = newProfile(kind, useConnections.getState().focusProjectId);
  const text = blankText(kind);
  return { p, text, mode: "form", baseline: snap(p, text) };
}

function fromDraft(d: NetProfileFull, unsaved: boolean): Loaded {
  const p = { ...newProfile(d.profile.kind), ...d.profile, forwards: d.profile.forwards ?? [], options: d.profile.options ?? {} };
  const text = d.configText ?? (isVpn(p.kind) ? blankText(p.kind) : "");
  // A brand-new blank draft starts in the form; anything with real config text in the editor.
  const mode: EditMode = d.configText ? "config" : "form";
  const blank = !d.configText && !p.name && !(p.ssh?.host);
  return { p, text, mode, baseline: unsaved && !blank ? "" : snap(p, text) };
}

/** Validation problems that block saving. */
function problems(p: NetProfile, text: string): string[] {
  const out: string[] = [];
  if (p.kind === "ssh") {
    if (!p.ssh?.host) out.push("SSH host is required.");
    p.forwards.forEach((f, i) => {
      if (f.kind === "local" && (!f.remoteHost || !f.remotePort)) out.push(`Forward ${i + 1}: remote host and port are required.`);
    });
    const ports = p.forwards.map((f) => f.bindPort).filter(Boolean);
    if (new Set(ports).size !== ports.length) out.push("Two forwards use the same local port.");
  } else if (!text.trim()) {
    out.push("The configuration is empty.");
  }
  return out;
}

function suggestName(p: NetProfile): string {
  if (p.kind === "ssh") return p.ssh?.host ? `${p.ssh.user ? `${p.ssh.user}@` : ""}${p.ssh.host}` : "";
  return p.summary?.split(/\s+/).pop()?.replace(/:\d+$/, "") ?? "";
}

export default function NetworkTab({ tab }: { tab: NetworkTabSpec }) {
  const [profileId, setProfileId] = useState(tab.profileId);
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<"settings" | "logs">("settings");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const status = useNetStatus(profileId || null);
  const tools = useNet((s) => s.tools);
  const nav = useNetTabNav((s) => (profileId ? s[profileId] : undefined));

  const load = useCallback(() => {
    setLoadError(null);
    loadInitial(tab).then(setData).catch((e) => setLoadError(errMsg(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  // "Show logs" / "Edit" from the sidebar.
  useEffect(() => { if (nav) setView(nav.view); }, [nav]);

  const p = data?.p;
  const text = data?.text ?? "";
  const dirty = !!data && snap(data.p, data.text) !== data.baseline;
  useEffect(() => { useTabs.getState().update(tab.id, { dirty }); }, [dirty, tab.id]);

  const set = useCallback((patch: Partial<NetProfile>) => setData((d) => (d ? { ...d, p: { ...d.p, ...patch } } : d)), []);
  const setText = useCallback((t: string) => setData((d) => (d ? { ...d, text: t } : d)), []);

  const issues = useMemo(() => (p ? problems(p, text) : []), [p, text]);

  const save = async (): Promise<NetProfile | null> => {
    if (!data) return null;
    setAttempted(true);
    if (issues.length) {
      toast.error(issues[0]);
      setView("settings");
      return null;
    }
    const toSave: NetProfile = { ...data.p, id: profileId, name: data.p.name.trim() || suggestName(data.p) || `${NET_KIND_META[data.p.kind].label}` };
    setSaving(true);
    try {
      const saved = await useNet.getState().save(toSave, isVpn(toSave.kind) ? data.text : null);
      const p2 = forEdit(saved);
      setProfileId(saved.id);
      setData({ p: p2, text: data.text, mode: data.mode, baseline: snap(p2, data.text) });
      setAttempted(false);
      useTabs.getState().update(tab.id, { title: saved.name, profileId: saved.id, importPath: undefined, dirty: false });
      toast.success(`Saved "${saved.name}"`);
      return saved;
    } catch (e) {
      toast.error(`Couldn't save: ${errMsg(e)}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    let target = p && profileId ? { id: profileId, name: p.name } : null;
    if (!target || dirty) {
      const saved = await save();
      if (!saved) return;
      target = saved;
    }
    await connectProfile(target);
  };

  const remove = async () => {
    if (!p) return;
    if (!profileId) { useTabs.getState().close(tab.id); return; }
    await deleteProfile({ id: profileId, name: p.name });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      if (!saving) void save();
    }
  };

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Empty icon={<AlertTriangle className="size-8" />} title="Couldn't open this profile" />
        <ErrorBox error={loadError} />
        <Button onClick={load}>Retry</Button>
      </div>
    );
  }
  if (!data || !p) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const state = status?.state;
  const up = isUp(state);
  const toolMissing = tools !== null && isVpn(p.kind) && !tools[p.kind as "openvpn" | "wireguard"];

  return (
    <div className="flex h-full min-h-0 flex-col bg-app" onKeyDownCapture={onKeyDown}>
      <Toolbar className="h-10 gap-2 px-3">
        <NetKindIcon kind={p.kind} className="size-4 shrink-0" />
        <span className="min-w-0 truncate text-[13px] font-semibold">{p.name || suggestName(p) || `New ${NET_KIND_META[p.kind].label}`}</span>
        <Badge>{NET_KIND_META[p.kind].label}</Badge>
        {profileId ? (
          <Badge tone={stateTone(state)}>
            <StatusDot state={state} className="mr-1 size-1.5" />{STATE_LABEL[state ?? "disconnected"]}
          </Badge>
        ) : (
          <Badge tone="info">Not saved</Badge>
        )}
        {dirty && profileId && <span className="text-[11px] text-faint">Unsaved changes</span>}
        <span className="flex-1" />
        {up ? (
          <Button size="sm" onClick={() => void disconnectProfile({ id: profileId, name: p.name })}>
            <PowerOff className="size-3.5" />{state === "connecting" ? "Cancel" : "Disconnect"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={dirty ? "default" : "primary"}
            disabled={toolMissing || state === "disconnecting"}
            title={toolMissing ? `${NET_KIND_META[p.kind].label} isn't installed` : undefined}
            loading={isBusy(state)}
            onClick={() => void connect()}
          >
            <Power className="size-3.5" />{!profileId || dirty ? "Save & connect" : "Connect"}
          </Button>
        )}
        <Button size="sm" variant={dirty ? "primary" : "default"} loading={saving} disabled={!dirty && !!profileId} onClick={() => void save()} title="Save (⌘S)">
          <Save className="size-3.5" />Save
        </Button>
        <IconButton title={profileId ? "Delete profile" : "Discard"} onClick={() => void remove()}><Trash2 className="size-3.5" /></IconButton>
      </Toolbar>

      {profileId && <StatusStrip status={status} p={p} />}

      <div className="flex h-8 shrink-0 items-end gap-1 border-b border-line bg-panel px-3">
        <SubTab active={view === "settings"} onClick={() => setView("settings")}><Settings2 className="size-3.5" />Settings</SubTab>
        <SubTab active={view === "logs"} onClick={() => setView("logs")} disabled={!profileId}>
          <ScrollText className="size-3.5" />Logs
        </SubTab>
      </div>

      <div className="min-h-0 flex-1">
        {view === "logs" && profileId ? (
          <LogsView id={profileId} />
        ) : (
          <div className="h-full overflow-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-6 py-4">
              {data.notice && <div className="flex items-start gap-1.5 text-[11px] text-faint"><Info className="mt-px size-3 shrink-0" />{data.notice}</div>}
              {toolMissing && <ToolMissing kind={p.kind} tools={tools!} />}
              {attempted && issues.length > 0 && (
                <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                  {issues.map((i) => <div key={i}>{i}</div>)}
                </div>
              )}
              <SectionTitle>General</SectionTitle>
              <IdentityRows p={p} set={set} namePlaceholder={suggestName(p) || (p.kind === "ssh" ? "Bastion tunnel" : "Office VPN")} />
              {p.kind === "openvpn" && (
                <OpenVpnEditor p={p} set={set} text={text} setText={setText} initialMode={data.mode} saved={!!profileId} />
              )}
              {p.kind === "wireguard" && <WireGuardEditor text={text} setText={setText} initialMode={data.mode} />}
              {p.kind === "ssh" && <SshTunnelEditor p={p} set={set} saved={!!profileId} status={status} />}
              {isVpn(p.kind) && <ElevationNote kind={p.kind} tools={tools} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SubTab({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "-mb-px flex h-7 items-center gap-1.5 border-b-2 px-2.5 text-[12px] disabled:opacity-40",
        active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function StatusStrip({ status, p }: { status: NetStatus | null; p: NetProfile }) {
  const now = useNow(10_000);
  const state = status?.state ?? "disconnected";
  const since = relativeTime(status?.since, now);
  const ports = state === "connected" ? status?.localPorts ?? [] : [];
  return (
    <div className="shrink-0 border-b border-line bg-panel/60 px-4 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5">
          <StatusDot state={state} />
          <span className={clsx(state === "connected" ? "text-ok" : state === "error" ? "text-danger" : isBusy(state) ? "text-warn" : "text-muted")}>{STATE_LABEL[state]}</span>
          {since && state !== "disconnected" && <span className="text-faint" title={status?.since ?? undefined}>· {since}</span>}
        </span>
        {status?.detail && <span className="selectable font-mono text-[11px] text-muted">{status.detail}</span>}
        {ports.map((port, i) => (
          <button
            key={i}
            className="flex items-center gap-1 rounded bg-ok/10 px-1.5 font-mono text-[11px] text-ok hover:bg-ok/20"
            title={p.forwards[i] ? `${forwardLabel(p.forwards[i], port)} — click to copy` : "Copy"}
            onClick={() => void copyText(`127.0.0.1:${port}`)}
          >
            127.0.0.1:{port}<Copy className="size-2.5" />
          </button>
        ))}
        {!status?.detail && state === "disconnected" && !ports.length && <span className="text-faint">{p.summary}</span>}
      </div>
      {state === "error" && status?.error && (
        <div className="selectable mt-1.5 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-danger">{status.error}</div>
      )}
    </div>
  );
}

function ToolMissing({ kind, tools }: { kind: NetKind; tools: NetTools }) {
  const hint = tools.installHints?.[kind];
  return (
    <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {NET_KIND_META[kind].label} isn't installed on this computer — you can still save the profile.
        {hint && (
          <div className="mt-1 flex items-center gap-1.5">
            <code className="selectable rounded bg-app px-1.5 py-0.5 font-mono text-[11px] text-fg">{hint}</code>
            <IconButton title="Copy install command" onClick={() => void copyText(hint)}><Copy className="size-3" /></IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function ElevationNote({ kind, tools }: { kind: NetKind; tools: NetTools | null }) {
  const how = tools?.elevation === "osascript" ? "a macOS password dialog"
    : tools?.elevation === "pkexec" ? "a system (polkit) prompt"
    : tools?.elevation === "uac" ? "a Windows UAC prompt"
    : tools?.elevation === "none" ? null : "the system";
  if (!how) return null;
  return (
    <div className="mt-3 flex items-start gap-1.5 text-[11px] text-faint">
      <Info className="mt-px size-3 shrink-0" />
      <span>
        Connecting asks for your administrator password via {how}: creating a VPN network interface requires it.
        {kind === "openvpn" ? " Disconnecting doesn't." : ""}
      </span>
    </div>
  );
}
