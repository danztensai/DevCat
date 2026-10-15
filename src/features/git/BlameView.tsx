// Git blame: read-only Monaco editor whose line-number gutter shows "sha  author  age" at the start of
// each blame block, an age heatmap bar, a hover card with the commit, and click → commit in History.
import Editor, { type OnMount } from "@monaco-editor/react";
import { GitCommitHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBox, Spinner } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { BlameCommit, GitBlame } from "../../lib/types";
import { monaco } from "../../lib/monaco";
import { languageOf } from "../claude/util";
import { openGitRepo } from "./open";
import { ageShort, fmtUnix, relUnix } from "./util";

type Ed = Parameters<OnMount>[0];

const AUTHOR_W = 14;
const BUCKETS = 10;

function fit(s: string, w: number): string {
  return s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
}

/** Per-line gutter labels, block starts and age buckets. */
function layout(blame: GitBlame) {
  const shaByLine: string[] = [];
  for (const l of blame.lines) shaByLine[l.line - 1] = l.sha;
  // Rank commit times so the heatmap uses the whole scale even for young files.
  const times = [...new Set(Object.values(blame.commits).filter((c) => !c.uncommitted).map((c) => c.time))].sort((a, b) => a - b);
  const bucketOf = (c: BlameCommit | undefined) => {
    if (!c) return null;
    if (c.uncommitted) return "now";
    const i = times.indexOf(c.time);
    return String(times.length <= 1 ? BUCKETS - 1 : Math.floor((i / (times.length - 1)) * (BUCKETS - 1)));
  };
  const now = Date.now();
  const digits = String(Math.max(1, shaByLine.length)).length;
  const labelW = 7 + 2 + AUTHOR_W + 2 + 4;
  const labels: string[] = [];
  const heads: boolean[] = [];
  for (let i = 0; i < shaByLine.length; i++) {
    const sha = shaByLine[i];
    const head = !!sha && (i === 0 || shaByLine[i - 1] !== sha);
    heads.push(head);
    const c = sha ? blame.commits[sha] : undefined;
    let text = "";
    if (head && c) text = c.uncommitted ? "Not committed yet" : `${sha.slice(0, 7)}  ${fit(c.author, AUTHOR_W)}  ${ageShort(c.time, now).padStart(4)}`;
    labels.push(`${fit(text, labelW)}  ${String(i + 1).padStart(digits)}`);
  }
  return { shaByLine, labels, heads, bucketOf, width: labelW + 2 + digits };
}

export function BlameView({ path, repo, slot, reload }: { path: string; repo: string; slot: HTMLElement | null; reload?: number }) {
  const [blame, setBlame] = useState<GitBlame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Ed | null>(null);
  const [hover, setHover] = useState<{ sha: string; x: number; y: number } | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const decos = useRef<ReturnType<Ed["createDecorationsCollection"]> | null>(null);

  useEffect(() => {
    let stale = false;
    setError(null);
    api.gitBlame(repo, path).then((b) => { if (!stale) setBlame(b); }).catch((e) => { if (!stale) setError(errMsg(e)); });
    return () => { stale = true; };
  }, [repo, path, reload]);

  const lay = useMemo(() => (blame ? layout(blame) : null), [blame]);

  // Heatmap bars, block separators, and the hovered commit's lines.
  useEffect(() => {
    if (!editor || !lay || !blame) return;
    const ds: Parameters<Ed["createDecorationsCollection"]>[0] = [];
    lay.shaByLine.forEach((sha, i) => {
      const n = i + 1;
      const bucket = lay.bucketOf(blame.commits[sha]);
      const same = !!hot && sha === hot;
      ds.push({
        range: new monaco.Range(n, 1, n, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: bucket ? `blame-age-${bucket}` : undefined,
          lineNumberClassName: same ? "blame-hot" : lay.heads[i] ? "blame-head" : undefined,
          className: [lay.heads[i] && n > 1 ? "blame-block" : "", same ? "blame-same" : ""].join(" ").trim() || undefined,
        },
      });
    });
    if (!decos.current) decos.current = editor.createDecorationsCollection(ds);
    else decos.current.set(ds);
  }, [editor, lay, blame, hot]);

  const shaAt = (line: number | undefined) => (line && lay ? lay.shaByLine[line - 1] ?? null : null);
  // Monaco handlers are registered once; read current data through refs.
  const shaAtRef = useRef(shaAt);
  shaAtRef.current = shaAt;
  const blameRef = useRef(blame);
  blameRef.current = blame;

  // Stable while the blame is unchanged: hovering re-renders a lot.
  const options = useMemo(() => ({
    readOnly: true,
    domReadOnly: true,
    minimap: { enabled: false },
    fontSize: 12,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderLineHighlight: "none" as const,
    lineNumbers: (n: number) => lay?.labels[n - 1] ?? "",
    lineNumbersMinChars: lay?.width ?? 5,
    lineDecorationsWidth: 10,
    folding: false,
    glyphMargin: false,
    largeFileOptimizations: true,
  }), [lay]);

  const onMount: OnMount = (ed) => {
    decos.current = null;
    setEditor(ed);
    const gutter = (t: number) => t === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS || t === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;
    ed.onMouseMove((e) => {
      const sha = gutter(e.target.type) ? shaAtRef.current(e.target.position?.lineNumber) : null;
      setHot(sha);
      setHover(sha ? { sha, x: e.event.browserEvent.clientX, y: e.event.browserEvent.clientY } : null);
    });
    ed.onMouseLeave(() => { setHover(null); setHot(null); });
    ed.onMouseDown((e) => {
      if (!gutter(e.target.type)) return;
      const sha = shaAtRef.current(e.target.position?.lineNumber);
      const c = sha ? blameRef.current?.commits[sha] : undefined;
      if (!c) return;
      if (c.uncommitted) openGitRepo(repo, { view: "changes" });
      else openGitRepo(repo, { sha: c.sha });
    });
  };

  if (error) return <ErrorBox error={error} />;
  if (!blame || !lay) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const hc = hover ? blame.commits[hover.sha] : undefined;
  const count = Object.values(blame.commits).filter((c) => !c.uncommitted).length;

  return (
    <div className="blame-editor relative h-full">
      {slot && createPortal(
        <span className="flex items-center gap-1 text-[11px] text-faint" title="Line age: oldest → newest commit in this file; green = not committed">
          {count} commit{count === 1 ? "" : "s"}
          <span className="ml-1">old</span>
          <span className="flex h-2 overflow-hidden rounded-sm">
            {Array.from({ length: BUCKETS }, (_, i) => <span key={i} className={`blame-age-${i} w-1.5`} />)}
          </span>
          <span>new</span>
        </span>,
        slot,
      )}
      <Editor
        theme="devcat"
        language={languageOf(path)}
        value={blame.content}
        onMount={onMount}
        options={options}
      />
      {hover && hc && (
        <div
          className="pointer-events-none fixed z-50 w-96 rounded-md border border-line bg-raised p-2.5 text-[12px] shadow-2xl shadow-black/50"
          style={{ left: Math.min(hover.x + 14, window.innerWidth - 400), top: Math.min(hover.y + 14, window.innerHeight - 150) }}
        >
          {hc.uncommitted ? (
            <div className="text-ok">Not committed yet <span className="text-faint">· click to see the changes</span></div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-muted">
                <GitCommitHorizontal className="size-3.5" />
                <span className="font-mono text-accent">{hc.sha.slice(0, 10)}</span>
                <span className="truncate">{hc.author}</span>
                <span className="ml-auto shrink-0 text-faint" title={fmtUnix(hc.time)}>{relUnix(hc.time)}</span>
              </div>
              <div className="mt-1 font-medium text-fg">{hc.summary}</div>
              <div className="mt-1 text-[11px] text-faint">
                {fmtUnix(hc.time)} · {hc.email}
                {hc.filename && blame.lines.length > 0 && !path.endsWith(hc.filename) && <> · from {hc.filename}</>}
              </div>
              <div className="mt-1.5 text-[11px] text-faint">Click to show the commit in History</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
