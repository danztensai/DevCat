// Bundle Monaco locally (no CDN) so the editor works offline inside the app.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};

monaco.editor.defineTheme("devcat", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "F5A524", fontStyle: "bold" },
    { token: "string", foreground: "8BD49C" },
    { token: "number", foreground: "7CC4FA" },
    { token: "comment", foreground: "6B7280", fontStyle: "italic" },
  ],
  colors: {
    "editor.background": "#14161a",
    "editor.lineHighlightBackground": "#1c1f25",
    "editorLineNumber.foreground": "#4b5160",
    "editorGutter.background": "#14161a",
  },
});

loader.config({ monaco });
export { monaco };
