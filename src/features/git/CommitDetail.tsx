// Commit detail: message, author / committer, parents, refs and changed files (left),
// Monaco diff of the selected file vs the first parent (right).
import { DiffEditor } from "../../components/DiffEditor";
import clsx from "clsx";
import { Columns2, Copy, ExternalLink, FileDiff, History, MoreHorizontal, Rows2, UserSearch } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Empty, ErrorBox, IconButton, Spinner } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { FileVersions, GitCommitDetail, GitCommitFile } from "../../lib/types";
import { languageOf } from "../claude/util";
import { useContextMenu, type MenuItem } from "../connections/ContextMenu";
import { basename, copyText, openFilePreview } from "../files/format";
import { openBlame } from "./open";
import { fmtUnix, REF_STYLE, relUnix, STATUS_TONE } from "./util";

const SIDE_KEY = "devcat.git.sideBySide";

const join = (root: string, rel: string) => `${root.replace(/[\\/]+$/, "")}/${rel}`;

export function RefBadge({ name, kind }: { name: string; kind: keyof typeof REF_STYLE }) {
  return (
    <span className={clsx("inline-flex h-4 max-w-40 shrink-0 items-center rounded border px-1 font-mono text-[10px] leading-none", REF_STYLE[kind])} title={`${kind}: ${name}`}>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function CommitDetail({ repo, sha, onNavigate, onFileHistory, onMenu, header, tick }: {
  repo: string;
  sha: string;
  /** Click on a parent sha. */
  onNavigate?: (sha: string) => void;
  onFileHistory?: (path: string) => void;
  /** "More" button / right click on the header → commit context menu. */
  onMenu?: (e: MouseEvent, d: GitCommitDetail) => void;
  /** Replaces the title area (e.g. stash name + actions). */
  header?: ReactNode;
  /** Reload when this changes. */
  tick?: number;
}) {
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<GitCommitFile | null>(null);
  const [versions, setVersions] = useState<FileVersions | null>(null);
  const [vErr, setVErr] = useState<string | null>(null);
  const [vLoading, setVLoading] = useState(false);
  const [sideBySide, setSideBySide] = useState(() => localStorage.getItem(SIDE_KEY) !== "0");
  const menu = useContextMenu();

  useEffect(() => {
    let stale = false;
    setError(null);
    api.gitShow(repo, sha).then((d) => {
      if (stale) return;
      setDetail(d);
      // Keep the selected file when it's also in this commit (walking through a file's history).
      setFile((cur) => d.files.find((f) => f.path === cur?.path) ?? d.files[0] ?? null);
    }).catch((e) => {
      if (!stale) { setError(errMsg(e)); setDetail(null); }
    });
    return () => { stale = true; };
  }, [repo, sha, tick]);

  useEffect(() => {
    if (!file || !detail) { setVersions(null); return; }
    let stale = false;
    setVLoading(true);
    api.gitCommitFileVersions(repo, detail.commit.sha, file.path, file.oldPath).then((v) => {
      if (!stale) { setVersions(v); setVErr(null); }
    }).catch((e) => {
      if (!stale) { setVErr(errMsg(e)); setVersions(null); }
    }).finally(() => { if (!stale) setVLoading(false); });
    return () => { stale = true; };
  }, [repo, detail, file]);

  const totals = useMemo(() => {
    let add = 0, del = 0;
    for (const f of detail?.files ?? []) { add += f.additions ?? 0; del += f.deletions ?? 0; }
    return { add, del };
  }, [detail]);

  const toggleSide = () => {
    localStorage.setItem(SIDE_KEY, sideBySide ? "0" : "1");
    setSideBySide(!sideBySide);
  };

  const fileMenu = (e: MouseEvent, f: GitCommitFile) => {
    const abs = join(repo, f.path);
    const items: MenuItem[] = [
      { label: "Open file", icon: <ExternalLink className="size-3.5" />, disabled: f.status === "D", onClick: () => openFilePreview(abs, repo) },
      { label: "Blame", icon: <UserSearch className="size-3.5" />, disabled: f.status === "D", onClick: () => openBlame(abs, repo) },
    ];
    if (onFileHistory) items.push({ label: "File history", icon: <History className="size-3.5" />, onClick: () => onFileHistory(f.path) });
    items.push("separator", { label: "Copy path", icon: <Copy className="size-3.5" />, onClick: () => void copyText(f.path) });
    menu.show(e, items);
  };

  if (error) return <ErrorBox error={error} />;
  if (!detail || detail.commit.sha.indexOf(sha) !== 0 && sha.indexOf(detail.commit.sha) !== 0) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  }
  const c = detail.commit;
  const committerDiffers = detail.committer !== c.author || detail.committerEmail !== c.email;

  return (
    <>
      <Group orientation="horizontal" className="h-full">
        <Panel defaultSize="36%" minSize="20%">
          <div className="flex h-full min-h-0 flex-col bg-panel">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-line p-3" onContextMenu={onMenu ? (e) => onMenu(e, detail) : undefined}>
                {header}
                <div className="flex items-start gap-2">
                  <div className="selectable min-w-0 flex-1 text-[13px] font-semibold text-fg">{c.subject}</div>
                  {onMenu && <IconButton title="Commit actions" onClick={(e) => onMenu(e, detail)}><MoreHorizontal className="size-3.5" /></IconButton>}
                </div>
                {detail.body && <div className="selectable mt-1.5 max-h-48 overflow-y-auto font-mono text-[11.5px] whitespace-pre-wrap text-fg/80">{detail.body}</div>}
                {c.refs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">{c.refs.map((r) => <RefBadge key={r.kind + r.name} name={r.name} kind={r.kind} />)}</div>
                )}
                <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
                  <dt className="text-faint">Commit</dt>
                  <dd className="flex min-w-0 items-center gap-1">
                    <span className="selectable truncate font-mono text-fg/85">{c.sha}</span>
                    <button className="shrink-0 text-faint hover:text-fg" title="Copy SHA" onClick={() => void copyText(c.sha, `Copied ${c.short}`)}><Copy className="size-3" /></button>
                  </dd>
                  <dt className="text-faint">Author</dt>
                  <dd className="selectable min-w-0 truncate text-fg/85" title={c.email}>{c.author} <span className="text-faint">&lt;{c.email}&gt;</span></dd>
                  <dt className="text-faint">Date</dt>
                  <dd className="text-fg/85">{fmtUnix(c.time)} <span className="text-faint">· {relUnix(c.time)}</span></dd>
                  {committerDiffers && (
                    <>
                      <dt className="text-faint">Committer</dt>
                      <dd className="selectable min-w-0 truncate text-fg/85" title={detail.committerEmail}>{detail.committer} <span className="text-faint">· {relUnix(detail.commitTime)}</span></dd>
                    </>
                  )}
                  <dt className="text-faint">{c.parents.length > 1 ? "Parents" : "Parent"}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {c.parents.length === 0 && <span className="text-faint">none (root commit)</span>}
                    {c.parents.map((p) => (
                      <button key={p} className="font-mono text-accent hover:underline disabled:text-fg/85 disabled:no-underline" disabled={!onNavigate} onClick={() => onNavigate?.(p)} title={p}>
                        {p.slice(0, 7)}
                      </button>
                    ))}
                  </dd>
                </dl>
              </div>
              <div className="flex h-7 items-center gap-2 px-3 text-[11px] text-muted">
                <span className="font-semibold tracking-wide uppercase">{detail.files.length} file{detail.files.length === 1 ? "" : "s"}</span>
                {totals.add > 0 && <span className="font-mono text-ok">+{totals.add}</span>}
                {totals.del > 0 && <span className="font-mono text-danger">−{totals.del}</span>}
                {c.parents.length > 1 && <span className="text-faint">vs first parent</span>}
              </div>
              {detail.files.map((f) => {
                const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
                const letter = f.status.charAt(0);
                return (
                  <div
                    key={f.path}
                    className={clsx("flex h-6 cursor-default items-center gap-1.5 pr-2 pl-3 text-xs", file?.path === f.path ? "bg-accent/15 text-fg" : "text-fg/85 hover:bg-hover")}
                    title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                    onClick={() => setFile(f)}
                    onDoubleClick={() => f.status !== "D" && openFilePreview(join(repo, f.path), repo)}
                    onContextMenu={(e) => fileMenu(e, f)}
                  >
                    <span className={clsx("w-3 shrink-0 text-center font-mono text-[11px] font-semibold", STATUS_TONE[letter] ?? "text-muted")}>{letter}</span>
                    <span className={clsx("truncate", letter === "D" && "line-through opacity-70")}>{basename(f.path)}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{f.oldPath ? `${f.oldPath} →` : dir}</span>
                    {f.binary ? <span className="shrink-0 text-[10px] text-faint">bin</span> : (
                      <span className="shrink-0 font-mono text-[10px]">
                        {!!f.additions && <span className="text-ok">+{f.additions}</span>}
                        {!!f.deletions && <span className="pl-1 text-danger">−{f.deletions}</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>
        <Separator className="w-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
        <Panel minSize="30%">
          <div className="flex h-full min-w-0 flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-xs">
              {file ? (
                <>
                  <span className="truncate font-mono text-fg/90">{file.path}</span>
                  {vLoading && <Spinner className="size-3" />}
                  <div className="flex-1" />
                  {onFileHistory && <IconButton title="File history" onClick={() => onFileHistory(file.path)}><History className="size-3.5" /></IconButton>}
                  <IconButton title="Open file" disabled={file.status === "D"} onClick={() => openFilePreview(join(repo, file.path), repo)}><ExternalLink className="size-3.5" /></IconButton>
                  <IconButton title={sideBySide ? "Inline view" : "Side-by-side view"} onClick={toggleSide}>
                    {sideBySide ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
                  </IconButton>
                </>
              ) : <span className="text-faint">No file selected</span>}
            </div>
            <div className="relative min-h-0 flex-1">
              {vErr ? <ErrorBox error={vErr} /> : !file ? (
                <Empty icon={<FileDiff className="size-8" />} title="No file changes">This commit doesn't change any file (e.g. an empty or merge commit).</Empty>
              ) : versions?.binary || file.binary ? (
                <Empty title="Binary file">This file is binary; no text diff available.</Empty>
              ) : versions ? (
                <DiffEditor
                  theme="devcat"
                  original={versions.original}
                  modified={versions.modified}
                  language={languageOf(file.path)}
                  options={{
                    readOnly: true, renderSideBySide: sideBySide, minimap: { enabled: false }, fontSize: 12,
                    scrollBeyondLastLine: false, automaticLayout: true, renderOverviewRuler: false, originalEditable: false,
                    hideUnchangedRegions: { enabled: true },
                  }}
                />
              ) : null}
            </div>
          </div>
        </Panel>
      </Group>
      {menu.element}
    </>
  );
}
