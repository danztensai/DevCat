// Bundle Monaco locally (no CDN) so the editor works offline inside the app.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import { glassOn, onPaletteChange, palette } from "../features/appearance/store";
import { monacoTheme } from "../features/appearance/themes";
import { editorFont, onFontsChange } from "../features/appearance/fonts";

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

// Every editor uses the Fonts setting: it wins over the per-view options (which the React wrapper
// re-applies on each render), and changes reach open editors. This monkeypatches `updateOptions`:
// a view's own fontFamily is always replaced, and its fontSize too whenever an editor size is set.
monaco.editor.onDidCreateEditor((e) => {
  const update = e.updateOptions.bind(e);
  e.updateOptions = (o) => update({ ...o, ...editorFont() });
  update(editorFont());
});
onFontsChange(() => monaco.editor.getEditors().forEach((e) => e.updateOptions({})));

loader.config({ monaco });
export { monaco };
