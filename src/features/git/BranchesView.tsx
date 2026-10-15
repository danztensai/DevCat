// Branches: local (current, upstream, ahead/behind), remote branches, tags and remotes, with actions.
import clsx from "clsx";
import {
  ArrowDown, ArrowRightLeft, ArrowUp, Check, ChevronRight, Cloud, Copy, GitBranch, GitBranchPlus, GitMerge, History, RefreshCw, Search, Tag, Trash2, X,
} from "lucide-react";
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Button, Empty, ErrorBox, IconButton, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import type { GitBranch as Branch, GitTag } from "../../lib/types";
import { useContextMenu, type MenuItem } from "../connections/ContextMenu";
import { copyText } from "../files/format";
import { branchMenu, checkout, createBranch, createTag, deleteBranch, deleteRemoteBranch, deleteTag, mergeInto, type Dialogs } from "./actions";
import { gitAction, useRepo } from "./store";
import { fmtUnix, relUnix } from "./util";

type Section = "local" | "remote" | "tags" | "remotes";

export function BranchesView({ repo, dlg, showInHistory }: { repo: string; dlg: Dialogs; showInHistory: (sha: string) => void }) {
  const { refs, refsError } = useRepo(repo);
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Set<Section>>(() => new Set());
  const menu = useContextMenu();
  const q = filter.trim().toLowerCase();

  const lists = useMemo(() => {
    const m = (s: string) => !q || s.toLowerCase().includes(q);
    return {
      local: (refs?.local ?? []).filter((b) => m(b.name) || m(b.subject)),
      remote: (refs?.remote ?? []).filter((b) => !b.name.endsWith("/HEAD") && (m(b.name) || m(b.subject))),
      tags: (refs?.tags ?? []).filter((t) => m(t.name) || m(t.subject)),
      remotes: (refs?.remotes ?? []).filter((r) => m(r.name) || m(r.url)),
    };
  }, [refs, q]);

  if (!refs && refsError) return <ErrorBox error={refsError} />;
  if (!refs) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const current = refs.current ?? null;

  const toggle = (s: Section) => setClosed((c) => {
    const n = new Set(c);
    if (n.has(s)) n.delete(s); else n.add(s);
    return n;
  });

  const tagMenu = (e: MouseEvent, t: GitTag) => {
    const items: MenuItem[] = [
      { label: "Show in history", icon: <History className="size-3.5" />, onClick: () => showInHistory(t.sha) },
      { label: "Checkout (detached)", icon: <ArrowRightLeft className="size-3.5" />, onClick: () => void checkout(repo, t.name) },
      { label: "New branch from tag…", icon: <GitBranchPlus className="size-3.5" />, onClick: () => void createBranch(repo, dlg, t.name, t.name) },
      "separator",
      { label: "Copy name", icon: <Copy className="size-3.5" />, onClick: () => void copyText(t.name) },
      { label: "Delete…", icon: <Trash2 className="size-3.5" />, danger: true, onClick: () => void deleteTag(repo, dlg, t.name) },
    ];
    menu.show(e, items);
  };

  const header = (s: Section, title: string, n: number, extra?: ReactNode) => (
    <div className="sticky top-0 z-10 flex h-7 items-center gap-1 border-b border-line bg-panel pr-2 pl-1">
      <button className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-semibold tracking-wider text-muted uppercase hover:text-fg" onClick={() => toggle(s)}>
        <ChevronRight className={clsx("size-3 transition-transform duration-100", !closed.has(s) && "rotate-90")} />
        {title}
        <span className="font-normal text-faint normal-case">{n}</span>
      </button>
      {extra}
    </div>
  );

  const empty = (text: string) => <div className="px-6 py-2 text-[12px] text-faint italic">{text}</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2">
        <div className="relative w-64 shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
            placeholder="Filter branches and tags"
            spellCheck={false}
            className="h-6 w-full rounded border border-line bg-app pr-5 pl-5.5 text-[12px] placeholder:text-faint focus:border-accent focus:outline-none"
          />
          {filter && (
            <button className="absolute top-1/2 right-1 -translate-y-1/2 text-faint hover:text-fg" onClick={() => setFilter("")} aria-label="Clear">
              <X className="size-3" />
            </button>
          )}
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={() => void createBranch(repo, dlg, null, current ?? "HEAD")}><GitBranchPlus className="size-3.5" />New branch…</Button>
        <Button size="sm" onClick={() => void createTag(repo, dlg, null, current ?? "HEAD")}><Tag className="size-3.5" />New tag…</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {header("local", "Local branches", lists.local.length)}
        {!closed.has("local") && (lists.local.length ? lists.local.map((b) => (
          <BranchRow
            key={b.fullRef}
            b={b}
            onMenu={(e) => menu.show(e, branchMenu(repo, dlg, b, refs, false, showInHistory))}
            onCheckout={() => void checkout(repo, b.name)}
            actions={
              <>
                <IconButton title="Show in history" className="size-5" onClick={() => showInHistory(b.sha)}><History className="size-3" /></IconButton>
                {!b.current && current && (
                  <IconButton title={`Merge into ${current}`} className="size-5" onClick={() => void mergeInto(repo, dlg, b.name, current)}><GitMerge className="size-3" /></IconButton>
                )}
                {!b.current && <IconButton title="Checkout" className="size-5" onClick={() => void checkout(repo, b.name)}><ArrowRightLeft className="size-3" /></IconButton>}
                {!b.current && <IconButton title="Delete…" className="size-5" onClick={() => void deleteBranch(repo, dlg, b.name)}><Trash2 className="size-3" /></IconButton>}
              </>
            }
          />
        )) : empty(q ? "No match" : "No local branches"))}

        {header("remote", "Remote branches", lists.remote.length)}
        {!closed.has("remote") && (lists.remote.length ? lists.remote.map((b) => (
          <BranchRow
            key={b.fullRef}
            b={b}
            remote
            onMenu={(e) => menu.show(e, branchMenu(repo, dlg, b, refs, true, showInHistory))}
            onCheckout={() => void checkout(repo, b.name)}
            actions={
              <>
                <IconButton title="Show in history" className="size-5" onClick={() => showInHistory(b.sha)}><History className="size-3" /></IconButton>
                <IconButton title="Checkout as local branch" className="size-5" onClick={() => void checkout(repo, b.name)}><ArrowRightLeft className="size-3" /></IconButton>
                <IconButton title="Delete on remote…" className="size-5" onClick={() => void deleteRemoteBranch(repo, dlg, b.name)}><Trash2 className="size-3" /></IconButton>
              </>
            }
          />
        )) : empty(q ? "No match" : refs.remotes.length ? "No remote branches — try Fetch" : "No remotes configured"))}

        {header("tags", "Tags", lists.tags.length)}
        {!closed.has("tags") && (lists.tags.length ? lists.tags.map((t) => (
          <div
            key={t.name}
            className="group flex h-6 cursor-default items-center gap-1.5 pr-2 pl-5 text-[12px] hover:bg-hover/60"
            onDoubleClick={() => showInHistory(t.sha)}
            onContextMenu={(e) => tagMenu(e, t)}
          >
            <Tag className="size-3 shrink-0 text-warn" />
            <span className="w-56 shrink-0 truncate font-mono text-fg/90" title={t.name}>{t.name}</span>
            {t.annotated && <span className="shrink-0 text-[10px] text-faint" title="Annotated tag">annotated</span>}
            <span className="min-w-0 flex-1 truncate text-muted" title={t.subject}>{t.subject}</span>
            <span className="hidden shrink-0 items-center group-hover:flex">
              <IconButton title="Show in history" className="size-5" onClick={() => showInHistory(t.sha)}><History className="size-3" /></IconButton>
              <IconButton title="Delete…" className="size-5" onClick={() => void deleteTag(repo, dlg, t.name)}><Trash2 className="size-3" /></IconButton>
            </span>
            <span className="w-20 shrink-0 text-right text-faint" title={fmtUnix(t.time)}>{relUnix(t.time)}</span>
          </div>
        )) : empty(q ? "No match" : "No tags"))}

        {header("remotes", "Remotes", lists.remotes.length)}
        {!closed.has("remotes") && (lists.remotes.length ? lists.remotes.map((r) => (
          <div
            key={r.name}
            className="group flex h-6 cursor-default items-center gap-1.5 pr-2 pl-5 text-[12px] hover:bg-hover/60"
            onContextMenu={(e) => menu.show(e, [
              { label: `Fetch ${r.name}`, icon: <RefreshCw className="size-3.5" />, onClick: () => void gitAction(repo, `Fetch ${r.name}`, () => api.gitFetch(repo, { remote: r.name })) },
              { label: "Copy URL", icon: <Copy className="size-3.5" />, onClick: () => void copyText(r.url) },
            ])}
          >
            <Cloud className="size-3 shrink-0 text-info" />
            <span className="w-32 shrink-0 truncate font-mono text-fg/90">{r.name}</span>
            <span className="selectable min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={r.url}>{r.url}</span>
            <span className="hidden shrink-0 items-center group-hover:flex">
              <IconButton title={`Fetch ${r.name}`} className="size-5" onClick={() => void gitAction(repo, `Fetch ${r.name}`, () => api.gitFetch(repo, { remote: r.name }))}>
                <RefreshCw className="size-3" />
              </IconButton>
              <IconButton title="Copy URL" className="size-5" onClick={() => void copyText(r.url)}><Copy className="size-3" /></IconButton>
            </span>
          </div>
        )) : empty(q ? "No match" : "No remotes"))}

        {!refs.local.length && !refs.remote.length && !refs.tags.length && !q && (
          <Empty icon={<GitBranch className="size-8" />} title="No branches yet">Make a first commit to create the initial branch.</Empty>
        )}
      </div>
      {menu.element}
    </div>
  );
}

function BranchRow({ b, remote, onMenu, onCheckout, actions }: {
  b: Branch; remote?: boolean; onMenu: (e: MouseEvent) => void; onCheckout: () => void; actions: ReactNode;
}) {
  return (
    <div
      className={clsx("group flex h-6 cursor-default items-center gap-1.5 pr-2 pl-5 text-[12px]", b.current ? "bg-accent/10" : "hover:bg-hover/60")}
      onDoubleClick={() => !b.current && onCheckout()}
      onContextMenu={onMenu}
      title={b.current ? `${b.name} (checked out)` : `${b.name} — double-click to check out`}
    >
      {b.current ? <Check className="size-3 shrink-0 text-accent" /> : remote ? <Cloud className="size-3 shrink-0 text-info" /> : <GitBranch className="size-3 shrink-0 text-faint" />}
      <span className={clsx("w-56 shrink-0 truncate font-mono", b.current ? "font-semibold text-accent" : "text-fg/90")}>{b.name}</span>
      {!remote && (
        <span className="flex w-44 shrink-0 items-center gap-1 truncate text-[11px] text-faint">
          {b.upstream ? <span className="truncate font-mono" title={`Tracks ${b.upstream}`}>{b.upstream}</span> : <span className="italic">no upstream</span>}
          {b.ahead > 0 && <span className="inline-flex shrink-0 items-center text-info" title={`${b.ahead} ahead`}><ArrowUp className="size-3" />{b.ahead}</span>}
          {b.behind > 0 && <span className="inline-flex shrink-0 items-center text-warn" title={`${b.behind} behind`}><ArrowDown className="size-3" />{b.behind}</span>}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-muted" title={b.subject}>{b.subject}</span>
      <span className="hidden shrink-0 items-center group-hover:flex" onDoubleClick={(e) => e.stopPropagation()}>{actions}</span>
      <span className="w-20 shrink-0 text-right text-faint" title={fmtUnix(b.time)}>{relUnix(b.time)}</span>
    </div>
  );
}
