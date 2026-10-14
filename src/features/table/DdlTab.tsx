// Read-only DDL viewer for tables, views, routines, triggers and sequences.
import { Copy, RefreshCw, SquareTerminal, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { format } from "sql-formatter";
import { toast } from "sonner";
import { Button, Empty, ErrorBox, Spinner, Toolbar } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import { dialectOf } from "../../lib/types";
import { useConnections } from "../../store/connections";
import type { Tab } from "../../tabs/types";
import { openQuery } from "../connections/openers";
import { SqlViewer } from "./designer/SqlPreview";
import { formatterLanguage } from "./sqlDialect";

export default function DdlTab({ tab }: { tab: Extract<Tab, { type: "ddl" }> }) {
  const conn = useConnections((s) => s.connections.find((c) => c.id === tab.connId));
  const { table, kind } = tab;
  const [ddl, setDdl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDdl(await api.objectDdl(tab.connId, table, kind));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.connId, table.database, table.schema, table.name, kind]);

  useEffect(() => { load(); }, [load]);

  const formatDdl = () => {
    if (!ddl) return;
    try {
      setDdl(format(ddl, { language: formatterLanguage(conn ? dialectOf(conn.kind) : "none"), keywordCase: "upper", tabWidth: 2 }));
    } catch (e) {
      toast.error(`Could not format: ${errMsg(e)}`);
    }
  };

  const path = [table.database, table.schema, table.name].filter(Boolean).join(".");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Button size="sm" variant="ghost" disabled={loading} onClick={load}><RefreshCw className="size-3.5" /> Refresh</Button>
        <Button size="sm" variant="ghost" disabled={!ddl} onClick={() => ddl && navigator.clipboard.writeText(ddl).then(() => toast.success("DDL copied"))}>
          <Copy className="size-3.5" /> Copy
        </Button>
        <Button size="sm" variant="ghost" disabled={!ddl} onClick={formatDdl}><WandSparkles className="size-3.5" /> Format</Button>
        <Button size="sm" variant="ghost" disabled={!ddl}
          onClick={() => ddl && openQuery(tab.connId, { database: table.database, schema: table.schema, initialSql: ddl })}>
          <SquareTerminal className="size-3.5" /> Open in query editor
        </Button>
        <div className="flex-1" />
        <span className="truncate pr-1 font-mono text-[11px] text-faint">{kind} · {path}</span>
      </Toolbar>
      <div className="relative min-h-0 flex-1">
        {error ? (
          <ErrorBox error={error} />
        ) : ddl === null ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : ddl.trim() === "" ? (
          <Empty title="No DDL available">The server returned an empty definition for this object.</Empty>
        ) : (
          <SqlViewer value={ddl} />
        )}
        {loading && ddl !== null && <Spinner className="absolute top-2 right-4" />}
      </div>
    </div>
  );
}
