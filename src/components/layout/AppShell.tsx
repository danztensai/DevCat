import clsx from "clsx";
import { Database, History, Plus, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Toaster } from "sonner";
import ConnectionDialog from "../../features/connections/ConnectionDialog";
import ConnectionTree from "../../features/connections/ConnectionTree";
import HistoryPanel from "../../features/history/HistoryPanel";
import { useConnections } from "../../store/connections";
import { useTabs } from "../../store/tabs";
import { useUi, type SidebarView } from "../../store/ui";
import { TabContent } from "../../tabs/registry";
import { IconButton } from "../ui";

export default function AppShell() {
  const load = useConnections((s) => s.load);
  useEffect(() => { load().catch(console.error); }, [load]);

  return (
    <div className="flex h-full flex-col">
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
          {sidebar === "connections" ? "Connections" : "History"}
        </span>
        {sidebar === "connections" && (
          <IconButton title="New connection" onClick={() => openDialog(null)}><Plus className="size-4" /></IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {sidebar === "connections" ? <ConnectionTree /> : <HistoryPanel />}
      </div>
    </div>
  );
}

function Workspace() {
  const { tabs, activeId, activate, close } = useTabs();
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
      </div>
      <div className="relative min-h-0 flex-1">
        {/* Keep every tab mounted so editors and grids preserve their state. */}
        {tabs.map((t) => (
          <div key={t.id} className={clsx("absolute inset-0", t.id !== activeId && "hidden")}>
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
