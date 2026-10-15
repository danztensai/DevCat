// Diff view: changed files (Staged / Changes / Untracked) + Monaco diff of the selected file,
// stage / unstage / discard, commit, and "Ask Claude to review". `ChangesPanel` is also used by the Git tab.
import { DiffEditor, type DiffOnMount } from "../../components/DiffEditor";
import clsx from "clsx";
import { Columns2, ExternalLink, FileDiff, GitCommitHorizontal, Minus, Plus, RefreshCw, Rows2, ScanSearch, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Dialog, Empty, ErrorBox, IconButton, Spinner, Textarea } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { FileVersions, GitFile, GitStatus } from "../../lib/types";
import { refreshGit, useClaude } from "./store";
import { basename, languageOf, openFile } from "./util";

type Group = "staged" | "changes" | "untracked";
type Sel = { path: string; group: Group };

const STATUS_COLOR: Record<string, string> = {
  M: "text-warn", A: "text-ok", D: "text-danger", R: "text-info", C: "text-info", U: "text-danger", "?": "text-ok", T: "text-warn",
};

function groupFiles(files: GitFile[]) {
  const staged: GitFile[] = [], changes: GitFile[] = [], untracked: GitFile[] = [];
  for (const f of files) {
    if (f.index === "?" || f.worktree === "?") { untracked.push(f); continue; }
    if (f.index && f.index !== " " && f.index !== ".") staged.push(f);
    if (f.worktree && f.worktree !== " " && f.worktree !== ".") changes.push(f);
  }
  return { staged, changes, untracked };
}

function FileRow({ f, group, selected, onSelect, onAction }: {
  f: GitFile; group: Group; selected: boolean; onSelect: () => void; onAction: (a: "stage" | "unstage" | "discard") => void;
}) {
  const letter = group === "staged" ? f.index : group === "untracked" ? "U" : f.worktree;
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
  return (
    <div
      className={clsx("group flex h-6 cursor-pointer items-center gap-1.5 pl-3 pr-1 text-xs", selected ? "bg-accent/15 text-fg" : "text-fg/85 hover:bg-hover")}
      onClick={onSelect}
      title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
    >
      <span className="truncate">{basename(f.path)}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{dir}</span>
      <span className="hidden shrink-0 items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {group !== "staged" && <IconButton title="Discard changes" className="size-5" onClick={() => onAction("discard")}><Undo2 className="size-3" /></IconButton>}
        {group === "staged"
          ? <IconButton title="Unstage" className="size-5" onClick={() => onAction("unstage")}><Minus className="size-3" /></IconButton>
          : <IconButton title="Stage" className="size-5" onClick={() => onAction("stage")}><Plus className="size-3" /></IconButton>}
      </span>
      <span className={clsx("w-3 shrink-0 text-center font-mono text-[11px] font-semibold", STATUS_COLOR[letter] ?? "text-muted")}>{letter}</span>
    </div>
  );
}

export function DiffView({ tabId, cwd, active, onReview }: { tabId: string; cwd: string; active: boolean; onReview: () => void }) {
  const git = useClaude((s) => s.tabs[tabId]?.git);
  const gitError = useClaude((s) => s.tabs[tabId]?.gitError);
  const gitLoading = useClaude((s) => !!s.tabs[tabId]?.gitLoading);
  const gitTick = useClaude((s) => s.tabs[tabId]?.gitTick ?? 0);
  const focus = useClaude((s) => s.tabs[tabId]?.diffFocus);
  const refresh = useCallback(() => refreshGit(tabId), [tabId]);

  // The tab header polls git every 5s while visible; refresh right away when shown.
  useEffect(() => {
    if (active) void refreshGit(tabId);
  }, [active, tabId]);

  return (
    <ChangesPanel cwd={cwd} git={git ?? null} gitError={gitError ?? null} gitLoading={gitLoading} gitTick={gitTick}
      focus={focus ?? null} active={active} refresh={refresh} onReview={onReview} />
  );
}

/** Working-tree changes of the repo at `cwd`, independent of where the git status comes from
 *  (the Claude tab store, or the Git tab). `refresh` must re-read the status. */
export function ChangesPanel({ cwd, git, gitError, gitLoading, gitTick, focus, active, refresh, onReview, actions }: {
  cwd: string;
  git: GitStatus | null;
  gitError: string | null;
  gitLoading: boolean;
  /** Bumped after every status poll; the open file is re-read on it. */
  gitTick: number;
  focus?: { path: string; line?: number | null; seq: number } | null;
  active: boolean;
  refresh: () => Promise<void> | void;
  onReview?: () => void;
  /** Extra buttons on the right of the file list toolbar. */
  actions?: ReactNode;
}) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [versions, setVersions] = useState<FileVersions | null>(null);
  const [vErr, setVErr] = useState<string | null>(null);
  const [vLoading, setVLoading] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const [msg, setMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null);
  const editorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);
  const revealLine = useRef<number | null>(null);

  const groups = useMemo(() => groupFiles(git?.files ?? []), [git]);

  // Keep the selection valid; pick the first file by default.
  useEffect(() => {
    if (!git?.files) return;
    const list: Sel[] = [
      ...groups.staged.map((f) => ({ path: f.path, group: "staged" as const })),
      ...groups.changes.map((f) => ({ path: f.path, group: "changes" as const })),
      ...groups.untracked.map((f) => ({ path: f.path, group: "untracked" as const })),
    ];
    if (sel && list.some((x) => x.path === sel.path && x.group === sel.group)) return;
    const samePath = sel && list.find((x) => x.path === sel.path);
    setSel(samePath || list[0] || null);
  }, [git, groups, sel]);

  // Focus requests from the review view.
  useEffect(() => {
    if (!focus || !git?.files) return;
    const root = (git.root ?? cwd).replace(/[\\/]+$/, "");
    const rel = focus.path.startsWith(root + "/") ? focus.path.slice(root.length + 1) : focus.path.replace(/^\.\//, "");
    const f = git.files.find((x) => x.path === rel || rel.endsWith("/" + x.path) || x.path.endsWith("/" + rel));
    if (!f) return;
    const g = groupFiles([f]);
    setSel({ path: f.path, group: g.changes.length ? "changes" : g.staged.length ? "staged" : "untracked" });
    revealLine.current = focus.line ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.seq, git?.files]);

  const loadVersions = useCallback(async (s: Sel | null, quiet = false) => {
    if (!s) return setVersions(null);
    if (!quiet) setVLoading(true);
    try {
      const v = await api.gitFileVersions(cwd, s.path, s.group === "staged");
      // Same content → keep the object so the editor isn't touched.
      setVersions((cur) => (cur && cur.original === v.original && cur.modified === v.modified && cur.binary === v.binary ? cur : v));
      setVErr(null);
    } catch (e) {
      if (!quiet) {
        setVErr(errMsg(e));
        setVersions(null);
      }
    } finally {
      if (!quiet) setVLoading(false);
    }
  }, [cwd]);

  useEffect(() => { void loadVersions(sel); }, [sel, loadVersions]);
  // Re-read the open file on each git poll while visible (Claude edits it from the terminal).
  useEffect(() => { if (gitTick && active) void loadVersions(sel, true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gitTick]);

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(errMsg(e));
    }
    await refresh();
    void loadVersions(sel);
  };

  const onAction = (f: GitFile, group: Group, a: "stage" | "unstage" | "discard") => {
    if (a === "stage") return void act(() => api.gitStage(cwd, [f.path]));
    if (a === "unstage") return void act(() => api.gitUnstage(cwd, [f.path]));
    setConfirm({
      title: "Discard changes?",
      body: group === "untracked" ? `Delete untracked file ${f.path}? This cannot be undone.` : `Discard all unstaged changes in ${f.path}? This cannot be undone.`,
      run: () => act(() => api.gitDiscard(cwd, [f.path])),
    });
  };

  const commit = async () => {
    if (!msg.trim()) return;
    setCommitting(true);
    try {
      const out = await api.gitCommit(cwd, msg.trim());
      toast.success(out?.split("\n")[0] || "Committed");
      setMsg("");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCommitting(false);
      void refresh();
    }
  };

  const onMount: DiffOnMount = (ed) => {
    editorRef.current = ed;
  };
  useEffect(() => {
    const line = revealLine.current;
    if (!line || !versions || !editorRef.current) return;
    revealLine.current = null;
    const m = editorRef.current.getModifiedEditor();
    setTimeout(() => {
      m.revealLineInCenter(line);
      m.setPosition({ lineNumber: line, column: 1 });
    }, 50);
  }, [versions]);

  if (!git && gitError) return <ErrorBox error={gitError} />;
  if (!git) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!git.isRepo) {
    return (
      <Empty icon={<FileDiff className="size-8" />} title="Not a git repository">
        {basename(cwd)} isn't tracked by git, so there is nothing to diff. Run <code className="text-accent">git init</code> in the folder to track changes.
      </Empty>
    );
  }

  const section = (title: string, list: GitFile[], group: Group) =>
    list.length > 0 && (
      <div className="pb-1">
        <div className="flex h-6 items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span className="flex-1">{title}</span>
          <span className="font-normal text-faint">{list.length}</span>
          {group === "staged"
            ? <IconButton title="Unstage all" className="size-5" onClick={() => void act(() => api.gitUnstage(cwd, list.map((f) => f.path)))}><Minus className="size-3" /></IconButton>
            : <IconButton title="Stage all" className="size-5" onClick={() => void act(() => api.gitStage(cwd, list.map((f) => f.path)))}><Plus className="size-3" /></IconButton>}
        </div>
        {list.map((f) => (
          <FileRow key={group + f.path} f={f} group={group} selected={sel?.path === f.path && sel.group === group}
            onSelect={() => setSel({ path: f.path, group })} onAction={(a) => onAction(f, group, a)} />
        ))}
      </div>
    );

  const unstaged = [...groups.changes, ...groups.untracked];
  const root = git.root ?? cwd;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
          <IconButton title="Refresh" onClick={() => void refresh()}><RefreshCw className={clsx("size-3.5", gitLoading && "animate-spin")} /></IconButton>
          <IconButton title="Stage all" disabled={!unstaged.length} onClick={() => void act(() => api.gitStage(cwd, unstaged.map((f) => f.path)))}><Plus className="size-3.5" /></IconButton>
          <div className="flex-1" />
          {actions}
          {onReview && <Button size="sm" variant="ghost" onClick={onReview} title="Ask Claude to review these changes"><ScanSearch className="size-3.5" />Ask Claude to review</Button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {git.files.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted">Working tree clean</div>}
          {section("Staged", groups.staged, "staged")}
          {section("Changes", groups.changes, "changes")}
          {section("Untracked", groups.untracked, "untracked")}
        </div>
        <div className="shrink-0 border-t border-line p-2">
          <Textarea
            rows={2}
            className="resize-none font-sans text-xs"
            placeholder={groups.staged.length ? `Commit message (${groups.staged.length} staged) — ⌘↵ to commit` : "Stage files to commit"}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); } }}
          />
          <Button variant="primary" className="mt-1.5 w-full justify-center" loading={committing} disabled={!msg.trim() || !groups.staged.length} onClick={() => void commit()}>
            <GitCommitHorizontal className="size-3.5" />Commit
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-xs">
          {sel ? (
            <>
              <span className="truncate font-mono text-fg/90">{sel.path}</span>
              <span className="text-faint">{sel.group === "staged" ? "HEAD ↔ index" : sel.group === "untracked" ? "new file" : "index ↔ working tree"}</span>
              {vLoading && <Spinner className="size-3" />}
              <div className="flex-1" />
              <IconButton title="Open file" onClick={() => openFile(root, sel.path)}><ExternalLink className="size-3.5" /></IconButton>
              <IconButton title={sideBySide ? "Inline view" : "Side-by-side view"} onClick={() => setSideBySide(!sideBySide)}>
                {sideBySide ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
              </IconButton>
            </>
          ) : <span className="text-faint">No file selected</span>}
        </div>
        <div className="relative min-h-0 flex-1">
          {vErr ? <ErrorBox error={vErr} /> : !sel ? (
            <Empty icon={<FileDiff className="size-8" />} title="No changes">Edits made by Claude or by you show up here.</Empty>
          ) : versions?.binary ? (
            <Empty title="Binary file">This file is binary; no text diff available.</Empty>
          ) : versions ? (
            <DiffEditor
              theme="devcat"
              original={versions.original}
              modified={versions.modified}
              language={languageOf(sel.path)}
              onMount={onMount}
              options={{
                readOnly: true, renderSideBySide: sideBySide, minimap: { enabled: false }, fontSize: 12,
                scrollBeyondLastLine: false, automaticLayout: true, renderOverviewRuler: false, originalEditable: false,
                hideUnchangedRegions: { enabled: true },
              }}
            />
          ) : null}
        </div>
      </div>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { const c = confirm; setConfirm(null); void c?.run(); }}>Discard</Button>
          </>
        }
      >
        <div className="text-[13px] text-fg/90">{confirm?.body}</div>
      </Dialog>
    </div>
  );
}
