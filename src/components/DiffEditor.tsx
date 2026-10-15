// Monaco DiffEditor that disposes its models safely. @monaco-editor/react disposes the text
// models on unmount before the diff widget releases them ("TextModel got disposed before
// DiffEditorWidget model got reset"); keep them and dispose after the editor is gone instead.
import { DiffEditor as MonacoDiffEditor, type DiffEditorProps, type DiffOnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";

export type { DiffOnMount };

export function DiffEditor(props: DiffEditorProps) {
  const models = useRef<{ original: { dispose(): void }; modified: { dispose(): void } } | null>(null);
  const { onMount } = props;
  useEffect(() => () => {
    const m = models.current;
    if (m) setTimeout(() => { m.original.dispose(); m.modified.dispose(); }, 0);
  }, []);
  return (
    <MonacoDiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(ed, monaco) => {
        models.current = ed.getModel();
        // Track model swaps so the latest pair gets disposed.
        ed.onDidChangeModel(() => { models.current = ed.getModel() ?? models.current; });
        onMount?.(ed, monaco);
      }}
    />
  );
}
