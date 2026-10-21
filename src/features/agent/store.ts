// DevCat Agent chats: one per AI workspace tab. The backend runs the turn and reports through
// `agent-event`; this store turns the session log (on open) and the live events into a list of
// items the chat view draws: user messages, answers, tool steps and turn summaries.
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { api, errMsg } from "../../lib/api";
import type { AgentApprovalRequest, AgentBlock, AgentDecision, AgentLiveEvent, AgentPolicy, AgentSessionEvent, AgentUsage } from "../../lib/types";

export type ToolStatus = "pending" | "approval" | "running" | "done" | "error" | "denied";

export type Item =
  | { kind: "user"; key: string; text: string }
  | { kind: "answer"; key: string; text: string; thinking: string; streaming: boolean; thinkingMs: number | null; thinkingStart: number | null }
  | { kind: "tool"; key: string; id: string; name: string; input: Record<string, unknown> | null; status: ToolStatus; output: string; request: AgentApprovalRequest | null }
  | { kind: "end"; key: string; end: "answered" | "stepLimit" | "stopped" | "error"; error: string | null; elapsedMs: number | null; tokens: number };

export interface Chat {
  sessionId: string | null;
  title: string;
  model: string;
  providerName: string;
  busy: boolean;
  opening: boolean;
  error: string | null;
  items: Item[];
  usage: AgentUsage;
  policy: AgentPolicy;
}

const ZERO: AgentUsage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
const KEY_POLICY = "devcat.agent.policy";

function savedPolicy(): AgentPolicy {
  try {
    const p = localStorage.getItem(KEY_POLICY);
    return p === "auto-edit" || p === "bypass" ? p : "ask";
  } catch {
    return "ask";
  }
}

const emptyChat = (): Chat => ({ sessionId: null, title: "", model: "", providerName: "", busy: false, opening: true, error: null, items: [], usage: ZERO, policy: savedPolicy() });

export const useAgent = create<{ chats: Record<string, Chat> }>(() => ({ chats: {} }));

let seq = 0;
const key = () => `i${++seq}`;

function patch(tabId: string, f: (c: Chat) => Partial<Chat>) {
  useAgent.setState((s) => {
    const c = s.chats[tabId] ?? emptyChat();
    return { chats: { ...s.chats, [tabId]: { ...c, ...f(c) } } };
  });
}

const tabOfSession = (sessionId: string) => Object.entries(useAgent.getState().chats).find(([, c]) => c.sessionId === sessionId)?.[0];

/** Items for a session log (an opened or resumed chat). */
export function itemsFromLog(events: AgentSessionEvent[]): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, Extract<Item, { kind: "tool" }>>();
  for (const e of events) {
    if (e.event === "user") items.push({ kind: "user", key: key(), text: e.text });
    else if (e.event === "assistant") addBlocks(items, tools, e.content);
    else if (e.event === "tool_results") {
      for (const r of e.results) if (r.type === "tool_result") finishTool(tools.get(r.tool_use_id), r.content, !!r.is_error);
    } else if (e.event === "approval" && !e.allowed) {
      const t = tools.get(e.tool_use_id);
      if (t) t.status = "denied";
    } else if (e.event === "interrupted") {
      items.push({ kind: "end", key: key(), end: e.reason.startsWith("Stopped by") ? "stopped" : "error", error: e.reason.startsWith("Stopped by") ? null : e.reason, elapsedMs: null, tokens: 0 });
    }
  }
  return items;
}

function addBlocks(items: Item[], tools: Map<string, Extract<Item, { kind: "tool" }>>, content: AgentBlock[]) {
  const text = content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const thinking = content.filter((b) => b.type === "thinking").map((b) => (b as { text: string }).text).join("");
  if (text.trim() || thinking.trim()) items.push({ kind: "answer", key: key(), text, thinking, streaming: false, thinkingMs: null, thinkingStart: null });
  for (const b of content) {
    if (b.type !== "tool_use") continue;
    const t: Extract<Item, { kind: "tool" }> = { kind: "tool", key: key(), id: b.id, name: b.name, input: b.input, status: "done", output: "", request: null };
    tools.set(b.id, t);
    items.push(t);
  }
}

function finishTool(t: Extract<Item, { kind: "tool" }> | undefined, content: string, isError: boolean) {
  if (!t) return;
  t.output = content;
  t.status = t.status === "denied" || content.startsWith("The user declined") ? "denied" : isError ? "error" : "done";
}

/** Apply one live event to a chat's items (a new array; items that change are replaced). */
function apply(c: Chat, e: AgentLiveEvent): Partial<Chat> {
  const items = [...c.items];
  const last = items[items.length - 1];
  const now = Date.now();
  const toolIdx = (id: string) => items.findIndex((i) => i.kind === "tool" && i.id === id);
  const setTool = (id: string, f: (t: Extract<Item, { kind: "tool" }>) => Partial<Extract<Item, { kind: "tool" }>>) => {
    const i = toolIdx(id);
    if (i >= 0) items[i] = { ...(items[i] as Extract<Item, { kind: "tool" }>), ...f(items[i] as Extract<Item, { kind: "tool" }>) };
  };
  switch (e.type) {
    case "turnStart":
      items.push({ kind: "user", key: key(), text: e.text });
      return { items, busy: true, error: null };
    case "thinking":
    case "text": {
      if (last?.kind === "answer" && last.streaming) {
        const a = { ...last };
        if (e.type === "thinking") a.thinking += e.text;
        else {
          if (a.thinkingStart && a.thinkingMs === null) a.thinkingMs = now - a.thinkingStart;
          a.text += e.text;
        }
        items[items.length - 1] = a;
      } else {
        const thinking = e.type === "thinking" ? e.text : "";
        items.push({ kind: "answer", key: key(), text: e.type === "text" ? e.text : "", thinking, streaming: true, thinkingMs: null, thinkingStart: thinking ? now : null });
      }
      return { items };
    }
    case "toolStart":
      if (last?.kind === "answer" && last.streaming && last.thinkingStart && last.thinkingMs === null) items[items.length - 1] = { ...last, thinkingMs: now - last.thinkingStart };
      if (toolIdx(e.id) < 0 && e.id) items.push({ kind: "tool", key: key(), id: e.id, name: e.name, input: null, status: "pending", output: "", request: null });
      return { items };
    case "step": {
      // The finished step: close the streamed answer, or add it when nothing was streamed.
      const streamed = items.findIndex((i) => i.kind === "answer" && i.streaming);
      if (streamed >= 0) {
        const a = items[streamed] as Extract<Item, { kind: "answer" }>;
        items[streamed] = { ...a, streaming: false, thinkingMs: a.thinkingMs ?? (a.thinkingStart ? now - a.thinkingStart : null) };
      } else {
        const tmp: Item[] = [];
        addBlocks(tmp, new Map(), e.content.filter((b) => b.type !== "tool_use"));
        items.push(...tmp);
      }
      for (const b of e.content) {
        if (b.type !== "tool_use") continue;
        if (toolIdx(b.id) >= 0) setTool(b.id, () => ({ input: b.input, name: b.name }));
        else items.push({ kind: "tool", key: key(), id: b.id, name: b.name, input: b.input, status: "pending", output: "", request: null });
      }
      const usage = { input_tokens: c.usage.input_tokens + e.usage.input_tokens, output_tokens: c.usage.output_tokens + e.usage.output_tokens, cache_read_tokens: c.usage.cache_read_tokens + e.usage.cache_read_tokens };
      return { items, usage };
    }
    case "approval":
      setTool(e.request.toolUseId, () => ({ status: "approval", request: e.request, input: e.request.input }));
      return { items };
    case "toolCall":
      setTool(e.id, () => ({ status: "running", request: null, input: e.input }));
      return { items };
    case "toolResult":
      setTool(e.id, (t) => ({
        output: e.content,
        request: null,
        status: t.status === "approval" || e.content.startsWith("The user declined") ? "denied" : e.is_error ? "error" : "done",
      }));
      return { items };
    case "turnEnd": {
      const closed = items.map((i) => (i.kind === "answer" && i.streaming ? { ...i, streaming: false } : i.kind === "tool" && (i.status === "pending" || i.status === "running" || i.status === "approval") ? { ...i, status: "error" as const, request: null } : i));
      const tokens = e.usage.input_tokens + e.usage.output_tokens;
      closed.push({ kind: "end", key: key(), end: e.end, error: e.error, elapsedMs: e.elapsedMs, tokens });
      return { items: closed, busy: false, usage: e.usage, title: e.title };
    }
  }
}

let listening: Promise<unknown> | null = null;
function ensureListening() {
  listening ??= listen<{ sessionId: string; event: AgentLiveEvent }>("agent-event", (ev) => {
    const tabId = tabOfSession(ev.payload.sessionId);
    if (tabId) patch(tabId, (c) => apply(c, ev.payload.event));
  });
  return listening;
}

/** Open the chat of a tab: resume `sessionId` (running or saved) or start a new session. */
export async function openChat(tabId: string, cwd: string, providerId: string, sessionId: string | null): Promise<string | null> {
  await ensureListening();
  patch(tabId, () => ({ opening: true, error: null }));
  try {
    const o = await api.agentOpen(cwd, providerId, sessionId);
    patch(tabId, () => ({
      sessionId: o.sessionId, title: o.title, model: o.model, providerName: o.providerName, busy: o.busy, opening: false,
      items: itemsFromLog(o.events), usage: o.usage,
    }));
    return o.sessionId;
  } catch (e) {
    patch(tabId, () => ({ opening: false, error: errMsg(e) }));
    return null;
  }
}

export async function closeChat(tabId: string) {
  const c = useAgent.getState().chats[tabId];
  if (c?.sessionId) await api.agentClose(c.sessionId).catch(() => {});
  useAgent.setState((s) => {
    const { [tabId]: _, ...rest } = s.chats;
    return { chats: rest };
  });
}

export async function send(tabId: string, text: string): Promise<boolean> {
  const c = useAgent.getState().chats[tabId];
  if (!c?.sessionId || c.busy || !text.trim()) return false;
  try {
    await api.agentSend(c.sessionId, text.trim(), c.policy);
    return true;
  } catch (e) {
    patch(tabId, () => ({ error: errMsg(e) }));
    return false;
  }
}

export function stop(tabId: string) {
  const c = useAgent.getState().chats[tabId];
  if (c?.sessionId) void api.agentStop(c.sessionId).catch(() => {});
}

export async function answer(tabId: string, toolUseId: string, decision: AgentDecision) {
  const c = useAgent.getState().chats[tabId];
  if (!c?.sessionId) return;
  // show it at once; the backend confirms with toolCall / toolResult
  patch(tabId, (x) => ({ items: x.items.map((i) => (i.kind === "tool" && i.id === toolUseId ? { ...i, request: null, status: decision.decision === "deny" ? "denied" : "running" } : i)) }));
  await api.agentApprove(c.sessionId, toolUseId, decision).catch((e) => patch(tabId, () => ({ error: errMsg(e) })));
}

export function setPolicy(tabId: string, policy: AgentPolicy) {
  try { localStorage.setItem(KEY_POLICY, policy); } catch { /* private mode */ }
  patch(tabId, () => ({ policy }));
}

export function dismissError(tabId: string) {
  patch(tabId, () => ({ error: null }));
}
