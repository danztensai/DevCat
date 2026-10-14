import Editor from "@monaco-editor/react";
import { AlertTriangle, Copy, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { Button, Empty, ErrorBox } from "../../../components/ui";
import "../../../lib/monaco";
import { EditorBar } from "./cells";

/** Read-only SQL viewer used by the designer preview and the DDL tab. */
export function SqlViewer({ value }: { value: string }) {
  return (
    <Editor
      language="sql"
      theme="devcat"
      value={value}
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace",
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        wordWrap: "on",
        renderLineHighlight: "none",
        automaticLayout: true,
        padding: { top: 8 },
      }}
    />
  );
}

export function SqlPreview({ script, problems, saveError, onOpenInQuery }:
  { script: string; problems: string[]; saveError: string | null; onOpenInQuery: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorBar>
        <Button size="sm" variant="ghost" disabled={!script} onClick={() => navigator.clipboard.writeText(script).then(() => toast.success("SQL copied"))}>
          <Copy className="size-3.5" /> Copy
        </Button>
        <Button size="sm" variant="ghost" disabled={!script} onClick={onOpenInQuery}>
          <SquareTerminal className="size-3.5" /> Open in query editor
        </Button>
      </EditorBar>
      {problems.length > 0 && (
        <div className="shrink-0 border-b border-line bg-warn/10 px-3 py-1.5 text-xs text-warn">
          {problems.map((p) => (
            <div key={p} className="flex items-center gap-1.5"><AlertTriangle className="size-3.5 shrink-0" /> {p}</div>
          ))}
        </div>
      )}
      {saveError && <div className="shrink-0"><ErrorBox error={saveError} /></div>}
      <div className="min-h-0 flex-1">
        {script ? <SqlViewer value={script} /> : <Empty title="No changes">Edit columns, indexes or foreign keys to see the generated SQL.</Empty>}
      </div>
    </div>
  );
}
