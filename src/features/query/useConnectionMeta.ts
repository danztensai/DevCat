// Lists databases / schemas for selectors, opening the connection on demand.
import { useEffect, useState } from "react";
import { api, errMsg } from "../../lib/api";
import type { ConnectionKind } from "../../lib/types";
import { useConnections } from "../../store/connections";
import { hasSchemas } from "../table/sqlDialect";

/** Ensure a backend session exists and is reflected in the store. */
export async function ensureOpen(connId: string) {
  const s = useConnections.getState();
  if (s.open.has(connId)) return;
  await api.openConnection(connId);
  s.markOpen(connId, true);
}

export function useConnectionMeta(connId: string, kind: ConnectionKind | undefined, database: string | null) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connId || !kind) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    ensureOpen(connId)
      .then(() => api.listDatabases(connId))
      .then((d) => !cancelled && setDatabases(d))
      .catch((e) => { if (!cancelled) { setDatabases([]); setError(errMsg(e)); } })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [connId, kind]);

  useEffect(() => {
    if (!connId || !kind || !hasSchemas(kind) || !database) { setSchemas([]); return; }
    let cancelled = false;
    ensureOpen(connId)
      .then(() => api.children(connId, [database]))
      .then((nodes) => !cancelled && setSchemas(nodes.filter((n) => n.kind === "schema").map((n) => n.label)))
      .catch(() => !cancelled && setSchemas([]));
    return () => { cancelled = true; };
  }, [connId, kind, database]);

  return { databases, schemas, error, loading };
}
