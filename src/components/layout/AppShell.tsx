import clsx from "clsx";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, Crosshair, Database, Folder, FolderPlus, History, LogOut, Plus, Shield, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Toaster } from "sonner";
import ConnectionDialog from "../../features/connections/ConnectionDialog";
import ConnectionTree from "../../features/connections/ConnectionTree";
import HistoryPanel from "../../features/history/HistoryPanel";
import NetworkPanel from "../../features/network/NetworkPanel";
import ClaudePanel from "../../features/claude/ClaudePanel";
import { inFocus, useConnections, useFocusProject } from "../../store/connections";
import { useContextMenu, type MenuItem } from "../../features/connections/ContextMenu";
import { createProject, focusProject } from "../../features/connections/tree/projectActions";
import { useTabs } from "../../store/tabs";
import { useUi, type SidebarView } from "../../store/ui";
import { TabContent } from "../../tabs/registry";
import { tabConnId } from "../../tabs/types";
import { IconButton } from "../ui";

export default function AppShell() {
  const load = useConnections((s) => s.load);
  useEffect(() => { load().catch(console.error); }, [load]);

  return (
    <div className="flex h-full flex-col">
      <ProjectBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <Group orientation="horizontal" className="min-w-0 flex-1">
          <Panel defaultSize="22%" minSize="14%" maxSize="45%">
            <Sidebar />
          </Panel>
          <Separator className="w-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
          <Panel minSize="40%">
            <Workspace />
          </Panel>
        </Group>
      </div>
      <StatusBar />
      <ConnectionDialog />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </div>
  );
}

function ActivityBar() {
  const { sidebar, setSidebar } = useUi();
  const item = (v: SidebarView, icon: ReactNode, title: string) => (
    <button
      title={title}
      onClick={() => setSidebar(v)}
      className={clsx(
        "relative flex size-11 items-center justify-center text-muted hover:text-fg",
        sidebar === v && "text-fg before:absolute before:left-0 before:h-6 before:w-0.5 before:rounded-r before:bg-accent",
      )}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex w-11 shrink-0 flex-col items-center border-r border-line bg-app pt-1">
      {item("connections", <Database className="size-5" />, "Connections")}
      {item("history", <History className="size-5" />, "History & saved queries")}
      {item("network", <Shield className="size-5" />, "VPN & SSH tunnels")}
      {item("claude", <Sparkles className="size-5" />, "Claude Code")}
    </div>
  );
}

function Sidebar() {
  const sidebar = useUi((s) => s.sidebar);
  const openDialog = useUi((s) => s.openConnectionDialog);
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {sidebar === "connections" ? "Connections" : sidebar === "network" ? "VPN & Tunnels" : sidebar === "claude" ? "Claude Code" : "History"}
        </span>
        {sidebar === "connections" && (
          <IconButton title="New connection" onClick={() => openDialog(null)}><Plus className="size-4" /></IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {sidebar === "connections" ? <ConnectionTree /> : sidebar === "network" ? <NetworkPanel /> : sidebar === "claude" ? <ClaudePanel /> : <HistoryPanel />}
      </div>
    </div>
  );
}

/** Top bar: project switcher; while a project is focused it shows which one and how to leave. */
function ProjectBar() {
  const projects = useConnections((s) => s.projects);
  const connections = useConnections((s) => s.connections);
  const setFocus = useConnections((s) => s.setFocus);
  const focus = useFocusProject();
  const menu = useContextMenu();

  // Native window title follows the focused project.
  useEffect(() => {
    getCurrentWindow().setTitle(focus ? `DevCat — ${focus.name}` : "DevCat").catch(() => {});
  }, [focus]);

  const count = focus ? connections.filter((c) => c.projectId === focus.id).length : 0;
  const openSwitcher = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = [
      { label: "All projects", icon: <Database className="size-3.5" />, disabled: !focus, onClick: () => setFocus(null) },
      ...(projects.length ? ["separator" as const] : []),
      ...projects.map((p): MenuItem => ({
        label: p.name,
        icon: <Folder className="size-3.5" style={{ color: p.color ?? undefined }} />,
        disabled: focus?.id === p.id,
        onClick: () => focusProject(p.id),
      })),
      "separator",
      { label: "New project…", icon: <FolderPlus className="size-3.5" />, onClick: async () => { const p = await createProject(); if (p) focusProject(p.id); } },
    ];
    menu.show({ clientX: r.left, clientY: r.bottom + 2 }, items);
  };

  return (
    <div
      className={clsx("flex h-8 shrink-0 items-center gap-2 border-b px-2 text-[12px]", focus ? "border-b-2" : "border-line bg-app")}
      style={focus ? { borderBottomColor: focus.color ?? "var(--color-accent)", background: `color-mix(in srgb, ${focus.color ?? "var(--color-accent)"} 12%, var(--color-app))` } : undefined}
    >
      <button
        onClick={openSwitcher}
        title="Switch project focus"
        className="flex h-6 max-w-72 items-center gap-1.5 rounded px-2 hover:bg-hover"
      >
        {focus ? <Crosshair className="size-3.5 shrink-0" style={{ color: focus.color ?? "var(--color-accent)" }} /> : <Database className="size-3.5 shrink-0 text-muted" />}
        <span className={clsx("truncate", focus ? "font-semibold text-fg" : "text-muted")}>{focus ? focus.name : "All projects"}</span>
        <ChevronDown className="size-3 shrink-0 text-muted" />
      </button>
      {focus && (
        <>
          <span className="rounded bg-black/25 px-1.5 py-px text-[10px] font-semibold tracking-wider text-fg/80 uppercase">Focus mode</span>
          <span className="truncate text-muted">
            {count} connection{count === 1 ? "" : "s"} · other projects are hidden
          </span>
          <button onClick={() => setFocus(null)} className="ml-auto flex h-6 items-center gap-1.5 rounded px-2 text-muted hover:bg-hover hover:text-fg">
            <LogOut className="size-3.5" />Exit focus
          </button>
        </>
      )}
      {menu.element}
    </div>
  );
}

function Workspace() {
  const { tabs: allTabs, activeId, activate, close } = useTabs();
  // Focus mode hides tabs of other projects' connections (they stay mounted and come back on exit).
  const focusId = useConnections((s) => s.focusProjectId);
  const connections = useConnections((s) => s.connections);
  const tabs = useMemo(
    () => allTabs.filter((t) => inFocus(tabConnId(t))),
    [allTabs, focusId, connections], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const hiddenCount = allTabs.length - tabs.length;
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeId) && tabs.length) activate(tabs[tabs.length - 1].id);
  }, [tabs, activeId, activate]);
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-app">
        {tabs.map((t) => (
          <div
            key={t.id}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); close(t.id); } else activate(t.id); }}
            className={clsx(
              "group flex max-w-56 shrink-0 cursor-default items-center gap-2 border-r border-line pl-3 pr-1.5",
              t.id === activeId ? "bg-panel text-fg shadow-[inset_0_2px_0_var(--color-accent)]" : "text-muted hover:bg-panel/60",
            )}
          >
            <span className="truncate">{t.title}</span>
            {t.dirty && <span className="size-1.5 rounded-full bg-accent" />}
            <button
              aria-label="Close tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => close(t.id)}
              className="rounded p-0.5 opacity-0 hover:bg-hover group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {hiddenCount > 0 && (
          <span className="ml-auto flex shrink-0 items-center px-3 text-[11px] text-faint" title="Tabs from other projects are hidden while focus mode is on">
            {hiddenCount} tab{hiddenCount === 1 ? "" : "s"} hidden by focus
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {/* Keep every tab mounted so editors and grids preserve their state. */}
        {allTabs.map((t) => (
          <div key={t.id} className={clsx("absolute inset-0", (t.id !== activeId || !tabs.includes(t)) && "hidden")}>
            <TabContent tab={t} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBar() {
  const status = useUi((s) => s.status);
  const open = useConnections((s) => s.open);
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-line bg-app px-3 text-[11px] text-muted">
      <span className="truncate">{status}</span>
      <span>{open.size} open connection{open.size === 1 ? "" : "s"}</span>
    </div>
  );
}
