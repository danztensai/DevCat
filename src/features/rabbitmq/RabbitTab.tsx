// RabbitMQ management console: overview, queues, exchanges, connections, … over the management HTTP API.
import clsx from "clsx";
import {
  ArrowLeftRight, Boxes, Cable, Inbox, LayoutDashboard, Plug, Regex, RefreshCw, Search, Server, ShieldCheck, UserCheck, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton, Input, Select } from "../../components/ui";
import { errMsg } from "../../lib/api";
import { useConnections } from "../../store/connections";
import type { Tab } from "../../tabs/types";
import { AccessView, NodesView, VhostsView } from "./AdminViews";
import { rmq } from "./api";
import { ChannelsView, ConnectionsView, ConsumersView } from "./ConnectionsView";
import { Ctx, type Focus, type RabbitCtx, type View } from "./context";
import ExchangesView from "./ExchangesView";
import Overview from "./Overview";
import { ErrorBanner, ViewBoundary } from "./parts";
import QueuesView from "./QueuesView";

const NAV: { id: View; label: string; icon: ReactNode; searchable: boolean }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="size-3.5" />, searchable: false },
  { id: "queues", label: "Queues", icon: <Inbox className="size-3.5" />, searchable: true },
  { id: "exchanges", label: "Exchanges", icon: <ArrowLeftRight className="size-3.5" />, searchable: true },
  { id: "connections", label: "Connections", icon: <Plug className="size-3.5" />, searchable: true },
  { id: "channels", label: "Channels", icon: <Cable className="size-3.5" />, searchable: true },
  { id: "consumers", label: "Consumers", icon: <UserCheck className="size-3.5" />, searchable: true },
  { id: "vhosts", label: "Vhosts", icon: <Boxes className="size-3.5" />, searchable: true },
  { id: "access", label: "Users & Policies", icon: <ShieldCheck className="size-3.5" />, searchable: true },
  { id: "nodes", label: "Nodes", icon: <Server className="size-3.5" />, searchable: false },
];

const INTERVALS: [number, string][] = [[0, "Off"], [2000, "2s"], [5000, "5s"], [10000, "10s"], [30000, "30s"]];

export default function RabbitTab({ tab }: { tab: Extract<Tab, { type: "rabbitmq" }> }) {
  const profile = useConnections((s) => s.connections.find((c) => c.id === tab.connId));
  const [view, setView] = useState<View>("overview");
  const [vhost, setVhost] = useState<string>(profile?.database ?? "");
  // the profile's default vhost, once the connection list is available
  const vhostInit = useRef(!!profile);
  useEffect(() => {
    if (vhostInit.current || !profile) return;
    vhostInit.current = true;
    if (profile.database) setVhost(profile.database);
  }, [profile]);
  const [vhosts, setVhosts] = useState<string[]>([]);
  const [vhostError, setVhostError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5000);
  const [tick, setTick] = useState(0);
  const [focus, setFocus] = useState<Focus | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // auto refresh
  useEffect(() => {
    if (!intervalMs) return;
    const h = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(h);
  }, [intervalMs]);

  // debounce the search box
  useEffect(() => {
    const h = window.setTimeout(() => setSearch(searchInput), 250);
    return () => window.clearTimeout(h);
  }, [searchInput]);

  const loadVhosts = useCallback(async () => {
    try {
      const list = await rmq.list<{ name: string }>(tab.connId, "vhosts");
      setVhosts(list.map((v) => v.name).sort());
      setVhostError(null);
    } catch (e) {
      setVhostError(errMsg(e));
    }
  }, [tab.connId]);
  useEffect(() => { void loadVhosts(); }, [loadVhosts]);

  const go = (v: View) => {
    if (v !== view) { setSearchInput(""); setSearch(""); }
    setView(v);
  };

  const ctx = useMemo<RabbitCtx>(() => ({
    connId: tab.connId,
    readOnly: profile?.readOnly ?? false,
    vhost, vhosts, search, useRegex, tick, refresh, focus,
    open: (f) => { setSearchInput(""); setSearch(""); setView(f.view); setFocus({ ...f }); },
  }), [tab.connId, profile?.readOnly, vhost, vhosts, search, useRegex, tick, refresh, focus]);

  const nav = NAV.find((n) => n.id === view)!;
  const vhostOptions = vhost && !vhosts.includes(vhost) ? [vhost, ...vhosts] : vhosts;

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col bg-app">
        {/* top bar */}
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
          <span className="truncate text-xs font-semibold text-fg/90">{profile?.name ?? "RabbitMQ"}</span>
          {profile?.readOnly && <span className="rounded bg-warn/15 px-1.5 text-[10px] font-medium text-warn">read-only</span>}
          <div className="mx-1 h-4 w-px bg-line" />
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            Vhost
            <Select className="h-6 !w-40 text-xs" value={vhost} onChange={(e) => setVhost(e.target.value)}>
              <option value="">All vhosts</option>
              {vhostOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </label>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-faint" />
            <Input
              className="h-6 pl-6 pr-12 text-xs"
              placeholder={nav.searchable ? `Filter ${nav.label.toLowerCase()} by name${useRegex ? " (regex)" : ""}` : "Search not available here"}
              disabled={!nav.searchable}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearchInput("")}
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
              {searchInput && <IconButton title="Clear" className="size-5" onClick={() => setSearchInput("")}><X className="size-3" /></IconButton>}
              <IconButton title="Regular expression" className="size-5" active={useRegex} onClick={() => setUseRegex(!useRegex)} disabled={!nav.searchable}>
                <Regex className="size-3" />
              </IconButton>
            </div>
          </div>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            Refresh
            <Select className="h-6 !w-16 text-xs" value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))}>
              {INTERVALS.map(([ms, l]) => <option key={ms} value={ms}>{l}</option>)}
            </Select>
          </label>
          <IconButton title="Refresh now" onClick={() => { refresh(); void loadVhosts(); }}>
            <RefreshCw className="size-3.5" />
          </IconButton>
        </div>

        {vhostError && <ErrorBanner error={`Cannot reach the management API: ${vhostError}`} onRetry={() => { void loadVhosts(); refresh(); }} />}

        <div className="flex min-h-0 flex-1">
          {/* left nav */}
          <nav className="flex w-44 shrink-0 flex-col gap-px border-r border-line bg-panel p-1.5">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={clsx(
                  "flex h-7 items-center gap-2 rounded px-2 text-left text-xs",
                  n.id === view ? "bg-accent/15 font-medium text-accent" : "text-muted hover:bg-hover hover:text-fg",
                )}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
            <div className="flex-1" />
            <div className="px-2 pb-1 text-[10px] leading-snug text-faint">
              {intervalMs ? `Auto-refresh every ${intervalMs / 1000}s` : "Auto-refresh off"}
            </div>
          </nav>

          <main className="min-h-0 min-w-0 flex-1">
            <ViewBoundary resetKey={view}>
            {view === "overview" && <Overview />}
            {view === "queues" && <QueuesView />}
            {view === "exchanges" && <ExchangesView />}
            {view === "connections" && <ConnectionsView />}
            {view === "channels" && <ChannelsView />}
            {view === "consumers" && <ConsumersView />}
            {view === "vhosts" && <VhostsView onPick={(v) => { setVhost(v); go("queues"); }} />}
            {view === "access" && <AccessView />}
            {view === "nodes" && <NodesView />}
            </ViewBoundary>
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
