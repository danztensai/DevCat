// User actions on network profiles shared by the sidebar, the tab and context menus.
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { create } from "zustand";
import { api, errMsg } from "../../lib/api";
import type { NetKind, NetProfile, NetProfileFull } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { useTabs } from "../../store/tabs";
import { confirmDialog } from "../connections/dialogs";
import { basename, isUp, NET_KIND_META, newProfile } from "./meta";
import { useNet } from "./store";

export const tabKey = (id: string) => `net:${id}`;

/** Sub-view a profile tab should switch to (set by "Show logs"); nonce re-triggers. */
export const useNetTabNav = create<Record<string, { view: "settings" | "logs"; nonce: number }>>(() => ({}));

export function openProfileTab(p: Pick<NetProfile, "id" | "name">, view?: "settings" | "logs") {
  const tabs = useTabs.getState();
  if (view) useNetTabNav.setState((s) => ({ [p.id]: { view, nonce: (s[p.id]?.nonce ?? 0) + 1 } }));
  // A tab created as "new" keeps its original id after saving: find it by profile id.
  const existing = tabs.tabs.find((t) => t.type === "network" && t.profileId === p.id);
  if (existing) return tabs.activate(existing.id);
  tabs.open({ type: "network", profileId: p.id }, p.name || "Network", tabKey(p.id));
}

// Unsaved drafts handed to a new tab (e.g. from "Import from ~/.ssh/config" or "Duplicate").
const drafts = new Map<string, NetProfileFull>();
let draftSeq = 0;
// Not consumed on read: StrictMode / HMR may mount the tab twice. Drafts are tiny.
export const draftFor = (tabId: string) => drafts.get(tabId);

export function openDraftTab(full: NetProfileFull) {
  const key = `net-draft-${++draftSeq}`;
  drafts.set(key, full);
  useTabs.getState().open({ type: "network", profileId: "", kind: full.profile.kind }, full.profile.name || `New ${NET_KIND_META[full.profile.kind].label}`, key);
}

export function openNewProfile(kind: NetKind) {
  const focus = useConnections.getState().focusProjectId;
  openDraftTab({ profile: newProfile(kind, focus), configText: null });
}

export async function importProfileFile() {
  let path: string | string[] | null = null;
  try {
    path = await open({
      multiple: false,
      directory: false,
      title: "Import VPN configuration",
      filters: [
        { name: "VPN configuration (.ovpn, .conf)", extensions: ["ovpn", "conf"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
  } catch (e) {
    toast.error(errMsg(e));
    return;
  }
  if (typeof path !== "string") return;
  useTabs.getState().open({ type: "network", profileId: "", importPath: path }, basename(path), `net-import:${path}`);
}

export async function duplicateProfile(p: NetProfile) {
  try {
    const full = await api.netGet(p.id);
    openDraftTab({ profile: { ...full.profile, id: "", name: `${full.profile.name} copy`, autoConnect: false, vpnPassword: null }, configText: full.configText });
  } catch (e) {
    toast.error(`Couldn't load "${p.name}": ${errMsg(e)}`);
  }
}

export async function deleteProfile(p: Pick<NetProfile, "id" | "name">): Promise<boolean> {
  const st = useNet.getState().statuses[p.id];
  const ok = await confirmDialog({
    title: "Delete network profile",
    message: (
      `Delete "${p.name}"?` + (isUp(st?.state) ? " It will be disconnected first." : "") +
      " Connections that use it as their Network will stop starting it."
    ),
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return false;
  try {
    if (isUp(st?.state)) await useNet.getState().disconnect(p.id).catch(() => {});
    await useNet.getState().remove(p.id);
    const tabs = useTabs.getState();
    tabs.tabs.filter((t) => t.type === "network" && t.profileId === p.id).forEach((t) => tabs.close(t.id));
    toast.success(`Deleted "${p.name}"`);
    return true;
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
}

export async function connectProfile(p: Pick<NetProfile, "id" | "name">) {
  try {
    await useNet.getState().connect(p.id);
  } catch (e) {
    toast.error(`${p.name}: ${errMsg(e)}`);
  }
}

export async function disconnectProfile(p: Pick<NetProfile, "id" | "name">) {
  try {
    await useNet.getState().disconnect(p.id);
  } catch (e) {
    toast.error(`${p.name}: ${errMsg(e)}`);
  }
}

export function toggleProfile(p: Pick<NetProfile, "id" | "name">) {
  const st = useNet.getState().statuses[p.id];
  return isUp(st?.state) ? disconnectProfile(p) : connectProfile(p);
}
