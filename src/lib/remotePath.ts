// Folders and files on SSH hosts are written `ssh://[user@]host[:port]/path` (see
// src-tauri/src/claude/remote.rs); everything else is a local path.

export const isRemote = (p: string | null | undefined): p is string => !!p && p.startsWith("ssh://");

export interface RemoteParts { dest: string; port: number | null; path: string }

export function remoteParts(p: string): RemoteParts | null {
  if (!isRemote(p)) return null;
  const rest = p.slice("ssh://".length);
  const i = rest.indexOf("/");
  const authority = i < 0 ? rest : rest.slice(0, i);
  const path = i < 0 ? "/" : rest.slice(i);
  const m = /^(.*):(\d+)$/.exec(authority);
  return m ? { dest: m[1], port: Number(m[2]), path } : { dest: authority, port: null, path };
}

export function remoteUri(dest: string, port: number | null, path: string): string {
  const p = path.startsWith("/") ? path : path.startsWith("~") ? `/${path}` : `/${path}`;
  return `ssh://${dest}${port ? `:${port}` : ""}${p}`;
}

/** Host label: `devbox` / `me@box:2222`. */
export function remoteHost(p: string): string {
  const r = remoteParts(p);
  return r ? `${r.dest}${r.port ? `:${r.port}` : ""}` : "";
}

/** For display: `devbox: ~/app` for remote folders, `~/app` for local ones. */
export function displayPath(p: string): string {
  const r = remoteParts(p);
  const tild = (x: string) => x.replace(/^\/(Users|home)\/[^/]+/, "~");
  return r ? `${remoteHost(p)}: ${tild(r.path)}` : tild(p);
}
