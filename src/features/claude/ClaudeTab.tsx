// Claude Code workspace tab, like Claude Code in iTerm2: the interactive `claude` TUI in a terminal
// (Chat), plus Diff and Code Review views, a git branch chip and a review badge in the header.
// ⌥⇧⌘1/2/3 switch views when the tab is active. Optional bottom split with a login shell.
import clsx from "clsx";
import {
  AlertOctagon, AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, GitBranch, MessageSquarePlus, RotateCcw, ScanSearch, SquareTerminal, Terminal,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { toast } from "sonner";
import { Button, Dialog, Empty, IconButton, Select, Spinner } from "../../components/ui";
import type { ClaudePermissionMode } from "../../lib/types";
import { useTabs } from "../../store/tabs";
import type { Tab } from "../../tabs/types";
import { CopyButton, CodeBlock } from "./Markdown";
import { DiffView } from "./DiffView";
import type { ClaudeView } from "./open";
import { ReviewView, reviewBadge } from "./ReviewView";
import {
  claudeLaunchArgs, detectSession, ensureTab, loadInfo, newSession, pasteToClaude, refreshGit, restartClaude, setLaunchOptions, setPty,
  startReview, useClaude, type Finding,
} from "./store";
import { TerminalPane } from "./TerminalPane";
import { basename, modelOptions, PERMISSION_MODES } from "./util";

type ClaudeTabT = Extract<Tab, { type: "claude" }>;

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

const VIEWS: Array<{ id: ClaudeView; label: string; key: string }> = [
  { id: "chat", label: "Chat", key: "1" },
  { id: "diff", label: "Diff", key: "2" },
  { id: "review", label: "Code Review", key: "3" },
];

function BranchChip({ tabId, onClick }: { tabId: string; onClick: () => void }) {
  const git = useClaude((s) => s.tabs[tabId]?.git);
  if (!git) return null;
  if (!git.isRepo) return <span className="text-[11px] text-faint">no git</span>;
  const n = git.files.length;
  return (
    <button type="button" onClick={onClick} title={`${git.root ?? ""}${n ? ` — ${n} changed file${n === 1 ? "" : "s"}` : ""}`}
      className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-[11px] text-muted hover:bg-hover">
      <GitBranch className="size-3" />
      <span className="max-w-40 truncate text-fg/90">{git.branch ?? "detached"}</span>
      {git.ahead > 0 && <span className="inline-flex items-center text-info"><ArrowUp className="size-3" />{git.ahead}</span>}
      {git.behind > 0 && <span className="inline-flex items-center text-warn"><ArrowDown className="size-3" />{git.behind}</span>}
      {n > 0 && <span className="text-warn">• {n}</span>}
    </button>
  );
}

function ReviewBadge({ tabId, onClick }: { tabId: string; onClick: () => void }) {
  const r = useClaude((s) => s.tabs[tabId]?.review);
  const b = reviewBadge(r);
  if (b.kind === "none") return null;
  return (
    <button type="button" onClick={onClick} title="Code review"
      className={clsx("inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px]",
        b.kind === "running" && "border-line text-muted",
        b.kind === "ok" && "border-ok/40 text-ok",
        b.kind === "error" && "border-danger/40 text-danger",
        b.kind === "issues" && (b.worst === "critical" ? "border-danger/40 text-danger" : "border-warn/40 text-warn"))}>
      {b.kind === "running" && <><Spinner className="size-3" />Reviewing</>}
      {b.kind === "ok" && <><CheckCircle2 className="size-3" />No issues</>}
      {b.kind === "error" && <><AlertOctagon className="size-3" />Review failed</>}
      {b.kind === "issues" && <><AlertTriangle className="size-3" />{b.count ? `${b.count} finding${b.count === 1 ? "" : "s"}` : "Review"}</>}
    </button>
  );
}

function InstallHelp({ onRetry, error }: { onRetry: () => void; error?: string | null }) {
  return (
    <Empty icon={<Terminal className="size-8" />} title="Claude Code is not installed">
      <div className="flex flex-col gap-2 text-left">
        <p>DevCat runs your local <code className="text-accent">claude</code> CLI. Install it, then run <code className="text-accent">claude</code> once in a terminal to log in.</p>
        <div className="text-[11px] text-muted">macOS / Linux</div>
        <CodeBlock code="curl -fsSL https://claude.ai/install.sh | bash" lang="sh" />
        <div className="text-[11px] text-muted">Windows (PowerShell)</div>
        <CodeBlock code="irm https://claude.ai/install.ps1 | iex" lang="powershell" />
        {error && <p className="text-[11px] text-danger">{error}</p>}
        <Button className="self-center" onClick={onRetry}>Check again</Button>
      </div>
    </Empty>
  );
}

/** Model / permission mode the claude process is launched with; offers a restart when changed. */
function LaunchOptions({ tabId, onBypass }: { tabId: string; onBypass: () => void }) {
  const info = useClaude((s) => s.info);
  const options = useClaude((s) => s.tabs[tabId]?.options);
  const launched = useClaude((s) => s.tabs[tabId]?.launched);
  const models = useMemo(() => modelOptions(info?.models), [info]);
  if (!options) return null;
  const changed = !!launched && (launched.model !== options.model || launched.permissionMode !== options.permissionMode);
  return (
    <>
      <Select className="h-6 w-24 text-xs" value={options.model} title="Model claude starts with (use /model to switch mid-session)"
        onChange={(e) => setLaunchOptions(tabId, { model: e.target.value })}>
        {models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
      <Select
        className={clsx("h-6 w-36 text-xs", options.permissionMode === "bypassPermissions" && "border-danger/60 text-danger")}
        value={options.permissionMode}
        title="Permission mode claude starts with (⇧Tab cycles modes in the TUI)"
        onChange={(e) => {
          const m = e.target.value as ClaudePermissionMode | "";
          if (m === "bypassPermissions") onBypass();
          else setLaunchOptions(tabId, { permissionMode: m });
        }}
      >
        <option value="">Default mode</option>
        {PERMISSION_MODES.filter((m) => m.value !== "manual").map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
      {changed && (
        <Button size="sm" variant="primary" onClick={() => void restartClaude(tabId)} title="Restart claude with these options, resuming the session">
          <RotateCcw className="size-3" />Restart claude
        </Button>
      )}
    </>
  );
}

function SessionChip({ tabId }: { tabId: string }) {
  const sid = useClaude((s) => s.tabs[tabId]?.sessionId);
  if (!sid) return null;
  return (
    <span className="inline-flex items-center text-[10px] text-faint" title={`Session ${sid}`}>
      <span className="font-mono">{sid.slice(0, 8)}</span><CopyButton text={sid} />
    </span>
  );
}

function ChatPane({ tabId, cwd, visible }: { tabId: string; cwd: string; visible: boolean }) {
  const startSeq = useClaude((s) => s.tabs[tabId]?.startSeq ?? 0);
  const shellOpen = useClaude((s) => s.tabs[tabId]?.shellOpen ?? false);
  const [shellMounted, setShellMounted] = useState(false);
  const shellPanel = usePanelRef();

  useLayoutEffect(() => {
    const p = shellPanel.current;
    if (!p) return;
    if (shellOpen) {
      setShellMounted(true);
      if (p.isCollapsed()) p.expand();
      if (p.getSize().asPercentage < 20) p.resize("35%");
    } else if (!p.isCollapsed()) p.collapse();
  }, [shellOpen, shellPanel]);

  return (
    <Group orientation="vertical" className="h-full">
      <Panel minSize="120px">
        <TerminalPane
          cwd={cwd}
          program="claude"
          name="claude"
          startKey={startSeq}
          visible={visible}
          shiftEnterNewline
          getArgs={() => claudeLaunchArgs(tabId)}
          beforeRestart={async () => { await detectSession(tabId); }}
          onPty={(id) => setPty(tabId, id)}
        />
      </Panel>
      <Separator className={clsx("h-px bg-line hover:bg-accent data-[separator=active]:bg-accent", !shellOpen && "pointer-events-none")} />
      <Panel
        panelRef={shellPanel}
        defaultSize="0%"
        minSize="80px"
        collapsible
        collapsedSize="0px"
        onResize={() => {
          const open = !(shellPanel.current?.isCollapsed() ?? true);
          if (open !== shellOpen) setShellOpen(tabId, open);
        }}
      >
        {shellMounted && (
          <div className="flex h-full flex-col border-t border-line">
            <div className="flex h-6 shrink-0 items-center gap-1.5 bg-panel px-2 text-[11px] text-muted">
              <SquareTerminal className="size-3" />Shell
            </div>
            <div className="min-h-0 flex-1">
              <TerminalPane cwd={cwd} program={null} name="shell" visible={visible && shellOpen} />
            </div>
          </div>
        )}
      </Panel>
    </Group>
  );
}

function setShellOpen(tabId: string, open: boolean) {
  useClaude.setState((st) => (st.tabs[tabId] ? { tabs: { ...st.tabs, [tabId]: { ...st.tabs[tabId], shellOpen: open } } } : st));
}

export default function ClaudeTab({ tab }: { tab: ClaudeTabT }) {
  const tabId = tab.id;
  const ready = useClaude((s) => !!s.tabs[tabId]);
  useLayoutEffect(() => ensureTab(tabId, tab.cwd, tab.sessionId), [tabId, tab.cwd, tab.sessionId]);
  const active = useTabs((s) => s.activeId === tabId);
  const view: ClaudeView = tab.view ?? "chat";
  const info = useClaude((s) => s.info);
  const infoLoaded = useClaude((s) => s.infoLoaded);
  const infoError = useClaude((s) => s.infoError);
  const shellOpen = useClaude((s) => s.tabs[tabId]?.shellOpen ?? false);
  const running = useClaude((s) => !!s.tabs[tabId]?.ptyId);
  const [confirmBypass, setConfirmBypass] = useState(false);

  useEffect(() => { void loadInfo(); }, []);

  const setView = useCallback((v: ClaudeView) => useTabs.getState().update(tabId, { view: v } as never), [tabId]);

  // Git status: poll every 5s while this tab is visible.
  useEffect(() => {
    if (!active) return;
    void refreshGit(tabId);
    const t = setInterval(() => void refreshGit(tabId), 5000);
    return () => clearInterval(t);
  }, [active, tabId]);

  // ⌥⇧⌘1/2/3 (Ctrl+Alt+Shift elsewhere) — only for the active tab.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      const v = VIEWS.find((x) => e.code === `Digit${x.key}`);
      if (!v) return;
      e.preventDefault();
      setView(v.id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, setView]);

  const reviewNow = () => {
    setView("review");
    void startReview(tabId);
  };

  // Paste the finding into claude's prompt (not submitted) so the user can edit it first.
  const fixFinding = async (f: Finding) => {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
    const parts = [
      `Fix this review finding${loc ? ` in ${loc}` : ""}: [${f.severity}] ${f.title}`,
      f.body ?? "",
      f.suggestion ? `Suggested fix:\n${f.suggestion}` : "",
    ].filter(Boolean);
    setView("chat");
    if (!(await pasteToClaude(tabId, parts.join("\n\n")))) toast.error("Claude isn't running in this tab — press Enter in the terminal to start it.");
  };

  const notInstalled = infoLoaded && info !== null && !info.path;
  if (!ready) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <div className="flex min-w-0 max-w-56 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold">{basename(tab.cwd)}</span>
          <span className="truncate text-[10px] text-faint" title={tab.cwd}>{tab.cwd}</span>
        </div>
        <div className="ml-1 flex h-7 shrink-0 items-center rounded-md border border-line bg-app p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              title={`${v.label} (${IS_MAC ? "⌥⇧⌘" : "Ctrl+Alt+Shift+"}${v.key})`}
              onClick={() => setView(v.id)}
              className={clsx("flex h-6 items-center gap-1.5 rounded px-2.5 text-xs", view === v.id ? "bg-raised text-fg shadow-sm" : "text-muted hover:text-fg")}
            >
              {v.label}
              <span className="text-[9px] text-faint">{IS_MAC ? `⌥⇧⌘${v.key}` : `^⌥⇧${v.key}`}</span>
            </button>
          ))}
        </div>
        <BranchChip tabId={tabId} onClick={() => setView("diff")} />
        <ReviewBadge tabId={tabId} onClick={() => setView("review")} />
        <div className="flex-1" />
        <span className={clsx("size-1.5 rounded-full", running ? "bg-ok" : "bg-faint")} title={running ? "claude is running" : "claude is not running"} />
        <SessionChip tabId={tabId} />
        <LaunchOptions tabId={tabId} onBypass={() => setConfirmBypass(true)} />
        <Button size="sm" variant="ghost" title="Start a new claude session" onClick={() => { setView("chat"); newSession(tabId); }}>
          <MessageSquarePlus className="size-3.5" />New session
        </Button>
        <IconButton title={shellOpen ? "Hide shell" : "Open a shell in this folder"} active={shellOpen}
          onClick={() => { setView("chat"); setShellOpen(tabId, !shellOpen); }}>
          <SquareTerminal className="size-3.5" />
        </IconButton>
        {view === "diff" && (
          <IconButton title="Ask Claude to review" onClick={reviewNow}><ScanSearch className="size-3.5" /></IconButton>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={clsx("absolute inset-0", view !== "chat" && "invisible")}>
          {notInstalled
            ? <InstallHelp onRetry={() => void loadInfo(true)} error={infoError} />
            : <ChatPane tabId={tabId} cwd={tab.cwd} visible={active && view === "chat"} />}
        </div>
        {view === "diff" && <div className="absolute inset-0 bg-app"><DiffView tabId={tabId} cwd={tab.cwd} active={active} onReview={reviewNow} /></div>}
        <div className={clsx("absolute inset-0 bg-app", view !== "review" && "hidden")}>
          <ReviewView tabId={tabId} cwd={tab.cwd} onFix={(f) => void fixFinding(f)} onShowDiff={() => setView("diff")} />
        </div>
      </div>
      <Dialog
        open={confirmBypass}
        onClose={() => setConfirmBypass(false)}
        title={<span className="flex items-center gap-2 text-danger"><AlertTriangle className="size-4" />Bypass all permissions?</span>}
        width={460}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmBypass(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setConfirmBypass(false); setLaunchOptions(tabId, { permissionMode: "bypassPermissions" }); }}>Bypass permissions</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-[13px] text-fg/90">
          <p>Claude will run <b>every</b> tool — shell commands, file edits and deletions, network access — without asking.</p>
          <p className="text-danger">Only use this in a sandbox or a throwaway checkout of {basename(tab.cwd)}.</p>
        </div>
      </Dialog>
    </div>
  );
}
