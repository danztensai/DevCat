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
  openImportTab(path);
}

/** Import form for a VPN config file (also used when a .ovpn is opened with DevCat). */
export function openImportTab(path: string) {
  useTabs.getState().open({ type: "network", profileId: "", importPath: path }, basename(path), `net-import:${path}`);
}

export async function duplicateProfile(p: NetProfile) {
  try {
    const full = await api.netGet(p.id);
    openDraftTab({ profile: { ...full.profile, id: "", name: `${full.profile.name} copy`, autoConnect: false }, configText: full.configText });
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

/** Errors from the passwordless VPN helper refusing a config contain this (helper.rs REJECTION_MARK). */
export const isHelperRejection = (err: string | null | undefined) => !!err && err.includes("passwordless helper");

/** `passwordPrompt`: connect with the admin password prompt instead of the passwordless helper. */
/** Tools being installed right now (buttons show a spinner). */
export const useToolInstall = create<{ busy: Partial<Record<NetKind, boolean>> }>(() => ({ busy: {} }));

/** Windows: install OpenVPN / WireGuard with the installer DevCat ships. True when it's ready. */
export async function installTool(kind: "openvpn" | "wireguard"): Promise<boolean> {
  const tools = useNet.getState().tools;
  const label = NET_KIND_META[kind].label;
  const version = tools?.installable?.[kind];
  if (useToolInstall.getState().busy[kind]) return false;
  useToolInstall.setState((s) => ({ busy: { ...s.busy, [kind]: true } }));
  const t = toast.loading(`Installing ${label}${version ? ` ${version}` : ""}…`, { description: "Windows will ask for permission." });
  try {
    const res = await api.netInstallTool(kind);
    useNet.setState({ tools: res.tools });
    const ok = !!res.tools[kind];
    if (ok) {
      toast.success(`${label} is installed`, { id: t, description: res.restartNeeded ? "Windows asks for a restart to finish installing its network driver." : undefined, duration: res.restartNeeded ? 12_000 : 4000 });
    } else {
      toast.error(`${label} was installed but DevCat can't find it`, { id: t, description: "Try reopening DevCat." });
    }
    return ok;
  } catch (e) {
    const msg = errMsg(e);
    if (/cancel/i.test(msg)) toast.info(`${label} wasn't installed`, { id: t, description: "The Windows permission prompt was cancelled." });
    else toast.error(`Couldn't install ${label}`, { id: t, description: msg, duration: 12_000 });
    return false;
  } finally {
    useToolInstall.setState((s) => ({ busy: { ...s.busy, [kind]: false } }));
  }
}

/** Before connecting: a missing tool DevCat can install is offered first. False = don't connect. */
async function ensureTool(id: string): Promise<boolean> {
  const { profiles, tools } = useNet.getState();
  const kind = profiles.find((x) => x.id === id)?.kind;
  if (!tools || (kind !== "openvpn" && kind !== "wireguard") || tools[kind]) return true;
  const version = tools.installable?.[kind];
  if (!version) return true; // the backend reports what's missing
  const label = NET_KIND_META[kind].label;
  const ok = await confirmDialog({
    title: `Install ${label}?`,
    message: `${label} isn't installed on this computer. DevCat includes the official ${label} ${version} installer; Windows will ask for permission once, then the connection starts.`,
    confirmLabel: `Install ${label}`,
  });
  return ok && installTool(kind);
}

export async function connectProfile(p: Pick<NetProfile, "id" | "name">, passwordPrompt = false) {
  if (!(await ensureTool(p.id))) return;
  try {
    await useNet.getState().connect(p.id, passwordPrompt);
  } catch (e) {
    const msg = errMsg(e);
    if (!passwordPrompt && isHelperRejection(msg)) {
      toast.error(`${p.name}: ${msg}`, {
        duration: 15_000,
        action: { label: "Connect with password prompt", onClick: () => void connectProfile(p, true) },
      });
    } else {
      toast.error(`${p.name}: ${msg}`);
    }
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
