// Project (connection folder) actions shared by the tree, its menus and the connection dialog.
import { toast } from "sonner";
import { errMsg } from "../../../lib/api";
import type { ConnectionConfig, Project } from "../../../lib/types";
import { useConnections } from "../../../store/connections";
import { useUi } from "../../../store/ui";
import { confirmDialog, promptDialog } from "../dialogs";
import { useTree } from "./store";

const conns = () => useConnections.getState();

/** Prompt for a name and create a project. Returns it, or null if cancelled / failed. */
export async function createProject(): Promise<Project | null> {
  const name = await promptDialog({ title: "New project", label: "Project name", placeholder: "e.g. Shop backend", confirmLabel: "Create" });
  if (!name) return null;
  try {
    const p = await conns().saveProject({ name });
    useTree.getState().setProjectCollapsed(p.id, false);
    toast.success(`Created project ${p.name}`);
    return p;
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}

export async function renameProject(p: Project) {
  const name = await promptDialog({ title: "Rename project", label: "Project name", defaultValue: p.name, confirmLabel: "Rename" });
  if (!name || name === p.name) return;
  try {
    await conns().saveProject({ ...p, name });
  } catch (e) {
    toast.error(errMsg(e));
  }
}

export async function setProjectColor(p: Project, color: string | null) {
  try {
    await conns().saveProject({ ...p, color });
  } catch (e) {
    toast.error(errMsg(e));
  }
}

/** Move a project one step up (-1) or down (+1) in the sidebar. */
export async function moveProject(p: Project, dir: -1 | 1) {
  const ids = conns().projects.map((x) => x.id);
  const i = ids.indexOf(p.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    await conns().reorderProjects(ids);
  } catch (e) {
    toast.error(errMsg(e));
  }
}

export async function deleteProject(p: Project, withConnections = false) {
  const count = conns().connections.filter((c) => c.projectId === p.id).length;
  const ok = await confirmDialog({
    title: withConnections ? "Delete project and connections" : "Delete project",
    message: withConnections ? (
      <>Delete the project <b>{p.name}</b> and its <b>{count}</b> connection{count === 1 ? "" : "s"}? Saved credentials are removed too. This cannot be undone.</>
    ) : count > 0 ? (
      <>Delete the project <b>{p.name}</b>? Its {count} connection{count === 1 ? "" : "s"} will be kept and moved out of the project.</>
    ) : (
      <>Delete the empty project <b>{p.name}</b>?</>
    ),
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    const members = conns().connections.filter((c) => c.projectId === p.id);
    await conns().removeProject(p.id, withConnections);
    if (withConnections) members.forEach((c) => useTree.getState().clearConn(c.id));
    toast.success(`Deleted project ${p.name}`);
  } catch (e) {
    toast.error(`Delete failed: ${errMsg(e)}`);
  }
}

/** Move connections into a project (null = no project). */
export async function moveConnections(list: ConnectionConfig[], projectId: string | null) {
  const ids = list.filter((c) => (c.projectId ?? null) !== projectId).map((c) => c.id);
  if (!ids.length) return;
  try {
    await conns().moveToProject(ids, projectId);
    if (projectId) useTree.getState().setProjectCollapsed(projectId, false);
  } catch (e) {
    toast.error(`Move failed: ${errMsg(e)}`);
  }
}

/** Create a project, then move the connection into it. */
export async function moveToNewProject(conn: ConnectionConfig) {
  const p = await createProject();
  if (p) await moveConnections([conn], p.id);
}

/** Enter focus mode for a project (expands it). */
export function focusProject(projectId: string) {
  conns().setFocus(projectId);
  useTree.getState().setProjectCollapsed(projectId, false);
}

export const newConnectionIn = (projectId: string | null) => useUi.getState().openConnectionDialog(null, undefined, projectId);

// ---- drag & drop of connection rows onto projects

export const DRAG_MIME = "application/x-devcat-connection";
