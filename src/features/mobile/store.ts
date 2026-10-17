// Remote access status shared by the title-bar button, the Mobile dialog and the pairing prompt.
// The backend broadcasts "remote-status" on every change; we read it once and then follow it.
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { create } from "zustand";
import { mobileApi, type PtyInfo, type RemoteStatus } from "./api";

export type MobileTab = "remote" | "notify" | "activity" | "help";

interface MobileStore {
  status: RemoteStatus | null;
  open: boolean;
  tab: MobileTab;
  show: (tab?: MobileTab) => void;
  close: () => void;
  setStatus: (s: RemoteStatus) => void;
}

export const useMobile = create<MobileStore>((set) => ({
  status: null,
  open: false,
  tab: "remote",
  show: (tab) => set((s) => ({ open: true, tab: tab ?? s.tab })),
  close: () => set({ open: false }),
  setStatus: (status) => set({ status }),
}));

let started = false;
/** Subscribe once per window. */
export function startMobileStatus() {
  if (started) return;
  started = true;
  mobileApi.status().then((s) => useMobile.getState().setStatus(s)).catch(() => {});
  void listen<RemoteStatus>("remote-status", (e) => useMobile.getState().setStatus(e.payload));
  void listen<PtyInfo>("remote-pty-opened", (e) => {
    const p = e.payload;
    const who = p.origin.replace(/^phone:/, "");
    const folder = p.cwd.split(/[\\/]/).filter(Boolean).pop() ?? p.cwd;
    toast.info(`${who} started ${p.agent ? "an agent" : p.program} in ${folder}`, { description: "It runs on this computer and keeps running if the phone disconnects." });
  });
}
