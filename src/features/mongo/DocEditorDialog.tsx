// Modal Monaco editor for inserting / editing a single document.
import Editor from "@monaco-editor/react";
import { AlertTriangle, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { isPlainObject, parseRelaxed, type Json } from "./ejson";

export function DocEditorDialog({ title, initial, onClose, onSave, idLocked }: {
  title: string;
  initial: string;
  onClose: () => void;
  /** Resolve to close, reject/throw to keep the dialog open (error shown by caller). */
  onSave: (doc: Record<string, Json>) => Promise<void>;
  /** When editing, the original _id (JSON text) — changing it is rejected. */
  idLocked?: string;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parsed = useMemo((): { doc?: Record<string, Json>; error?: string } => {
    try {
      const v = parseRelaxed(text);
      if (!isPlainObject(v)) return { error: "A document must be a JSON object { … }" };
      if (idLocked !== undefined && JSON.stringify(v._id) !== idLocked) return { error: "_id cannot be changed — use Duplicate to create a copy with a new _id." };
      return { doc: v };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [text, idLocked]);

  const save = async () => {
    if (!parsed.doc) return;
    setBusy(true);
    setSaveError(null);
    try {
      await onSave(parsed.doc);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;
  // Editor-scoped action (addCommand would be shared across editors); disposed on unmount.
  const actionRef = useRef<{ dispose: () => void } | null>(null);
  useEffect(() => () => actionRef.current?.dispose(), []);

  return (
    <Dialog open onClose={onClose} title={title} width={760}
      footer={<>
        <span className="mr-auto flex min-w-0 items-center gap-1.5 truncate text-xs text-danger" title={saveError ?? parsed.error}>
          {(saveError || parsed.error) && <AlertTriangle className="size-3.5 shrink-0" />}{saveError ?? parsed.error}
        </span>
        <span className="text-[11px] text-faint">⌘/Ctrl+Enter to save</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!parsed.doc} loading={busy}><Save className="size-3.5" />Save</Button>
      </>}>
      <div className="-m-4 h-[60vh] border-b border-line">
        <Editor
          language="json"
          theme="devcat"
          value={text}
          onChange={(v) => setText(v ?? "")}
          onMount={(ed, monaco) => {
            ed.focus();
            actionRef.current?.dispose();
            actionRef.current = ed.addAction({
              id: "devcat.mongo.saveDocument",
              label: "Save document",
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
              run: () => { saveRef.current(); },
            });
          }}
          options={{ minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, formatOnPaste: true }}
        />
      </div>
    </Dialog>
  );
}
