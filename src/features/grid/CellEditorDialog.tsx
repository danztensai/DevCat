// Multi-line cell viewer / editor (Monaco) for JSON and long text values.
import Editor from "@monaco-editor/react";
import { Braces, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Dialog } from "../../components/ui";
import "../../lib/monaco";
import type { CellValue } from "../../lib/types";
import { editText, isJsonType, parseInput } from "./format";

export interface CellEditorProps {
  column: string;
  typeName: string;
  value: CellValue | undefined;
  readOnly: boolean;
  onSave: (v: CellValue) => void;
  onClose: () => void;
}

export default function CellEditorDialog({ column, typeName, value, readOnly, onSave, onClose }: CellEditorProps) {
  const isJson = (value !== null && typeof value === "object") || isJsonType(typeName) || looksJson(value);
  const [text, setText] = useState(() => {
    if (value === undefined || value === null) return "";
    if (isJson && typeof value === "string") {
      try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
    }
    return editText(value);
  });
  const [lang, setLang] = useState(isJson ? "json" : "plaintext");

  const save = () => {
    if (lang === "json" && typeof value === "object" && value !== null) {
      try { onSave(JSON.parse(text) as CellValue); } catch (e) { toast.error(`Invalid JSON: ${(e as Error).message}`); return; }
    } else {
      onSave(parseInput(text, value ?? null, typeName));
    }
    onClose();
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  const format = () => {
    try { setText(JSON.stringify(JSON.parse(text), null, 2)); setLang("json"); } catch { toast.error("Not valid JSON"); }
  };

  return (
    <Dialog
      open
      width={760}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono">{column}</span>
          <Badge>{typeName || "value"}</Badge>
          {value === null && <Badge tone="warn">NULL</Badge>}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied"); }}>
            <Copy className="size-3.5" /> Copy
          </Button>
          <Button variant="ghost" size="sm" onClick={format}><Braces className="size-3.5" /> Format JSON</Button>
          <span className="flex-1" />
          {readOnly ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button onClick={() => { onSave(null); onClose(); }}>Set NULL</Button>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={save}>Apply <span className="text-[10px] opacity-70">⌘↵</span></Button>
            </>
          )}
        </>
      }
    >
      <div className="-m-4 h-[52vh] border-b border-line">
        <Editor
          theme="devcat"
          language={lang}
          value={text}
          onChange={(v) => setText(v ?? "")}
          onMount={(ed, monaco) => {
            ed.focus();
            ed.addAction({ id: "devcat.cell.apply", label: "Apply", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => { if (!readOnly) saveRef.current(); } });
          }}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 12,
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbersMinChars: 3,
            fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace",
          }}
        />
      </div>
    </Dialog>
  );
}

function looksJson(v: CellValue | undefined): boolean {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}
