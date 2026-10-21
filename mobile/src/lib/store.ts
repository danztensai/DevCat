// App state: paired computers, the selected one, connection states, live agent status, the
// navigation stack (mirrored into browser history so Android's back button works) and toasts.
import { create } from "zustand";
import { call, errMsg, onConn, onEvent, phone, type ConnState, type Machine, type PhoneInfo } from "./rpc";
import type { AgentPending, AgentStatus, PtyInfo, Route, TabRoot } from "./types";

export interface Toast { id: number; text: string; tone: "ok" | "err" | "info" }

interface State {
  info: PhoneInfo | null;
  machines: Machine[];
  current: string | null;
  conn: Record<string, { state: ConnState; error?: string | null }>;
  /** Live terminals and agent status of the current computer. */
  terms: PtyInfo[];
  agents: Record<string, AgentStatus>;
  /** DevCat Agent approvals and questions waiting on the current computer. */
  agentPending: AgentPending[];
  stack: Route[];
  toasts: Toast[];
}

const LAST = "devcat.mobile.current";

export const useApp = create<State>(() => ({
  info: null,
  machines: [],
  current: localStorage.getItem(LAST),
  conn: {},
  terms: [],
  agents: {},
  agentPending: [],
  stack: [{ s: "loading" }],
  toasts: [],
}));

const get = useApp.getState;
const set = useApp.setState;

// ------------------------------------------------------------------ navigation

let ignorePops = 0;
window.addEventListener("popstate", () => {
  if (ignorePops > 0) { ignorePops--; return; }
  const st = get().stack;
  if (st.length > 1) set({ stack: st.slice(0, -1) });
});

export const nav = {
  push(r: Route) {
    history.pushState(null, "");
    set({ stack: [...get().stack, r] });
  },
  /** Back one screen (same as the system back button). */
  back() {
    if (get().stack.length > 1) history.back();
  },
  replace(r: Route) {
    const st = get().stack;
    set({ stack: [...st.slice(0, -1), r] });
  },
  /** Start over with this stack (history follows). */
  reset(stack: Route[]) {
    const diff = stack.length - get().stack.length;
    if (diff > 0) for (let i = 0; i < diff; i++) history.pushState(null, "");
    else if (diff < 0) { ignorePops++; history.go(diff); }
    set({ stack });
  },
  /** Switch the bottom tab: Computers › tab root. */
  tab(t: TabRoot) {
    nav.reset([{ s: "computers" }, { s: t }]);
  },
};

export const top = (): Route => { const s = get().stack; return s[s.length - 1]; };

// ------------------------------------------------------------------ toasts

let toastId = 0;
export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = ++toastId;
  set({ toasts: [...get().toasts, { id, text, tone }] });
  setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), tone === "err" ? 5000 : 2800);
}
export const toastErr = (e: unknown) => toast(errMsg(e), "err");

// ------------------------------------------------------------------ computers

export async function loadMachines(): Promise<Machine[]> {
  const machines = await phone.machines();
  set({ machines });
  return machines;
}

export function selectMachine(id: string) {
  localStorage.setItem(LAST, id);
  set({ current: id, terms: [], agents: {} });
  void refreshAgents();
}

export function currentMachine(): Machine | null {
  const { machines, current } = get();
  return machines.find((m) => m.id === current) ?? null;
}

/** Call a command on the selected computer. */
export function host<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const id = get().current;
  if (!id) return Promise.reject("No computer selected");
  return call<T>(id, cmd, args);
}

export async function refreshAgents() {
  const id = get().current;
  if (!id) return;
  try {
    const r = await call<{ terminals: PtyInfo[]; agents: AgentStatus[] }>(id, "agents");
    if (get().current !== id) return;
    set({ terms: r.terminals, agents: Object.fromEntries(r.agents.map((a) => [a.ptyId, a])) });
    // older computers don't know this command: then there's nothing to show
    const pending = await call<AgentPending[]>(id, "agent_pending").catch(() => [] as AgentPending[]);
    if (get().current === id) set({ agentPending: pending });
  } catch { /* offline: the connection state shows it */ }
}

/** How many agents wait for the user on the selected computer. */
export function waitingCount(s: State = get()): number {
  return Object.values(s.agents).filter((a) => a.status === "waiting" && s.terms.some((t) => t.id === a.ptyId)).length + s.agentPending.length;
}

/** Answer a DevCat Agent approval (`decision`) or question (`answer`) on the current computer. */
export async function answerAgent(p: AgentPending, reply: { decision: "allow" | "allow-for-session" | "deny" } | { answer: string }) {
  // gone from the list at once; the computer confirms with agent-pending
  set({ agentPending: get().agentPending.filter((x) => x.toolUseId !== p.toolUseId) });
  try {
    if ("answer" in reply) await host("agent_answer", { sessionId: p.sessionId, toolUseId: p.toolUseId, answer: reply.answer });
    else await host("agent_approve", { sessionId: p.sessionId, toolUseId: p.toolUseId, decision: { decision: reply.decision } });
  } catch (e) {
    toastErr(e);
  } finally {
    void refreshAgents();
  }
}

// ------------------------------------------------------------------ events

let notify: ((title: string, body: string) => void) | null = null;
export function setLocalNotifier(fn: (title: string, body: string) => void) { notify = fn; }

const folder = (p?: string | null) => (p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "agent";

/** "run a command", "edit notes.txt", … for an approval. */
export function verb(p: AgentPending): string {
  const r = p.request;
  if (!r) return "do something";
  switch (r.kind) {
    case "exec": return r.tool === "db_query" ? "change data" : "run a command";
    case "fetch": return "fetch a page";
    case "query": return "read from a connection";
    case "edit-outside": return "edit a file outside the project";
    default: return r.tool === "write" ? "write a file" : "edit a file";
  }
}

export function startStateEvents() {
  onConn((id, state, error) => {
    set({ conn: { ...get().conn, [id]: { state, error } } });
    if (state === "online" && id === get().current) void refreshAgents();
    if (state === "online") void loadMachines();
  });
  onEvent<AgentStatus>("agent-status", (a, mid) => {
    if (mid !== get().current) return;
    const prev = get().agents[a.ptyId];
    set({ agents: { ...get().agents, [a.ptyId]: a } });
    if (!get().terms.some((t) => t.id === a.ptyId)) void refreshAgents();
    const changed = prev?.status !== a.status;
    if (!changed) return;
    const watching = (() => { const r = top(); return r.s === "terminal" && r.id === a.ptyId; })();
    if (a.status === "waiting") {
      const msg = `${folder(a.cwd)}: ${a.message ?? "needs you"}`;
      if (document.hidden) notify?.(`${folder(a.cwd)} needs you`, a.message ?? "");
      else if (!watching) toast(msg, "info");
    } else if (a.status === "idle" && prev?.status === "working") {
      if (document.hidden) notify?.(`${folder(a.cwd)} finished`, "The agent is done.");
      else if (!watching) toast(`${folder(a.cwd)} finished`, "ok");
    }
  });
  onEvent<{ ptyId: string }>("agent-gone", (p, mid) => {
    if (mid !== get().current) return;
    const { [p.ptyId]: _gone, ...rest } = get().agents;
    set({ agents: rest });
  });
  onEvent<{ id: string }>("pty-exit", (p, mid) => {
    if (mid !== get().current) return;
    set({ terms: get().terms.filter((t) => t.id !== p.id) });
  });
  onEvent<{ items: AgentPending[] }>("agent-pending", (p, mid) => {
    if (mid !== get().current) return;
    const before = new Set(get().agentPending.map((x) => x.toolUseId));
    set({ agentPending: p.items });
    for (const x of p.items.filter((x) => !before.has(x.toolUseId))) {
      const what = x.kind === "question" ? x.question?.question ?? "has a question" : `wants to ${verb(x)}`;
      if (document.hidden) notify?.(`${folder(x.folder)}: DevCat Agent needs you`, what);
      else if (top().s !== "agents") toast(`${folder(x.folder)}: ${what}`, "info");
    }
  });
  onEvent<PtyInfo>("remote-pty-opened", (p, mid) => {
    if (mid !== get().current) return;
    if (!get().terms.some((t) => t.id === p.id)) set({ terms: [...get().terms, p] });
  });
}
