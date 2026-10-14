import { KeyRound, Plus, Zap } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button, Empty } from "../../components/ui";
import { useConnections } from "../../store/connections";
import { useTabs } from "../../store/tabs";
import type { Tab } from "../../tabs/types";
import { KeyBrowser } from "./KeyBrowser";
import { KeyEditor } from "./KeyEditor";
import { NewKeyDialog } from "./NewKeyDialog";
import { RedisConsole } from "./RedisConsole";
import { dbIndex } from "./util";

type RedisTabT = Extract<Tab, { type: "redis" }>;

export default function RedisTab({ tab }: { tab: RedisTabT }) {
  const conn = useConnections((s) => s.connections.find((c) => c.id === tab.connId));
  const updateTab = useTabs((s) => s.update);
  const [db, setDb] = useState(() => dbIndex(tab.database ?? conn?.database));
  const [selected, setSelected] = useState<string | null>(tab.key ?? null);
  const [browserToken, setBrowserToken] = useState(0);
  const [editorToken, setEditorToken] = useState(0);
  const [newKey, setNewKey] = useState(false);
  const dirty = useRef(false);

  const onDirty = useCallback((d: boolean) => {
    dirty.current = d;
    updateTab(tab.id, { dirty: d });
  }, [tab.id, updateTab]);

  const guard = (fn: () => void) => {
    if (dirty.current && !window.confirm("Discard unsaved changes to this key?")) return;
    onDirty(false);
    fn();
  };

  const changeDb = (d: string) => guard(() => { setDb(d); setSelected(null); });

  return (
    <div className="flex h-full flex-col">
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="30%" minSize="18%" maxSize="60%">
          <KeyBrowser
            connId={tab.connId}
            db={db}
            onDb={changeDb}
            selected={selected}
            onSelect={(k) => k !== selected && guard(() => setSelected(k))}
            onNewKey={() => setNewKey(true)}
            reloadToken={browserToken}
          />
        </Panel>
        <Separator className="w-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
        <Panel minSize="30%">
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize="70%" minSize="25%">
              {selected ? (
                <KeyEditor
                  key={`${db}:${selected}:${editorToken}`}
                  connId={tab.connId}
                  db={db}
                  keyName={selected}
                  readOnly={conn?.readOnly}
                  onDirty={onDirty}
                  onRenamed={(k) => { onDirty(false); setSelected(k); setBrowserToken((n) => n + 1); }}
                  onDeleted={() => { onDirty(false); setSelected(null); setBrowserToken((n) => n + 1); }}
                />
              ) : (
                <Empty icon={<Zap className="size-8" />} title={conn ? `${conn.name} · db${db}` : `db${db}`}>
                  Select a key on the left to view and edit it, or create a new one.
                  <div className="mt-3 flex justify-center gap-2">
                    <Button size="sm" onClick={() => setNewKey(true)} disabled={conn?.readOnly}><Plus className="size-3.5" />New key</Button>
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-1 text-[11px] text-faint">
                    <KeyRound className="size-3" />Tip: type a prefix (user:) or glob (*session*) in the search box.
                  </div>
                </Empty>
              )}
            </Panel>
            <Separator className="h-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
            <Panel defaultSize="30%" minSize="10%">
              <RedisConsole
                connId={tab.connId}
                db={db}
                onDb={changeDb}
                onMutated={() => {
                  setBrowserToken((n) => n + 1);
                  if (!dirty.current) setEditorToken((n) => n + 1);
                }}
              />
            </Panel>
          </Group>
        </Panel>
      </Group>
      {newKey && (
        <NewKeyDialog
          connId={tab.connId}
          db={db}
          onClose={() => setNewKey(false)}
          onCreated={(k) => {
            setNewKey(false);
            setBrowserToken((n) => n + 1);
            guard(() => setSelected(k));
          }}
        />
      )}
    </div>
  );
}
