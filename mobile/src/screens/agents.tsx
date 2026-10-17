// Agents: every terminal on the computer (agents first, sorted by what needs you), the live
// terminal with a key row, new chats, session history and readable transcripts.
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, FolderOpen, Laptop, MoreVertical, Plus, Send, Smartphone, Square, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { onEvent } from "../lib/rpc";
import { host, nav, refreshAgents, toastErr, useApp } from "../lib/store";
import type { AgentStatus, AiProvider, ClaudeProject, PtyInfo, SessionMeta } from "../lib/types";
import { Btn, Card, Confirm, Empty, ErrorBox, Field, Input, Item, Loading, Screen, Section, Seg, Sheet, Spinner, TextArea, ago, duration, folderName, useLoad } from "../ui";

const THEME = {
  background: "#0a0b0d", foreground: "#e6e8ec", cursor: "#f5a524", cursorAccent: "#0a0b0d", selectionBackground: "#f5a52440",
  black: "#1b1e24", red: "#f87171", green: "#4ade80", yellow: "#fbbf24", blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#c9cdd4",
  brightBlack: "#5c6370", brightRed: "#fca5a5", brightGreen: "#86efac", brightYellow: "#fde68a", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe", brightCyan: "#67e8f9", brightWhite: "#f3f4f6",
};

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const fromPhone = (t: PtyInfo) => t.origin.startsWith("phone:");
/** The project folder: where Claude says it works (hooks), else where the terminal started. */
const cwdOf = (t: PtyInfo | undefined, a: AgentStatus | undefined) => a?.cwd || t?.cwd || "";
const OriginIcon = ({ t }: { t: PtyInfo }) => fromPhone(t) ? <Smartphone className="inline size-3" /> : <Laptop className="inline size-3" />;

function statusLine(t: PtyInfo, a: AgentStatus | undefined): string {
  const origin = fromPhone(t) ? `from ${t.origin.slice(6)}` : "on the computer";
  if (!a) return `${t.program} · ${origin} · ${ago(t.startedAt)}`;
  if (a.status === "working") return `${t.program} · ${origin} · working ${duration(Date.now() - a.since)}`;
  if (a.status === "idle") return `${t.program} · finished ${ago(a.since)}${a.lastTurnMs ? ` after ${duration(a.lastTurnMs)}` : ""}`;
  return `${t.program} · ${origin}`;
}

// ------------------------------------------------------------------ list

export function Agents() {
  const terms = useApp((s) => s.terms);
  const agents = useApp((s) => s.agents);
  const conn = useApp((s) => s.conn[s.current ?? ""]);
  const machine = useApp((s) => s.machines.find((m) => m.id === s.current));
  const [, tick] = useState(0);
  useEffect(() => {
    void refreshAgents();
    const t = setInterval(() => { if (!document.hidden) { void refreshAgents(); tick((x) => x + 1); } }, 5000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => {
    const agentTerms = terms.filter((t) => t.agent);
    const st = (t: PtyInfo) => agents[t.id]?.status;
    return {
      waiting: agentTerms.filter((t) => st(t) === "waiting"),
      working: agentTerms.filter((t) => st(t) === "working"),
      done: agentTerms.filter((t) => st(t) !== "waiting" && st(t) !== "working"),
      other: terms.filter((t) => !t.agent),
    };
  }, [terms, agents]);
  const open = (t: PtyInfo) => nav.push({ s: "terminal", id: t.id });
  const offline = conn?.state !== "online";

  return (
    <Screen
      title="Agents"
      sub={<>{machine?.name ?? "Computer"} · {conn?.state === "online" ? <span className="text-ok">● online</span> : conn?.state === "connecting" ? "connecting…" : <span>○ offline</span>}</>}
      right={<>
        <Btn size="sm" variant="primary" onClick={() => nav.push({ s: "newchat" })}><Plus className="size-4" />New</Btn>
      </>}
      tab="agents"
    >
      {offline && conn?.error && <ErrorBox error={conn.error} onRetry={() => void refreshAgents()} />}
      {terms.length === 0 && !offline && (
        <Empty icon={<TerminalSquare className="size-8" />} title="No agents running">Start one with <b className="text-fg">New</b>. It runs on the computer and keeps going when you close this app.</Empty>
      )}
      {groups.waiting.length > 0 && <Section>Needs you</Section>}
      {groups.waiting.map((t) => (
        <Card key={t.id} tone="warn" onClick={() => open(t)}>
          <div className="flex items-center gap-2"><AlertTriangle className="size-4 text-warn" /><b className="min-w-0 flex-1 truncate">{folderName(cwdOf(t, agents[t.id]))}</b><span className="text-[11px] text-muted">{t.program} · <OriginIcon t={t} /></span></div>
          <div className="mt-1 text-[12.5px]">{agents[t.id]?.message ?? "Waiting for you"}</div>
        </Card>
      ))}
      {groups.working.length > 0 && <Section>Working</Section>}
      {groups.working.map((t) => (
        <Item key={t.id} onClick={() => open(t)} icon={<Spinner className="size-4 text-warn" />} title={folderName(cwdOf(t, agents[t.id]))} meta={statusLine(t, agents[t.id])} chevron />
      ))}
      {groups.done.length > 0 && <Section>{groups.done.some((t) => agents[t.id]) ? "Done" : "Agents"}</Section>}
      {groups.done.map((t) => (
        <Item key={t.id} onClick={() => open(t)} icon={agents[t.id] ? <CheckCircle2 className="size-4 text-ok" /> : <Clock className="size-4" />} title={folderName(cwdOf(t, agents[t.id]))} meta={statusLine(t, agents[t.id])} chevron />
      ))}
      {groups.other.length > 0 && <Section>Terminals</Section>}
      {groups.other.map((t) => (
        <Item key={t.id} onClick={() => open(t)} icon={<ChevronRight className="size-4" />} title={t.program} meta={<>{t.cwd} · <OriginIcon t={t} /></>} />
      ))}
      <div className="pt-2"><Btn block onClick={() => nav.push({ s: "sessions" })}><Clock className="size-4" />Session history</Btn></div>
    </Screen>
  );
}

// ------------------------------------------------------------------ terminal

const KEYS: [string, string][] = [["1", "1"], ["2", "2"], ["3", "3"], ["Esc", "\x1b"], ["Tab", "\t"], ["⇧Tab", "\x1b[Z"], ["↑", "\x1b[A"], ["↓", "\x1b[B"], ["←", "\x1b[D"], ["→", "\x1b[C"], ["⏎", "\r"], ["^C", "\x03"]];
const FONT = "\"JetBrains Mono\", \"SF Mono\", Menlo, monospace";
/** Width of one character cell per px of font size (monospace). */
const CELL = 0.602;

export function Terminal({ id }: { id: string }) {
  const term = useApp((s) => s.terms.find((t) => t.id === id));
  const agent = useApp((s) => s.agents[id]);
  const readonly = useApp((s) => s.machines.find((m) => m.id === s.current)?.access === "readonly");
  const box = useRef<HTMLDivElement>(null);
  const xt = useRef<XTerm | null>(null);
  const [info, setInfo] = useState<PtyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [stop, setStop] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem("devcat.mobile.termFont")) || 11);
  const [fitWidth, setFitWidth] = useState(false);

  const write = (data: string) => {
    if (readonly) return;
    void host("pty_write", { id, data }).catch(toastErr);
  };

  // attach: scrollback first, then live output
  useEffect(() => {
    let disposed = false;
    const t = new XTerm({ fontFamily: FONT, fontSize, lineHeight: 1.1, cursorBlink: false, scrollback: 5000, allowProposedApi: true, theme: THEME, convertEol: false });
    t.loadAddon(new Unicode11Addon());
    t.unicode.activeVersion = "11";
    xt.current = t;
    t.onData((d) => write(d));
    const attach = async () => {
      try {
        const r = await host<{ info: PtyInfo; data: string }>("pty_attach", { id });
        if (disposed) return;
        setInfo(r.info);
        let cols = r.info.cols, rows = r.info.rows;
        if (r.info.origin.startsWith("phone:") && box.current) {
          // Terminals started here follow the phone's screen.
          cols = Math.max(30, Math.floor((box.current.clientWidth - 8) / (fontSize * CELL)));
          rows = Math.max(12, Math.floor((box.current.clientHeight - 8) / (fontSize * 1.1 * 1.17)));
          void host("pty_resize", { id, cols, rows }).catch(() => {});
        }
        t.resize(cols, rows);
        if (!t.element && box.current) t.open(box.current);
        t.reset();
        t.write(b64ToBytes(r.data));
        t.scrollToBottom();
      } catch (e) {
        if (!disposed) setError(typeof e === "string" ? e : String(e));
      }
    };
    const offOut = onEvent<{ id: string; data: string }>("pty-output", (p) => { if (p.id === id) t.write(b64ToBytes(p.data)); });
    const offLag = onEvent<{ id: string }>("pty-lagged", (p) => { if (p.id === id) void attach(); });
    const offExit = onEvent<{ id: string }>("pty-exit", (p) => { if (p.id === id) setExited(true); });
    void attach();
    const onVis = () => { if (!document.hidden) void attach(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      offOut(); offLag(); offExit();
      document.removeEventListener("visibilitychange", onVis);
      void host("pty_detach", { id }).catch(() => {});
      t.dispose();
      xt.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // text size / fit to width
  useEffect(() => {
    const t = xt.current;
    if (!t || !info || !box.current) return;
    const size = fitWidth ? Math.max(5, Math.min(14, (box.current.clientWidth - 8) / (t.cols * CELL))) : fontSize;
    t.options.fontSize = size;
    localStorage.setItem("devcat.mobile.termFont", String(fontSize));
  }, [fontSize, fitWidth, info]);

  const send = () => {
    if (!text) { write("\r"); return; }
    write(text);
    // A separate Enter, so the program doesn't treat it as part of a paste.
    setTimeout(() => write("\r"), 60);
    setText("");
  };

  const st = agent?.status;
  const sub = exited ? "exited" : st === "waiting" ? <span className="text-warn">⚠ {agent?.message ?? "waiting for you"}</span> : st === "working" ? <span className="text-warn">◐ working</span> : st === "idle" ? <span className="text-ok">✓ done</span> : (term?.program ?? info?.program ?? "");

  return (
    <Screen title={folderName(cwdOf(term ?? info ?? undefined, agent)) || "Terminal"} sub={sub} scroll={false} className="flex flex-col gap-2 p-2"
      right={<button aria-label="Terminal menu" className="flex size-9 items-center justify-center text-muted" onClick={() => setMenu(true)}><MoreVertical className="size-5" /></button>}>
      {error && <ErrorBox error={error} />}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-[#0a0b0d] p-1">
        <div ref={box} className="h-full min-w-full" />
      </div>
      {exited && <div className="rounded-lg bg-hover px-3 py-1.5 text-center text-[12px] text-muted">The program exited.</div>}
      {readonly ? (
        <div className="rounded-lg bg-hover px-3 py-2 text-center text-[12px] text-muted">Read-only access: you can watch but not type.</div>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {KEYS.map(([label, seq]) => (
              <button key={label} onClick={() => write(seq)} className="h-8 min-w-9 shrink-0 rounded-lg border border-line bg-hover px-2 font-mono text-[12px] font-semibold active:bg-line">{label}</button>
            ))}
          </div>
          <div className="flex items-end gap-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <TextArea rows={1} className="max-h-28 min-h-11 flex-1 resize-none" placeholder={term?.agent ? "Message Claude…" : "Type a command…"} value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button aria-label="Send" onClick={send} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg active:brightness-90"><Send className="size-5" /></button>
          </div>
        </>
      )}
      <Sheet open={menu} onClose={() => setMenu(false)} title={folderName(cwdOf(term ?? info ?? undefined, agent))}>
        <div className="text-[12px] text-muted">{cwdOf(term ?? info ?? undefined, agent)} · {info?.program} · {info && (fromPhone(info) ? `started from ${info.origin.slice(6)}` : "started on the computer")}{info ? ` ${ago(info.startedAt)}` : ""}</div>
        <Item onClick={() => { setFitWidth(!fitWidth); setMenu(false); }} title={fitWidth ? "Normal text size" : "Fit text to screen width"} />
        <div className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2">
          <span className="flex-1 font-semibold">Text size</span>
          <Btn size="sm" onClick={() => { setFitWidth(false); setFontSize((s) => Math.max(7, s - 1)); }}>A−</Btn>
          <span className="w-6 text-center tabular-nums">{fontSize}</span>
          <Btn size="sm" onClick={() => { setFitWidth(false); setFontSize((s) => Math.min(18, s + 1)); }}>A+</Btn>
        </div>
        <Item onClick={() => { setMenu(false); const dir = cwdOf(term ?? info ?? undefined, agent); nav.push({ s: "files", dir, root: dir }); }} icon={<FolderOpen className="size-4" />} title="Browse files" chevron />
        {agent?.sessionId && agent.cwd && (
          <Item onClick={() => { setMenu(false); nav.push({ s: "transcript", cwd: agent.cwd!, sessionId: agent.sessionId!, title: folderName(agent.cwd) }); }} title="Open session transcript" chevron />
        )}
        {!readonly && <Item onClick={() => { setMenu(false); setStop(true); }} icon={<Square className="size-4 text-danger" />} title={<span className="text-danger">{term?.agent ? "Stop agent" : "Close terminal"}</span>} />}
      </Sheet>
      <Confirm open={stop} danger title={term?.agent ? "Stop this agent?" : "Close this terminal?"} confirm="Stop"
        onCancel={() => setStop(false)}
        onConfirm={() => { setStop(false); void host("pty_close", { id }).then(() => nav.back()).catch(toastErr); }}>
        {info && !fromPhone(info) ? <>It was started on the computer; it closes there too.</> : <>The program is ended on the computer.</>}
      </Confirm>
    </Screen>
  );
}

// ------------------------------------------------------------------ new chat

export function NewChat({ cwd: initial }: { cwd?: string }) {
  const projects = useLoad(() => host<ClaudeProject[]>("claude_projects"), []);
  const providers = useLoad(() => host<AiProvider[]>("ai_providers_list"), []);
  const [cwd, setCwd] = useState(initial ?? "");
  const [other, setOther] = useState("");
  const [provider, setProvider] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const recent = useMemo(() => [...(projects.data ?? [])].sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? "")).slice(0, 8), [projects.data]);
  useEffect(() => { if (!cwd && recent[0]) setCwd(recent[0].cwd); }, [recent, cwd]);
  const folder = other.trim() || cwd;

  const start = async () => {
    setBusy(true);
    try {
      const cols = Math.max(30, Math.floor((window.innerWidth - 24) / (11 * CELL)));
      const rows = Math.max(16, Math.floor((window.innerHeight - 260) / (11 * 1.1 * 1.17)));
      const args = msg.trim() ? [msg.trim()] : [];
      const info = await host<PtyInfo>("pty_open", { cwd: folder, program: provider ? null : "claude", args, cols, rows, providerId: provider || null });
      useApp.setState({ terms: [...useApp.getState().terms.filter((t) => t.id !== info.id), info] });
      nav.replace({ s: "terminal", id: info.id });
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="New chat">
      <Section>Project folder (on the computer)</Section>
      {projects.loading ? <Loading /> : projects.error ? <ErrorBox error={projects.error} /> : recent.map((p) => (
        <button key={p.cwd} onClick={() => { setCwd(p.cwd); setOther(""); }} className={clsx("flex w-full items-center gap-3 rounded-xl bg-raised px-3 py-2.5 text-left", cwd === p.cwd && !other && "ring-1 ring-accent")}>
          <span className={clsx("size-4 shrink-0 rounded-full border-2", cwd === p.cwd && !other ? "border-accent bg-[radial-gradient(var(--color-accent)_40%,transparent_45%)]" : "border-faint")} />
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{folderName(p.cwd)}</span><span className="block truncate text-[11px] text-muted">{p.cwd} · {p.sessionCount} sessions</span></span>
        </button>
      ))}
      <Field label="Or another folder" hint="A full path on the computer, e.g. ~/Projects/api">
        <Input value={other} placeholder="~/Projects/…" onChange={(e) => setOther(e.target.value)} />
      </Field>
      <Field label="Agent">
        <select className="h-11 w-full rounded-xl border border-line bg-panel px-3 text-[14px]" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">Claude Code</option>
          {(providers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="First message (optional)">
        <TextArea rows={3} value={msg} placeholder="Fix the failing checkout tests" onChange={(e) => setMsg(e.target.value)} />
      </Field>
      <button className="text-[13px] font-semibold text-accent" onClick={() => nav.push({ s: "sessions", cwd: folder || undefined })}>↺ Resume a previous session instead</button>
      <Btn variant="primary" block loading={busy} disabled={!folder} onClick={() => void start()}>Start</Btn>
    </Screen>
  );
}

// ------------------------------------------------------------------ sessions

export function Sessions({ cwd: initial }: { cwd?: string }) {
  const projects = useLoad(() => host<ClaudeProject[]>("claude_projects"), []);
  const sorted = useMemo(() => [...(projects.data ?? [])].sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? "")), [projects.data]);
  const [cwd, setCwd] = useState(initial ?? "");
  useEffect(() => { if (!cwd && sorted[0]) setCwd(sorted[0].cwd); }, [sorted, cwd]);
  const sessions = useLoad(() => (cwd ? host<SessionMeta[]>("claude_sessions", { cwd }) : Promise.resolve([] as SessionMeta[])), [cwd]);
  const [q, setQ] = useState("");
  const list = (sessions.data ?? []).filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen title="Session history" sub={cwd || undefined}>
      {projects.error && <ErrorBox error={projects.error} />}
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1">
        {sorted.slice(0, 12).map((p) => (
          <button key={p.cwd} onClick={() => setCwd(p.cwd)} className={clsx("shrink-0 rounded-full px-3 py-1.5 text-[12.5px]", p.cwd === cwd ? "bg-accent/20 font-semibold text-accent" : "bg-hover text-muted")}>{folderName(p.cwd)}</button>
        ))}
      </div>
      <Input placeholder="Search sessions" value={q} onChange={(e) => setQ(e.target.value)} />
      {sessions.loading ? <Loading /> : sessions.error ? <ErrorBox error={sessions.error} /> : list.length === 0 ? <Empty title="No sessions here yet" /> : list.map((s) => (
        <Item key={s.id} onClick={() => nav.push({ s: "transcript", cwd, sessionId: s.id, title: s.title })} title={s.title}
          meta={`${s.messageCount} messages${s.gitBranch ? ` · ${s.gitBranch}` : ""}${s.costUsd ? ` · $${s.costUsd.toFixed(2)}` : ""}`}
          right={<span className="text-[11px] text-muted">{ago(s.updatedAt)}</span>} />
      ))}
    </Screen>
  );
}

type Block = { kind: "me" | "ai" | "tool"; text: string };

function blocks(entries: any[]): Block[] {
  const out: Block[] = [];
  for (const e of entries) {
    const role = e?.message?.role ?? e?.type;
    const content = e?.message?.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content === "string") {
      if (content.trim() && !content.startsWith("<")) out.push({ kind: role === "user" ? "me" : "ai", text: content });
      continue;
    }
    for (const c of Array.isArray(content) ? content : []) {
      if (c?.type === "text" && c.text?.trim()) {
        if (role === "user" && c.text.startsWith("<")) continue; // command / system wrappers
        out.push({ kind: role === "user" ? "me" : "ai", text: c.text });
      } else if (c?.type === "tool_use") {
        const input = c.input ?? {};
        const arg = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? "";
        out.push({ kind: "tool", text: `${c.name}${arg ? ` ${String(arg).split("\n")[0].slice(0, 120)}` : ""}` });
      }
    }
  }
  return out;
}

export function Transcript({ cwd, sessionId, title }: { cwd: string; sessionId: string; title: string }) {
  const t = useLoad(() => host<unknown[]>("claude_transcript", { cwd, sessionId }), [cwd, sessionId]);
  const list = useMemo(() => blocks(t.data ?? []), [t.data]);
  const [mode, setMode] = useState<"all" | "chat">("all");
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      const cols = Math.max(30, Math.floor((window.innerWidth - 24) / (11 * CELL)));
      const info = await host<PtyInfo>("pty_open", { cwd, program: "claude", args: ["--resume", sessionId], cols, rows: 40 });
      useApp.setState({ terms: [...useApp.getState().terms, info] });
      nav.push({ s: "terminal", id: info.id });
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={title} sub={folderName(cwd)} right={<Btn size="sm" variant="primary" loading={busy} onClick={() => void resume()}>Resume</Btn>}>
      <Seg value={mode} onChange={setMode} options={[{ value: "all", label: "Everything" }, { value: "chat", label: "Messages only" }]} />
      {t.loading ? <Loading /> : t.error ? <ErrorBox error={t.error} /> : list.length === 0 ? <Empty title="Nothing to show" /> : (
        <div className="flex flex-col gap-2">
          {list.filter((b) => mode === "all" || b.kind !== "tool").map((b, i) => b.kind === "tool" ? (
            <div key={i} className="border-l-2 border-line py-0.5 pl-2.5 font-mono text-[11px] break-all text-muted">▸ {b.text}</div>
          ) : (
            <div key={i} className={clsx("selectable max-w-[92%] rounded-xl px-3 py-2 text-[13px] break-words whitespace-pre-wrap", b.kind === "me" ? "self-end bg-accent/15" : "bg-raised")}>
              {b.text.length > 2500 ? `${b.text.slice(0, 2500)}…` : b.text}
            </div>
          ))}
        </div>
      )}
      <div className="h-2" />
      {busy && <Spinner />}
    </Screen>
  );
}
