// Sidebar: VPN and SSH tunnel profiles with live status and quick connect/disconnect.
import clsx from "clsx";
import { AlertTriangle, Cable, Copy, FileUp, Pencil, Plus, Power, PowerOff, RefreshCw, ScrollText, Search, Shield, ShieldHalf, Terminal, Trash2, X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Button, Empty, ErrorBox, IconButton, Spinner } from "../../components/ui";
import type { NetKind, NetProfile } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { useTabs } from "../../store/tabs";
import { useContextMenu, type MenuItem } from "../connections/ContextMenu";
import {
  connectProfile, deleteProfile, disconnectProfile, duplicateProfile, importProfileFile, openNewProfile, openProfileTab, toggleProfile,
} from "./actions";
import { copyText, isBusy, isUp, isVpn, NET_KIND_META, NetKindIcon, portsLabel, StatusDot, Switch } from "./meta";
import { InstallToolButton } from "./InstallToolButton";
import { PasswordlessVpnRow } from "./PasswordlessVpn";
import { SshConfigImportDialog } from "./SshConfigImport";
import { useNet, useScopedNetProfiles, fmtRate } from "./store";

export default function NetworkPanel() {
  const profiles = useScopedNetProfiles();
  const loaded = useNet((s) => s.loaded);
  const error = useNet((s) => s.error);
  const tools = useNet((s) => s.tools);
  const focus = useConnections((s) => s.focusProjectId);
  const [query, setQuery] = useState("");
  const [sshImport, setSshImport] = useState(false);
  const menu = useContextMenu();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? profiles.filter((p) => p.name.toLowerCase().includes(q) || (p.summary ?? "").toLowerCase().includes(q)) : profiles;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, query]);
  const vpns = filtered.filter((p) => isVpn(p.kind));
  const tunnels = filtered.filter((p) => !isVpn(p.kind));

  const addItems: MenuItem[] = [
    { label: "Import file…", icon: <FileUp className="size-3.5" />, onClick: () => void importProfileFile() },
    "separator",
    { label: "New OpenVPN", icon: <Shield className="size-3.5" />, onClick: () => openNewProfile("openvpn") },
    { label: "New WireGuard", icon: <ShieldHalf className="size-3.5" />, onClick: () => openNewProfile("wireguard") },
    { label: "New SSH tunnel", icon: <Cable className="size-3.5" />, onClick: () => openNewProfile("ssh") },
    { label: "New Kubernetes port-forward", icon: <NetKindIcon kind="k8s" />, onClick: () => openNewProfile("k8s") },
    "separator",
    { label: "Import from ~/.ssh/config…", icon: <Terminal className="size-3.5" />, onClick: () => setSshImport(true) },
  ];
  const showAdd = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.show({ clientX: r.left, clientY: r.bottom + 2 }, addItems);
  };

  const refresh = () => {
    const s = useNet.getState();
    void s.load();
    void s.loadStatus();
    void s.loadTools();
    void s.loadHelper();
  };

  const missing = (kind: NetKind) => tools !== null && isVpn(kind) && !tools[kind as "openvpn" | "wireguard"];
  /** Missing and DevCat can't install it: connecting is pointless. */
  const blocked = (kind: NetKind) => missing(kind) && !tools?.installable?.[kind];

  // Arrow keys move between rows.
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-net-row]"));
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) { e.preventDefault(); next.focus(); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Filter"
            spellCheck={false}
            className="h-6 w-full rounded border border-line bg-app pr-6 pl-7 text-[12px] placeholder:text-faint focus:border-accent focus:outline-none"
          />
          {query && (
            <button className="absolute top-1/2 right-1.5 -translate-y-1/2 text-faint hover:text-fg" title="Clear" onClick={() => setQuery("")}>
              <X className="size-3" />
            </button>
          )}
        </div>
        <IconButton title="Refresh" onClick={refresh}><RefreshCw className="size-3.5" /></IconButton>
        <IconButton title="Add VPN or SSH tunnel" onClick={showAdd}><Plus className="size-4" /></IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1" onKeyDown={onListKey}>
        {!loaded ? (
          <div className="flex h-24 items-center justify-center"><Spinner /></div>
        ) : error && !profiles.length ? (
          <>
            <ErrorBox error={error} />
            <div className="px-3"><Button size="sm" onClick={refresh}><RefreshCw className="size-3" />Retry</Button></div>
          </>
        ) : !profiles.length ? (
          <Empty icon={<Shield className="size-8" />} title="No VPNs or tunnels">
            <div className="mb-3">Import an OpenVPN / WireGuard file or set up an SSH tunnel. Connections can then depend on it.</div>
            <div className="flex flex-col items-stretch gap-1.5">
              <Button size="sm" variant="primary" onClick={() => void importProfileFile()}><FileUp className="size-3.5" />Import .ovpn / .conf…</Button>
              <Button size="sm" onClick={() => openNewProfile("ssh")}><Cable className="size-3.5" />New SSH tunnel</Button>
              <Button size="sm" onClick={() => openNewProfile("k8s")}><NetKindIcon kind="k8s" />Kubernetes port-forward</Button>
              <div className="flex gap-1.5">
                <Button size="sm" className="flex-1 justify-center" onClick={() => openNewProfile("openvpn")}>OpenVPN</Button>
                <Button size="sm" className="flex-1 justify-center" onClick={() => openNewProfile("wireguard")}>WireGuard</Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSshImport(true)}><Terminal className="size-3.5" />Import from ~/.ssh/config…</Button>
            </div>
          </Empty>
        ) : !filtered.length ? (
          <div className="px-3 py-2 text-[12px] italic text-faint">No profile matches “{query}”.</div>
        ) : (
          <>
            {vpns.length > 0 && (
              <Group title="VPN" count={vpns.length}>
                {(["openvpn", "wireguard"] as const).filter((k) => missing(k) && vpns.some((p) => p.kind === k)).map((k) => (
                  <ToolWarning key={k} kind={k} hint={tools?.installHints?.[k]} installVersion={tools?.installable?.[k]} />
                ))}
                <PasswordlessVpnRow kinds={(["openvpn", "wireguard"] as const).filter((k) => vpns.some((p) => p.kind === k))} />
                {vpns.map((p) => <ProfileRow key={p.id} p={p} focused={!!focus} toolMissing={blocked(p.kind)} menu={menu.show} />)}
              </Group>
            )}
            {tunnels.length > 0 && (
              <Group title="SSH tunnels" count={tunnels.length}>
                {tunnels.map((p) => <ProfileRow key={p.id} p={p} focused={!!focus} toolMissing={false} menu={menu.show} />)}
              </Group>
            )}
          </>
        )}
      </div>
      <SshConfigImportDialog open={sshImport} onClose={() => setSshImport(false)} />
      {menu.element}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="flex h-6 items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
        <span>{title}</span>
        <span className="font-normal">{count}</span>
      </div>
      {children}
    </div>
  );
}

function ToolWarning({ kind, hint, installVersion }: { kind: NetKind; hint?: string; installVersion?: string }) {
  return (
    <div className="mx-2 mb-1 flex items-start gap-1.5 rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
      <AlertTriangle className="mt-px size-3 shrink-0" />
      <div className="min-w-0 flex-1">
        {NET_KIND_META[kind].label} isn't installed.
        {installVersion ? (
          <InstallToolButton kind={kind as "openvpn" | "wireguard"} version={installVersion} className="mt-1" />
        ) : hint && (
          <button
            className="mt-0.5 flex max-w-full items-center gap-1 rounded bg-app/60 px-1 font-mono text-[10.5px] text-fg/90 hover:bg-app"
            title="Copy install command"
            onClick={() => void copyText(hint)}
          >
            <span className="truncate">{hint}</span><Copy className="size-2.5 shrink-0" />
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileRow({ p, focused, toolMissing, menu }: {
  p: NetProfile;
  focused: boolean;
  toolMissing: boolean;
  menu: (e: MouseEvent | { clientX: number; clientY: number }, items: MenuItem[]) => void;
}) {
  const st = useNet((s) => s.statuses[p.id]);
  const state = st?.state;
  const active = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return t?.type === "network" && t.profileId === p.id;
  });
  const ports = portsLabel(st);
  const up = isUp(state);

  const items = (): MenuItem[] => [
    up
      ? { label: state === "connecting" ? "Cancel connecting" : "Disconnect", icon: <PowerOff className="size-3.5" />, onClick: () => void disconnectProfile(p) }
      : { label: "Connect", icon: <Power className="size-3.5" />, disabled: toolMissing || state === "disconnecting", onClick: () => void connectProfile(p) },
    "separator",
    { label: "Edit", icon: <Pencil className="size-3.5" />, onClick: () => openProfileTab(p, "settings") },
    { label: "Duplicate", icon: <Copy className="size-3.5" />, onClick: () => void duplicateProfile(p) },
    { label: "Show logs", icon: <ScrollText className="size-3.5" />, onClick: () => openProfileTab(p, "logs") },
    ...(ports ? [{ label: `Copy 127.0.0.1:${st!.localPorts[0]}`, icon: <Copy className="size-3.5" />, onClick: () => void copyText(`127.0.0.1:${st!.localPorts[0]}`) }] : []),
    "separator",
    { label: "Delete…", icon: <Trash2 className="size-3.5" />, danger: true, onClick: () => void deleteProfile(p) },
  ];

  const lastTraffic = useNet((s) => s.traffic[p.id]?.[s.traffic[p.id].length - 1]);
  const title = [p.name, p.summary, st?.error ? `Error: ${st.error}` : st?.detail].filter(Boolean).join("\n");

  return (
    <div
      data-net-row
      tabIndex={0}
      title={title}
      onClick={() => openProfileTab(p)}
      onContextMenu={(e) => menu(e, items())}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); openProfileTab(p); }
        else if (e.key === " ") { e.preventDefault(); if (!toolMissing || up) void toggleProfile(p); }
        else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          menu({ clientX: r.left + 24, clientY: r.bottom }, items());
        } else if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) { e.preventDefault(); void deleteProfile(p); }
      }}
      className={clsx(
        "group relative flex h-7 cursor-default items-center gap-1.5 pr-2 pl-3 text-[13px] outline-none focus-visible:bg-accent/15",
        active ? "bg-hover" : "hover:bg-hover/60",
      )}
    >
      {p.color && <span className="absolute inset-y-1 left-0 w-[3px] rounded-r" style={{ background: p.color }} />}
      <NetKindIcon kind={p.kind} className="size-3.5 shrink-0" />
      <span className={clsx("min-w-0 shrink truncate", state === "connected" ? "text-fg" : "text-fg/85")}>{p.name}</span>
      {focused && !p.projectId && <span className="shrink-0 rounded bg-hover px-1 text-[10px] text-faint" title="Not assigned to a project — visible in every project">shared</span>}
      {st?.state === "connected" && lastTraffic ? (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] tabular-nums" title="Download / upload">
          <span className="text-ok">↓{fmtRate(lastTraffic.rxRate)}</span> <span className="text-accent">↑{fmtRate(lastTraffic.txRate)}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{p.summary}</span>
      )}
      {ports && <span className="shrink-0 font-mono text-[11px] text-ok" title="Local ports on 127.0.0.1">{ports}</span>}
      {toolMissing && <span title={`${NET_KIND_META[p.kind].label} isn't installed`}><AlertTriangle className="size-3 shrink-0 text-warn" /></span>}
      {state === "error" && <span title={st?.error ?? "Error"}><AlertTriangle className="size-3 shrink-0 text-danger" /></span>}
      <StatusDot state={state} />
      <Switch
        on={up}
        busy={isBusy(state)}
        disabled={(toolMissing && !up) || state === "disconnecting"}
        title={up ? (state === "connecting" ? "Cancel" : "Disconnect") : "Connect"}
        onChange={() => void toggleProfile(p)}
      />
    </div>
  );
}
