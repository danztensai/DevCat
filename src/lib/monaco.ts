// Bundle Monaco locally (no CDN) so the editor works offline inside the app.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import { glassOn, onPaletteChange, palette } from "../features/appearance/store";
import { monacoTheme } from "../features/appearance/themes";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};

// "devcat" follows the Appearance theme; every editor uses it.
monaco.editor.defineTheme("devcat", monacoTheme(palette(), glassOn()));
onPaletteChange((p, glass) => {
  monaco.editor.defineTheme("devcat", monacoTheme(p, glass));
  monaco.editor.setTheme("devcat");
});

loader.config({ monaco });
export { monaco };
