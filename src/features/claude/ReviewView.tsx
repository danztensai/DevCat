// Code Review view: run a read-only Claude review over the diff and show findings by severity.
import clsx from "clsx";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Play, ScanSearch, Square, Wand2 } from "lucide-react";
import { useMemo } from "react";
import { Button, Empty, ErrorBox, Input, Select, Spinner } from "../../components/ui";
import { CodeBlock, Markdown } from "./Markdown";
import { cancelReview, focusDiff, setReviewOptions, startReview, useClaude, type Finding, type ReviewState } from "./store";
import { fmtCost, fmtDuration, modelOptions, openFile } from "./util";

export const SEVERITIES = ["critical", "major", "minor", "nit"] as const;
const SEV_STYLE: Record<string, { cls: string; icon: typeof Info }> = {
  critical: { cls: "border-danger/50 text-danger bg-danger/10", icon: AlertOctagon },
  major: { cls: "border-warn/50 text-warn bg-warn/10", icon: AlertTriangle },
  minor: { cls: "border-info/50 text-info bg-info/10", icon: Info },
  nit: { cls: "border-line text-muted bg-hover", icon: Info },
};
const sevRank = (s: string) => {
  const i = SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);
  return i < 0 ? 2.5 : i;
};

/** Header badge summary of a review. */
export function reviewBadge(r: ReviewState | undefined): { kind: "none" | "running" | "ok" | "issues" | "error"; count: number; worst?: string } {
  if (!r || r.status === "idle") return { kind: "none", count: 0 };
  if (r.status === "running") return { kind: "running", count: 0 };
  if (r.status === "error") return { kind: "error", count: 0 };
  const f = r.findings ?? [];
  if (!r.findings) return { kind: r.markdown ? "issues" : "ok", count: 0 };
  if (!f.length) return { kind: "ok", count: 0 };
  const worst = [...f].sort((a, b) => sevRank(a.severity) - sevRank(b.severity))[0].severity;
  return { kind: "issues", count: f.length, worst };
}

function FindingCard({ f, cwd, onOpen, onFix }: { f: Finding; cwd: string; onOpen: () => void; onFix: () => void }) {
  const st = SEV_STYLE[f.severity] ?? SEV_STYLE.minor;
  const Icon = st.icon;
  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <span className={clsx("mt-px inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold uppercase", st.cls)}>
          <Icon className="size-3" />{f.severity}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-fg">{f.title}</div>
          {f.file && (
            <button type="button" className="font-mono text-[11px] text-info hover:underline" onClick={onOpen} title="Show in Diff">
              {f.file}{f.line ? `:${f.line}` : ""}
            </button>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onFix} title="Switch to Chat and ask Claude to fix this"><Wand2 className="size-3" />Fix with Claude</Button>
      </div>
      <div className="px-3 pb-2.5">
        {f.body && <Markdown text={f.body} cwd={cwd} className="text-fg/90" />}
        {f.suggestion && (
          <div className="mt-1">
            <div className="text-[11px] font-medium text-muted">Suggestion</div>
            {/```/.test(f.suggestion) ? <Markdown text={f.suggestion} cwd={cwd} /> : <CodeBlock code={f.suggestion} lang="suggestion" />}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReviewView({ tabId, cwd, onFix, onShowDiff }: { tabId: string; cwd: string; onFix: (f: Finding) => void; onShowDiff: () => void }) {
  const r = useClaude((s) => s.tabs[tabId]?.review);
  const info = useClaude((s) => s.info);
  const git = useClaude((s) => s.tabs[tabId]?.git);
  const models = useMemo(() => modelOptions(info?.models), [info]);
  const sorted = useMemo(() => [...(r?.findings ?? [])].sort((a, b) => sevRank(a.severity) - sevRank(b.severity)), [r?.findings]);
  if (!r) return null;
  const running = r.status === "running";

  const open = (f: Finding) => {
    if (!f.file) return;
    const inDiff = git?.files.some((x) => f.file === x.path || f.file!.endsWith("/" + x.path) || x.path.endsWith("/" + f.file));
    if (inDiff) {
      focusDiff(tabId, f.file, f.line);
      onShowDiff();
    } else openFile(cwd, f.file);
  };

  const counts = SEVERITIES.map((s) => [s, sorted.filter((f) => f.severity === s).length] as const).filter(([, n]) => n);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <Select className="w-40" value={r.scope} disabled={running} onChange={(e) => setReviewOptions(tabId, { scope: e.target.value as ReviewState["scope"] })}>
          <option value="uncommitted">Uncommitted changes</option>
          <option value="staged">Staged changes</option>
          <option value="branch">Branch vs base</option>
        </Select>
        {r.scope === "branch" && (
          <Input className="w-32" value={r.base} disabled={running} placeholder="main" onChange={(e) => setReviewOptions(tabId, { base: e.target.value })} title="Base branch / ref" />
        )}
        <Select className="w-32" value={r.model} disabled={running} onChange={(e) => setReviewOptions(tabId, { model: e.target.value })}>
          {models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
        {running
          ? <Button variant="danger" onClick={() => void cancelReview(tabId)}><Square className="size-3 fill-current" />Cancel</Button>
          : <Button variant="primary" onClick={() => void startReview(tabId)}><Play className="size-3.5" />Run review</Button>}
        <div className="flex-1" />
        {r.status === "done" && (
          <span className="text-[11px] text-faint">
            {r.durationMs != null && fmtDuration(r.durationMs)}{r.costUsd != null && ` · ${fmtCost(r.costUsd)}`}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 p-4">
          {r.status === "idle" && (
            <Empty icon={<ScanSearch className="size-8" />} title="Code review">
              Claude reviews your {r.scope === "branch" ? `branch against ${r.base || "main"}` : r.scope === "staged" ? "staged changes" : "uncommitted changes"} read-only and reports findings by severity.
            </Empty>
          )}
          {running && (
            <div className="rounded-lg border border-line bg-panel p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted"><Spinner className="size-3.5" />Reviewing…</div>
              <div className="max-h-60 overflow-y-auto font-mono text-[11px] text-faint">
                {r.progress.length === 0 && <div>Starting…</div>}
                {r.progress.slice(-30).map((l, i) => <div key={i} className="truncate">↳ {l}</div>)}
              </div>
            </div>
          )}
          {r.status === "error" && r.error && <ErrorBox error={r.error} />}
          {r.status === "done" && (
            <>
              {r.findings && (
                <div className="flex items-center gap-2 pb-1">
                  {sorted.length === 0
                    ? <span className="flex items-center gap-1.5 text-ok"><CheckCircle2 className="size-4" />No issues found</span>
                    : <span className="font-medium">{sorted.length} finding{sorted.length === 1 ? "" : "s"}</span>}
                  {counts.map(([s, n]) => (
                    <span key={s} className={clsx("rounded border px-1.5 py-px text-[10px] font-semibold uppercase", SEV_STYLE[s].cls)}>{n} {s}</span>
                  ))}
                </div>
              )}
              {r.summary && <Markdown text={r.summary} cwd={cwd} className="pb-2 text-fg/90" />}
              {sorted.map((f, i) => <FindingCard key={i} f={f} cwd={cwd} onOpen={() => open(f)} onFix={() => onFix(f)} />)}
              {r.markdown && <Markdown text={r.markdown} cwd={cwd} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
