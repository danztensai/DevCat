// Is the AI agent in a workspace tab working? Agents run in a real terminal, so this is inferred
// from it: Claude Code animates its terminal title (◐/◑) while it works (✳ when idle), and
// every agent CLI keeps redrawing its status line while busy. Output that isn't the echo of the
// user's typing (or a resize redraw) counts as activity; a quiet terminal is idle.
// When a run ends while the user isn't looking, the tab is marked done, the Dock icon bounces
// (taskbar flashes on Windows) and the Dock badge counts the finished tabs.
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { create } from "zustand";

/** Output within this long after a keystroke / resize is treated as its echo / redraw. */
const ECHO_MS = 350;
/** Activity must last this long before the tab shows "working" (ignores short redraws). */
const START_MS = 900;
/** No activity for this long = idle. */
const IDLE_MS = 2500;
/** Runs shorter than this don't notify when they finish. */
const NOTIFY_MIN_MS = 4000;

export interface AgentActivity {
  working: boolean;
  /** Finished while the user wasn't looking at the tab. */
  done: boolean;
  /** When the current run started (working) or the last one ended. */
  since: number;
}

interface ActivityStore {
  tabs: Record<string, AgentActivity>;
}

export const useAgentActivity = create<ActivityStore>(() => ({ tabs: {} }));

const IDLE: AgentActivity = { working: false, done: false, since: 0 };

function patch(tabId: string, p: Partial<AgentActivity>) {
  useAgentActivity.setState((s) => ({ tabs: { ...s.tabs, [tabId]: { ...(s.tabs[tabId] ?? IDLE), ...p } } }));
}

export function useTabActivity(tabId: string): AgentActivity {
  return useAgentActivity((s) => s.tabs[tabId] ?? IDLE);
}

/** Is this tab on screen right now (the user would see it finish)? Set by the tab view. */
const visibleTabs = new Set<string>();

export function setTabVisible(tabId: string, visible: boolean) {
  if (visible) visibleTabs.add(tabId); else visibleTabs.delete(tabId);
  if (visible && document.hasFocus()) markSeen(tabId);
}

export function markSeen(tabId: string) {
  if (useAgentActivity.getState().tabs[tabId]?.done) {
    patch(tabId, { done: false });
    void syncBadge();
  }
}

export function forgetTab(tabId: string) {
  visibleTabs.delete(tabId);
  useAgentActivity.setState((s) => {
    const { [tabId]: _gone, ...rest } = s.tabs;
    return { tabs: rest };
  });
  void syncBadge();
}

async function syncBadge() {
  const n = Object.values(useAgentActivity.getState().tabs).filter((t) => t.done).length;
  try {
    await getCurrentWindow().setBadgeCount(n || undefined);
  } catch { /* not supported on this platform */ }
}

function finished(tabId: string, ranMs: number) {
  const seen = visibleTabs.has(tabId) && document.hasFocus();
  patch(tabId, { working: false, done: !seen, since: Date.now() });
  if (seen || ranMs < NOTIFY_MIN_MS) return;
  void syncBadge();
  if (!document.hasFocus()) {
    // Dock bounce (macOS) / taskbar flash (Windows) until the app is activated.
    try {
      void getCurrentWindow().requestUserAttention(UserAttentionType.Critical).catch(() => {});
    } catch { /* not supported */ }
  }
}

// Coming back to the window clears "done" on the tab being shown.
window.addEventListener("focus", () => {
  for (const id of visibleTabs) markSeen(id);
});

/** Feeds one terminal's events into the activity state of `tabId`. */
export class ActivityDetector {
  private lastInput = 0;
  private burstStart = 0;
  private lastActivity = 0;
  private working = false;
  private workStart = 0;
  /** The program reports busy/idle through the title (Claude Code); trust it over output. */
  private titleMode = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private tabId: string) {}

  input() { this.lastInput = Date.now(); }
  resize() { this.lastInput = Date.now(); }

  output(bytes: number) {
    if (this.titleMode || bytes === 0) return;
    const now = Date.now();
    if (now - this.lastInput < ECHO_MS) return;
    if (now - this.lastActivity > IDLE_MS) this.burstStart = now;
    this.lastActivity = now;
    if (!this.working && now - this.burstStart >= START_MS) this.start(now);
    this.armIdle();
  }

  /** Claude Code animates its title with ◐/◑ while working and shows ✳ when idle; braille
   *  spinner frames (⠋⠙…) are what other CLIs use. */
  title(t: string) {
    const ch = t.trim().codePointAt(0) ?? 0;
    const spinner = ch === 0x25d0 || ch === 0x25d1 || (ch >= 0x2800 && ch <= 0x28ff);
    const idle = ch === 0x2733;
    if (!spinner && !idle) return;
    this.titleMode = true;
    if (spinner && !this.working) this.start(Date.now());
    else if (idle && this.working) this.stop();
  }

  /** Terminal bell: many agents ring it when they finish or need input. */
  bell() {
    if (this.working) this.stop();
  }

  exit() {
    if (this.working) this.stop();
    this.titleMode = false;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    forgetTab(this.tabId);
  }

  private start(now: number) {
    this.working = true;
    this.workStart = now;
    patch(this.tabId, { working: true, done: false, since: now });
    void syncBadge();
  }

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.working = false;
    finished(this.tabId, Date.now() - this.workStart);
  }

  private armIdle() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.working && !this.titleMode) this.stop();
    }, IDLE_MS);
  }
}
