// DevCat Agent chat view (AI workspace tabs whose AI connection is a DevCat Agent). Laid out like
// DeepSeek Harness / Zed's agent panel: a centered conversation; each tool call is one compact step
// row (click for details); approvals are inline cards; reasoning is folded away; the composer
// carries the permission mode, model and token use.
import clsx from "clsx";
import {
  ArrowUp, Ban, Bot, Brain, Check, ChevronDown, ChevronRight, Cpu, FilePen, FilePlus, FileText, FolderSearch, GitCompare, Search, Shield, ShieldAlert, ShieldCheck, ShieldOff, Square,
  SquareTerminal, Wrench, X,
} from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Empty, Spinner } from "../../components/ui";
import type { AgentPolicy, AiProvider } from "../../lib/types";
import { useTabs } from "../../store/tabs";
import { Markdown } from "../claude/Markdown";
import { openManageProviders } from "../claude/providers";
import { basename } from "../claude/util";
import { answer, closeChat, dismissError, openChat, send, setPolicy, stop, useAgent, type Item, type ToolStatus } from "./store";

type ToolItem = Extract<Item, { kind: "tool" }>;

const POLICIES: { id: AgentPolicy; label: string; hint: string }[] = [
  { id: "ask", label: "Ask first", hint: "Ask before every file edit and command" },
  { id: "auto-edit", label: "Auto-edit", hint: "Edit files in the project without asking; ask before commands" },
  { id: "bypass", label: "Full access", hint: "Never ask: edits and commands run right away" },
];

const SUGGESTIONS = ["Explain how this project is organized", "Find and fix failing tests", "Review my uncommitted changes for bugs"];

const str = (v: unknown) => (typeof v === "string" ? v : "");
const lines = (s: string) => (s ? s.replace(/\n$/, "").split("\n").length : 0);

/** How a tool step reads: icon, verb, target and changed lines. */
function describe(name: string, input: Record<string, unknown> | null, status: ToolStatus) {
  const done = status === "done" || status === "error" || status === "denied";
  const i = input ?? {};
  switch (name) {
    case "read": return { icon: FileText, verb: done ? "Read" : "Reading", target: str(i.path) };
    case "write": return { icon: FilePlus, verb: done ? "Wrote" : "Writing", target: str(i.path), plus: lines(str(i.content)), minus: 0 };
    case "edit": return { icon: FilePen, verb: done ? "Edited" : "Editing", target: str(i.path), plus: lines(str(i.new_string)), minus: lines(str(i.old_string)) };
    case "glob": return { icon: FolderSearch, verb: done ? "Found files" : "Finding files", target: str(i.pattern) };
    case "grep": return { icon: Search, verb: done ? "Searched" : "Searching", target: str(i.pattern) };
    case "shell": return { icon: SquareTerminal, verb: done ? "Ran" : "Running", target: str(i.command) };
    default: return { icon: Wrench, verb: name, target: "" };
  }
}

function fmtTokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtDuration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function AgentChat({ tabId, cwd, provider, visible, onReview }: { tabId: string; cwd: string; provider: AiProvider; visible: boolean; onReview: () => void }) {
  const chat = useAgent((s) => s.chats[tabId]);
  const sessionId = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === tabId);
    return t && t.type === "claude" ? t.sessionId ?? null : null;
  });

  // Open (or resume) the session; remember it on the tab so it comes back after a restart.
  useEffect(() => {
    if (useAgent.getState().chats[tabId]?.sessionId === sessionId && sessionId) return;
    void openChat(tabId, cwd, provider.id, sessionId).then((id) => {
      if (id && id !== sessionId) useTabs.getState().update(tabId, { sessionId: id } as never);
    });
  }, [tabId, cwd, provider.id, sessionId]);
  useEffect(() => () => void closeChat(tabId), [tabId]);

  if (!chat || (chat.opening && !chat.items.length)) {
    return <div className="flex h-full items-center justify-center"><Spinner className="size-5" /></div>;
  }
  if (!chat.sessionId && chat.error) {
    return (
      <Empty icon={<Bot className="size-8" />} title="DevCat Agent couldn't start">
        <div className="flex flex-col items-center gap-2">
          <p className="max-w-md text-danger">{chat.error}</p>
          <Button onClick={() => openManageProviders(provider.id)}>Edit {provider.name}</Button>
        </div>
      </Empty>
    );
  }
  return <ChatBody tabId={tabId} cwd={cwd} visible={visible} onReview={onReview} />;
}

function ChatBody({ tabId, cwd, visible, onReview }: { tabId: string; cwd: string; visible: boolean; onReview: () => void }) {
  const chat = useAgent((s) => s.chats[tabId])!;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow new content while the view is at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.items]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const lastUser = chat.items.map((i) => i.kind).lastIndexOf("user");
  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[780px] flex-col gap-3 px-5 pt-6 pb-4">
          {chat.items.length === 0 ? (
            <Welcome tabId={tabId} cwd={cwd} />
          ) : (
            chat.items.map((it, n) => <ItemView key={it.key} item={it} tabId={tabId} cwd={cwd} working={chat.busy && n > lastUser} />)
          )}
          {chat.busy && <Working items={chat.items} />}
        </div>
      </div>
      {chat.error && (
        <div className="mx-auto flex w-full max-w-[780px] items-start gap-2 px-5">
          <div className="flex flex-1 items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            <span className="flex-1">{chat.error}</span>
            <button className="text-danger/70 hover:text-danger" onClick={() => dismissError(tabId)} aria-label="Dismiss"><X className="size-3.5" /></button>
          </div>
        </div>
      )}
      <EditedFiles items={chat.items} onReview={onReview} />
      <Composer tabId={tabId} visible={visible} />
    </div>
  );
}

function Welcome({ tabId, cwd }: { tabId: string; cwd: string }) {
  const chat = useAgent((s) => s.chats[tabId])!;
  const policy = POLICIES.find((p) => p.id === chat.policy)!;
  return (
    <div className="flex flex-col items-center gap-4 pt-[12vh] text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent"><Bot className="size-6" /></div>
      <div>
        <h2 className="text-lg font-semibold text-fg">What should we do in {basename(cwd)}?</h2>
        <p className="mt-1 text-[12px] text-muted">{chat.providerName} · {chat.model} · {policy.hint.toLowerCase()}.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => void send(tabId, s)} className="rounded-full border border-line px-3 py-1.5 text-[12px] text-muted hover:border-accent/50 hover:text-fg">{s}</button>
        ))}
      </div>
    </div>
  );
}

/** "Thinking…" while the model hasn't started its answer or a tool yet. */
function Working({ items }: { items: Item[] }) {
  const last = items[items.length - 1];
  const quiet = !last || last.kind === "user" || (last.kind === "tool" && (last.status === "done" || last.status === "error" || last.status === "denied"));
  if (!quiet) return null;
  return <div className="flex items-center gap-2 text-[12px] text-muted"><Spinner className="size-3.5" />Working…</div>;
}

const ItemView = memo(function ItemView({ item, tabId, cwd, working }: { item: Item; tabId: string; cwd: string; working: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-raised px-3.5 py-2 text-[13px] whitespace-pre-wrap text-fg">{item.text}</div>
        </div>
      );
    case "answer":
      return <Answer item={item} cwd={cwd} />;
    case "tool":
      return <ToolRow item={item} tabId={tabId} working={working} />;
    case "end":
      return <TurnEnd item={item} />;
  }
});

function Answer({ item, cwd }: { item: Extract<Item, { kind: "answer" }>; cwd: string }) {
  // Shown while the model thinks, folded once it answers; a click always wins.
  const [choice, setChoice] = useState<boolean | null>(null);
  const thinkingLive = item.streaming && !item.text;
  const open = choice ?? thinkingLive;
  return (
    <div className="flex flex-col gap-1.5">
      {item.thinking.trim() && (
        <div>
          <button className="flex items-center gap-1.5 text-[12px] text-muted hover:text-fg" onClick={() => setChoice(!open)} aria-expanded={open}>
            <Brain className="size-3.5" />
            {thinkingLive ? <span className="animate-pulse">Thinking…</span> : item.thinkingMs ? `Thought for ${fmtDuration(item.thinkingMs)}` : "Thought"}
            <ChevronRight className={clsx("size-3 transition-transform", open && "rotate-90")} />
          </button>
          {open && (
            <div className="mt-1.5 max-h-64 overflow-y-auto border-l-2 border-line pl-3 text-[12px] leading-relaxed whitespace-pre-wrap text-muted">{item.thinking.trim()}</div>
          )}
        </div>
      )}
      {item.text.trim() && <Markdown text={item.text} cwd={cwd} className="text-[13px]" />}
    </div>
  );
}

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "pending":
    case "running": return <Spinner className="size-3.5" />;
    case "approval": return <ShieldAlert className="size-3.5 text-accent" />;
    case "done": return <Check className="size-3.5 text-ok" />;
    case "error": return <X className="size-3.5 text-danger" />;
    case "denied": return <Ban className="size-3.5 text-faint" />;
  }
}

function ToolRow({ item, tabId, working }: { item: ToolItem; tabId: string; working: boolean }) {
  const [open, setOpen] = useState(false);
  const d = describe(item.name, item.input, item.status);
  const Icon = d.icon;
  const stale = !working && (item.status === "pending" || item.status === "running");
  if (item.status === "approval" && item.request) return <ApprovalCard item={item} tabId={tabId} />;
  return (
    <div className="text-[12.5px]">
      <button onClick={() => setOpen(!open)} className="group flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-hover/60">
        <Icon className="size-3.5 shrink-0 text-muted" />
        <span className={clsx("shrink-0", item.status === "denied" ? "text-faint line-through" : "text-fg")}>{d.verb}</span>
        <span className="min-w-0 truncate font-mono text-[12px] text-muted">{d.target}</span>
        {d.plus !== undefined && item.status !== "denied" && (
          <span className="shrink-0 font-mono text-[11px]"><span className="text-ok">+{d.plus}</span> <span className="text-danger">−{d.minus}</span></span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {item.status === "denied" && <span className="text-[11px] text-faint">declined</span>}
          {stale ? <X className="size-3.5 text-faint" /> : <StatusIcon status={item.status} />}
          <ChevronRight className={clsx("size-3 text-faint opacity-0 transition group-hover:opacity-100", open && "rotate-90 opacity-100")} />
        </span>
      </button>
      {open && <ToolDetails item={item} />}
    </div>
  );
}

/** What a step did: the diff of an edit, the file written, the command and its output. */
function ToolDetails({ item }: { item: ToolItem }) {
  const i = item.input ?? {};
  return (
    <div className="mt-1 ml-5 flex flex-col gap-1.5">
      {item.name === "edit" && <Diff before={str(i.old_string)} after={str(i.new_string)} />}
      {item.name === "write" && <Diff before="" after={str(i.content)} max={60} />}
      {item.name === "shell" && <Code>{`$ ${str(i.command)}`}</Code>}
      {item.output && !(item.name === "write" || item.name === "edit") && <Code muted={item.status !== "error"} danger={item.status === "error"}>{item.output}</Code>}
      {item.output && (item.name === "write" || item.name === "edit") && (item.status === "error" || item.status === "denied") && <Code danger>{item.output}</Code>}
    </div>
  );
}

function Code({ children, muted, danger }: { children: ReactNode; muted?: boolean; danger?: boolean }) {
  return (
    <pre className={clsx("max-h-72 overflow-auto rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap",
      danger ? "text-danger" : muted ? "text-muted" : "text-fg")}>{children}</pre>
  );
}

function Diff({ before, after, max = 200 }: { before: string; after: string; max?: number }) {
  const rows = useMemo(() => {
    const del = before ? before.replace(/\n$/, "").split("\n").map((l) => ["-", l] as const) : [];
    const add = after ? after.replace(/\n$/, "").split("\n").map((l) => ["+", l] as const) : [];
    return [...del, ...add];
  }, [before, after]);
  const shown = rows.slice(0, max);
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-line bg-panel py-1 font-mono text-[11.5px] leading-relaxed">
      {shown.map(([sign, text], n) => (
        <div key={n} className={clsx("flex whitespace-pre-wrap px-2", sign === "+" ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger")}>
          <span className="w-4 shrink-0 select-none opacity-70">{sign}</span><span className="text-fg/90">{text || " "}</span>
        </div>
      ))}
      {rows.length > max && <div className="px-2 text-faint">… {rows.length - max} more lines</div>}
    </div>
  );
}

/** A tool call waiting for the user: what it will do, and Allow / Always allow / Deny. */
function ApprovalCard({ item, tabId }: { item: ToolItem; tabId: string }) {
  const req = item.request!;
  const i = item.input ?? {};
  const title = req.kind === "exec" ? "Run this command?" : req.kind === "edit-outside" ? "Edit a file outside the project?" : `${item.name === "write" ? "Write" : "Edit"} ${basename(str(i.path))}?`;
  const deny = () => void answer(tabId, item.id, { decision: "deny" });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); deny(); }
  };
  return (
    <div onKeyDown={onKey} className="rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg"><ShieldAlert className="size-4 text-accent" />{title}</div>
      {item.name === "shell" && <Code>{str(i.command)}</Code>}
      {item.name === "edit" && <><div className="mb-1 font-mono text-[11.5px] text-muted">{str(i.path)}</div><Diff before={str(i.old_string)} after={str(i.new_string)} /></>}
      {item.name === "write" && <><div className="mb-1 font-mono text-[11.5px] text-muted">{str(i.path)}</div><Diff before="" after={str(i.content)} max={40} /></>}
      {!["shell", "edit", "write"].includes(item.name) && <Code>{req.summary}</Code>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button autoFocus size="sm" variant="primary" onClick={() => void answer(tabId, item.id, { decision: "allow" })}>Allow <kbd className="ml-1 opacity-60">↵</kbd></Button>
        <Button size="sm" onClick={() => void answer(tabId, item.id, { decision: "allow-for-session" })}>
          Always allow {item.name === "shell" ? "commands" : "edits"} in this chat
        </Button>
        <Button size="sm" variant="ghost" onClick={deny}>Deny <kbd className="ml-1 opacity-60">Esc</kbd></Button>
      </div>
    </div>
  );
}

function TurnEnd({ item }: { item: Extract<Item, { kind: "end" }> }) {
  if (item.end === "error") {
    return <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{item.error ?? "Something went wrong."}</div>;
  }
  const parts = [
    item.end === "stopped" ? "Stopped" : item.end === "stepLimit" ? "Paused after many steps. Say “continue” to keep going" : null,
    item.elapsedMs ? `Took ${fmtDuration(item.elapsedMs)}` : null,
    item.tokens ? `${fmtTokens(item.tokens)} tokens` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <div className="border-b border-line/60 pb-3 text-[11px] text-faint">{parts.join(" · ")}</div>;
}

/** Files this chat changed, with a shortcut to the Diff view (like Zed's edits bar). */
function EditedFiles({ items, onReview }: { items: Item[]; onReview: () => void }) {
  const files = useMemo(() => {
    const m = new Map<string, { plus: number; minus: number }>();
    for (const it of items) {
      if (it.kind !== "tool" || it.status !== "done" || (it.name !== "edit" && it.name !== "write")) continue;
      const d = describe(it.name, it.input, it.status);
      const f = m.get(d.target) ?? { plus: 0, minus: 0 };
      m.set(d.target, { plus: f.plus + (d.plus ?? 0), minus: f.minus + (d.minus ?? 0) });
    }
    return [...m.entries()];
  }, [items]);
  if (!files.length) return null;
  const plus = files.reduce((n, [, f]) => n + f.plus, 0);
  const minus = files.reduce((n, [, f]) => n + f.minus, 0);
  return (
    <div className="mx-auto mt-2 w-full max-w-[780px] px-5">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-panel/70 px-3 py-1.5 text-[12px]">
        <FilePen className="size-3.5 text-muted" />
        <span className="text-fg">{files.length} file{files.length === 1 ? "" : "s"} changed</span>
        <span className="font-mono text-[11px]"><span className="text-ok">+{plus}</span> <span className="text-danger">−{minus}</span></span>
        <span className="min-w-0 truncate text-faint" title={files.map(([p]) => p).join("\n")}>{files.map(([p]) => basename(p)).join(", ")}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onReview}><GitCompare className="size-3.5" />Review</Button>
      </div>
    </div>
  );
}

function Composer({ tabId, visible }: { tabId: string; visible: boolean }) {
  const chat = useAgent((s) => s.chats[tabId])!;
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (visible) box.current?.focus({ preventScroll: true }); }, [visible]);
  // grow with the text, up to about ten lines
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const submit = async () => {
    if (!text.trim() || chat.busy) return;
    const t = text;
    setText("");
    if (!(await send(tabId, t))) setText(t);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };
  const tokens = chat.usage.input_tokens + chat.usage.output_tokens;
  const cacheRate = chat.usage.input_tokens ? Math.round((chat.usage.cache_read_tokens / chat.usage.input_tokens) * 100) : null;
  const policy = POLICIES.find((p) => p.id === chat.policy)!;
  const PolicyIcon = chat.policy === "bypass" ? ShieldOff : chat.policy === "auto-edit" ? ShieldCheck : Shield;
  return (
    <div className="mx-auto w-full max-w-[780px] px-5 pt-2 pb-3">
      <div className="rounded-2xl border border-line bg-panel shadow-[0_6px_24px_rgba(0,0,0,0.25)] transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_14%,transparent)]">
        <textarea
          ref={box}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={chat.busy ? "Working… type your next message" : "Ask DevCat Agent to build, fix or explain something"}
          className="block max-h-[240px] min-h-[52px] w-full resize-none border-0 bg-transparent px-4 pt-3.5 pb-1 text-[13.5px] leading-relaxed text-fg outline-none placeholder:text-faint focus-visible:outline-none"
        />
        <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
          <label title={policy.hint} className={clsx("relative flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
            chat.policy === "bypass" ? "border-warn/40 bg-warn/10 text-warn" : "border-line text-muted hover:border-faint hover:text-fg")}>
            <PolicyIcon className="size-3.5" />
            {policy.label}
            <ChevronDown className="size-3 opacity-60" />
            <select value={chat.policy} onChange={(e) => setPolicy(tabId, e.target.value as AgentPolicy)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Permission mode">
              {POLICIES.map((p) => <option key={p.id} value={p.id}>{p.label}: {p.hint}</option>)}
            </select>
          </label>
          <span className="flex h-7 max-w-[220px] items-center gap-1.5 rounded-full bg-hover/70 px-2.5 text-[12px] text-muted" title={`${chat.providerName}: ${chat.model}`}>
            <Cpu className="size-3.5 shrink-0" /><span className="truncate">{chat.model}</span>
          </span>
          <span className="ml-auto flex items-center gap-2 text-[11px] text-faint">
            {tokens > 0 && (
              <span title={`${chat.usage.input_tokens.toLocaleString()} input tokens (${chat.usage.cache_read_tokens.toLocaleString()} from the provider's cache) · ${chat.usage.output_tokens.toLocaleString()} output tokens`}>
                {fmtTokens(tokens)} tokens{cacheRate !== null && cacheRate > 0 ? ` · ${cacheRate}% cached` : ""}
              </span>
            )}
          </span>
          {chat.busy ? (
            <button onClick={() => stop(tabId)} title="Stop" className="flex size-8 items-center justify-center rounded-full bg-fg text-app transition hover:opacity-85"><Square className="size-3 fill-current" /></button>
          ) : (
            <button onClick={() => void submit()} disabled={!text.trim()} title="Send (Enter) · new line: Shift+Enter"
              className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:brightness-110 disabled:bg-hover disabled:text-faint"><ArrowUp className="size-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
}
