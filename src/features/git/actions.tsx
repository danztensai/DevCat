// Git action flows shared by the Git tab views: ask (confirm / name) → run with toasts → refresh.
import {
  ArrowRightLeft, Cherry, Copy, GitBranchPlus, GitCommitHorizontal, GitMerge, History, Pencil, RotateCcw, Tag, Trash2, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import type { CommitAction, GitBranch, GitCommit, GitRefs } from "../../lib/types";
import type { MenuItem } from "../connections/ContextMenu";
import { copyText } from "../files/format";
import { validateRefName, type Dialogs } from "./dialogs";
import { gitAction, outputTail } from "./store";

const fail = (label: string, e: unknown) => toast.error(`${label} failed`, { description: outputTail(errMsg(e), 1200) });

export type { Dialogs };

const code = (s: string) => <code className="rounded bg-hover px-1 font-mono text-[12px] text-fg">{s}</code>;

export async function checkout(repo: string, target: string) {
  await gitAction(repo, `Checkout ${target}`, () => api.gitCheckout(repo, target));
}

export async function createBranch(repo: string, dlg: Dialogs, startPoint?: string | null, label?: string) {
  const r = await dlg.prompt({
    title: "New branch",
    label: "Branch name",
    body: <>Create a branch at {code(label ?? startPoint ?? "HEAD")}.</>,
    validate: validateRefName,
    checkbox: { label: "Check out the new branch", initial: true },
    ok: "Create branch",
  });
  if (!r) return;
  if (r.checked) {
    await gitAction(repo, `Create ${r.value}`, () => api.gitCheckout(repo, r.value, true, startPoint ?? null), { done: `Switched to new branch ${r.value}` });
  } else {
    await gitAction(repo, `Create ${r.value}`, () => api.gitBranchCreate(repo, r.value, startPoint ?? null), { done: `Created branch ${r.value}` });
  }
}

export async function renameBranch(repo: string, dlg: Dialogs, from: string) {
  const r = await dlg.prompt({ title: "Rename branch", label: "New name", initial: from, validate: validateRefName, ok: "Rename" });
  if (!r || r.value === from) return;
  await gitAction(repo, `Rename ${from}`, () => api.gitBranchRename(repo, from, r.value), { done: `Renamed to ${r.value}` });
}

/** Delete a local branch; offers a force delete when git refuses because it isn't merged. */
export async function deleteBranch(repo: string, dlg: Dialogs, name: string) {
  if (!(await dlg.confirm({ title: "Delete branch?", body: <>Delete the local branch {code(name)}?</>, ok: "Delete", danger: true }))) return;
  try {
    await gitAction(repo, `Delete ${name}`, () => api.gitBranchDelete(repo, name), { rethrow: true, done: `Deleted ${name}` });
  } catch (e) {
    if (!/not fully merged/i.test(errMsg(e))) return void fail(`Delete ${name}`, e);
    const force = await dlg.confirm({
      title: "Branch not fully merged",
      body: <>{code(name)} has commits that aren't merged into the current branch or its upstream. Deleting it anyway may lose them.</>,
      ok: "Delete anyway",
      danger: true,
    });
    if (force) await gitAction(repo, `Delete ${name}`, () => api.gitBranchDelete(repo, name, true), { done: `Deleted ${name}` });
  }
}

export async function deleteRemoteBranch(repo: string, dlg: Dialogs, name: string) {
  const ok = await dlg.confirm({
    title: "Delete remote branch?",
    body: <>Delete {code(name)} on the remote? This affects everyone using that remote.</>,
    ok: "Delete on remote",
    danger: true,
  });
  if (ok) await gitAction(repo, `Delete ${name}`, () => api.gitBranchDelete(repo, name, false, true), { done: `Deleted ${name}` });
}

export async function mergeInto(repo: string, dlg: Dialogs, branch: string, current: string | null | undefined) {
  const r = await dlg.prompt({
    title: "Merge branch",
    label: "Branch",
    initial: branch,
    body: <>Merge {code(branch)} into {code(current ?? "HEAD")}.</>,
    checkbox: { label: "Always create a merge commit (--no-ff)", initial: false },
    ok: "Merge",
  });
  if (r) await gitAction(repo, `Merge ${r.value}`, () => api.gitMerge(repo, r.value, r.checked));
}

export async function createTag(repo: string, dlg: Dialogs, sha?: string | null, label?: string) {
  const r = await dlg.prompt({
    title: "New tag",
    label: "Tag name",
    body: <>Tag {code(label ?? sha?.slice(0, 7) ?? "HEAD")}.</>,
    validate: validateRefName,
    second: { label: "Message (optional — makes an annotated tag)" },
    ok: "Create tag",
  });
  if (r) await gitAction(repo, `Tag ${r.value}`, () => api.gitTagCreate(repo, r.value, sha ?? null, r.second || null), { done: `Created tag ${r.value}` });
}

export async function deleteTag(repo: string, dlg: Dialogs, name: string) {
  const ok = await dlg.confirm({ title: "Delete tag?", body: <>Delete the local tag {code(name)}? Tags already pushed stay on the remote.</>, ok: "Delete", danger: true });
  if (ok) await gitAction(repo, `Delete tag ${name}`, () => api.gitTagDelete(repo, name), { done: `Deleted tag ${name}` });
}

const ACTION_LABEL: Record<CommitAction, string> = {
  checkout: "Checkout", "cherry-pick": "Cherry-pick", revert: "Revert", "reset-soft": "Soft reset", "reset-mixed": "Mixed reset", "reset-hard": "Hard reset",
};

export async function commitAction(repo: string, dlg: Dialogs, c: GitCommit, action: CommitAction, current?: string | null) {
  const on = current ?? "HEAD";
  if (action === "reset-hard") {
    const ok = await dlg.confirm({
      title: "Hard reset?",
      body: (
        <>
          Move {code(on)} to {code(c.short)} <span className="text-muted">“{c.subject}”</span> and <b className="text-danger">discard all uncommitted changes</b> in
          the working tree and index. Commits after it are no longer on the branch. This cannot be undone from DevCat.
        </>
      ),
      ok: "Reset and discard",
      danger: true,
    });
    if (!ok) return;
  } else if (action === "checkout") {
    const ok = await dlg.confirm({
      title: "Check out commit?",
      body: <>Check out {code(c.short)} in detached HEAD mode. Create a branch afterwards if you want to keep new commits.</>,
      ok: "Checkout",
    });
    if (!ok) return;
  } else if (action === "reset-soft" || action === "reset-mixed") {
    const ok = await dlg.confirm({
      title: `${ACTION_LABEL[action]}?`,
      body: <>Move {code(on)} to {code(c.short)}. Changes from later commits are kept {action === "reset-soft" ? "staged" : "in the working tree (unstaged)"}.</>,
      ok: "Reset",
    });
    if (!ok) return;
  }
  await gitAction(repo, `${ACTION_LABEL[action]} ${c.short}`, () => api.gitCommitAction(repo, c.sha, action));
}

/** Context menu of a commit (history rows, commit detail). */
export function commitMenu(repo: string, dlg: Dialogs, c: GitCommit, refs: GitRefs | null, extra?: MenuItem[]): MenuItem[] {
  const current = refs?.current ?? null;
  const isHead = !!refs?.headSha && refs.headSha === c.sha;
  return [
    { label: "Copy SHA", icon: <Copy className="size-3.5" />, onClick: () => void copyText(c.sha, `Copied ${c.short}`) },
    {
      label: "Copy message", icon: <Copy className="size-3.5" />, onClick: async () => {
        try {
          const d = await api.gitShow(repo, c.sha);
          void copyText(d.body ? `${c.subject}\n\n${d.body}` : c.subject, "Copied commit message");
        } catch {
          void copyText(c.subject, "Copied commit subject");
        }
      },
    },
    ...(extra ?? []),
    "separator",
    { label: "Checkout (detached)…", icon: <GitCommitHorizontal className="size-3.5" />, onClick: () => void commitAction(repo, dlg, c, "checkout") },
    { label: "Create branch here…", icon: <GitBranchPlus className="size-3.5" />, onClick: () => void createBranch(repo, dlg, c.sha, c.short) },
    { label: "Create tag here…", icon: <Tag className="size-3.5" />, onClick: () => void createTag(repo, dlg, c.sha, c.short) },
    "separator",
    { label: "Cherry-pick", icon: <Cherry className="size-3.5" />, disabled: isHead, onClick: () => void commitAction(repo, dlg, c, "cherry-pick") },
    { label: "Revert", icon: <Undo2 className="size-3.5" />, onClick: () => void commitAction(repo, dlg, c, "revert") },
    {
      label: `Reset ${current ?? "HEAD"} to here`,
      icon: <RotateCcw className="size-3.5" />,
      submenu: [
        { label: "Soft — keep changes staged", onClick: () => void commitAction(repo, dlg, c, "reset-soft", current) },
        { label: "Mixed — keep changes unstaged", onClick: () => void commitAction(repo, dlg, c, "reset-mixed", current) },
        { label: "Hard — discard changes…", danger: true, onClick: () => void commitAction(repo, dlg, c, "reset-hard", current) },
      ],
    },
  ];
}

/** Context menu of a branch (Branches view, branch switcher). */
export function branchMenu(repo: string, dlg: Dialogs, b: GitBranch, refs: GitRefs | null, remote: boolean, showInHistory: (sha: string) => void): MenuItem[] {
  const current = refs?.current ?? null;
  const items: MenuItem[] = [
    { label: remote ? "Checkout as local branch" : "Checkout", icon: <ArrowRightLeft className="size-3.5" />, disabled: b.current, onClick: () => void checkout(repo, b.name) },
    { label: "New branch from here…", icon: <GitBranchPlus className="size-3.5" />, onClick: () => void createBranch(repo, dlg, b.name, b.name) },
    { label: `Merge into ${current ?? "HEAD"}…`, icon: <GitMerge className="size-3.5" />, disabled: b.current || !current, onClick: () => void mergeInto(repo, dlg, b.name, current) },
    { label: "Show in history", icon: <History className="size-3.5" />, onClick: () => showInHistory(b.sha) },
    "separator",
    { label: "Copy name", icon: <Copy className="size-3.5" />, onClick: () => void copyText(b.name) },
    { label: "Create tag here…", icon: <Tag className="size-3.5" />, onClick: () => void createTag(repo, dlg, b.sha, b.name) },
    "separator",
  ];
  if (remote) {
    items.push({ label: "Delete on remote…", icon: <Trash2 className="size-3.5" />, danger: true, onClick: () => void deleteRemoteBranch(repo, dlg, b.name) });
  } else {
    items.push(
      { label: "Rename…", icon: <Pencil className="size-3.5" />, onClick: () => void renameBranch(repo, dlg, b.name) },
      { label: "Delete…", icon: <Trash2 className="size-3.5" />, danger: true, disabled: b.current, onClick: () => void deleteBranch(repo, dlg, b.name) },
    );
  }
  return items;
}

/** Push the current branch; publishes it (set-upstream) when it has none, force push asks first. */
export async function pushCurrent(repo: string, dlg: Dialogs, refs: GitRefs | null, opts: { force?: boolean; tags?: boolean } = {}) {
  if (!refs?.current) {
    return void fail("Push", "HEAD is detached — check out a branch to push it.");
  }
  const branch = refs.local.find((b) => b.current);
  if (opts.force) {
    const ok = await dlg.confirm({
      title: "Force push?",
      body: (
        <>
          Overwrite {code(branch?.upstream ?? refs.current)} on the remote with your local {code(refs.current)} (
          <span className="font-mono">--force-with-lease</span>). Commits on the remote that you don't have locally will be lost.
        </>
      ),
      ok: "Force push",
      danger: true,
    });
    if (!ok) return;
  }
  if (!branch?.upstream) {
    if (!refs.remotes.length) {
      return void fail("Push", "This repository has no remote. Add one with `git remote add origin <url>`.");
    }
    const names = refs.remotes.map((r) => r.name);
    const r = await dlg.prompt({
      title: "Publish branch",
      label: "Remote",
      initial: names.includes("origin") ? "origin" : names[0],
      hint: names.length > 1 ? `Remotes: ${names.join(", ")}` : undefined,
      body: <>{code(refs.current)} has no upstream yet. Push it and set the upstream to:</>,
      validate: (v) => (names.includes(v.trim()) ? null : `Unknown remote (${names.join(", ")})`),
      ok: "Publish",
    });
    if (!r) return;
    await gitAction(repo, `Publish ${refs.current}`, () => api.gitPush(repo, { remote: r.value, setUpstream: true, force: opts.force, tags: opts.tags }));
    return;
  }
  await gitAction(repo, opts.force ? "Force push" : "Push", () => api.gitPush(repo, { force: opts.force, tags: opts.tags }));
}
