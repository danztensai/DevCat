// Notes (Markdown), each in a project or in General (projectId null). Kept by the backend in
// notes.json; every window holds a copy and reloads when another window changes them.
import { create } from "zustand";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import type { Note } from "../../lib/types";
import { broadcast, onBroadcast } from "../../lib/windows";
import { useConnections } from "../../store/connections";
import { openTab, useTabs } from "../../store/tabs";

interface NotesState {
  notes: Note[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Persist a note; updates the list right away and returns the stored version. */
  save: (n: Note) => Promise<Note>;
  remove: (id: string) => Promise<void>;
}

const sortNotes = (list: Note[]) =>
  [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);

export const useNotes = create<NotesState>((set) => ({
  notes: [],
  loaded: false,
  error: null,
  load: async () => {
    try {
      set({ notes: await api.notesList(), loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: errMsg(e) });
    }
  },
  save: async (n) => {
    if (n.id) set((s) => ({ notes: s.notes.map((x) => (x.id === n.id ? { ...x, ...n } : x)) }));
    const saved = await api.noteSave(n);
    set((s) => ({ notes: sortNotes([...s.notes.filter((x) => x.id !== saved.id), saved]) }));
    broadcast({ kind: "notes" });
    return saved;
  },
  remove: async (id) => {
    await api.noteDelete(id);
    set((s) => ({ notes: s.notes.filter((x) => x.id !== id) }));
    broadcast({ kind: "notes" });
  },
}));

void useNotes.getState().load();
onBroadcast((m) => { if (m.kind === "notes") void useNotes.getState().load(); });

// A note whose tab is closed without anything written in it is deleted (after the tab's last
// save has landed).
useTabs.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  const open = new Set(s.tabs.map((t) => t.id));
  for (const t of prev.tabs) {
    if (t.type !== "note" || open.has(t.id)) continue;
    const id = t.noteId;
    setTimeout(() => {
      const n = useNotes.getState().notes.find((x) => x.id === id);
      const reopened = useTabs.getState().tabs.some((x) => x.id === t.id);
      if (n && !n.body.trim() && !reopened) void useNotes.getState().remove(id).catch(() => {});
    }, 1500);
  }
});

/** Title = first non-empty line without Markdown markers. */
export function noteTitle(body: string): string {
  const line = body.split("\n").map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*)/, "").trim()).find(Boolean);
  return line ? line.slice(0, 120) : "Untitled note";
}

/** Second non-empty line, for the list. */
export function noteSnippet(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[1] ?? "")
    .replace(/^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*)/, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .slice(0, 160);
}

/** Is this note visible under the current project focus? General notes always are. */
export function noteInFocus(projectId: string | null | undefined): boolean {
  const focus = useConnections.getState().focusProjectId;
  return !focus || !projectId || projectId === focus;
}

export function openNote(n: Note) {
  openTab({ type: "note", noteId: n.id }, noteTitle(n.body), `note:${n.id}`);
}

/** New note in `projectId` (default: the focused project, else General), opened in a tab. */
export async function createNote(projectId?: string | null) {
  try {
    const n = await useNotes.getState().save({
      id: "", projectId: projectId === undefined ? useConnections.getState().focusProjectId : projectId,
      body: "", pinned: false, createdAt: 0, updatedAt: 0,
    });
    openNote(n);
  } catch (e) {
    toast.error("Could not create the note", { description: errMsg(e) });
  }
}
