// Rendered HTML in a sandboxed iframe (the built-in webview, no extra engine). Scripts are off
// unless the user turns them on; even then the frame has an opaque origin, so the page can't
// reach DevCat or the file system. Relative assets (css, images) aren't resolved: use
// "Open with default app" for the full page.
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../../../components/ui";

const SCRIPTS_KEY = "devcat.preview.htmlScripts";

export function useHtmlScripts(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => localStorage.getItem(SCRIPTS_KEY) === "1");
  return [on, (v) => { setOn(v); localStorage.setItem(SCRIPTS_KEY, v ? "1" : "0"); }];
}

export function ScriptsButton({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <IconButton title={on ? "Scripts run in the preview (click to disable)" : "Run the page's scripts in the preview"} active={on} onClick={() => set(!on)}>
      <ScrollText className="size-3.5" />
    </IconButton>
  );
}

export function HtmlPreview({ html, scripts, title }: { html: string; scripts: boolean; title: string }) {
  return (
    <div className="min-h-0 flex-1 bg-white">
      <iframe
        // re-create the frame when the sandbox changes (browsers don't apply it to a loaded page)
        key={scripts ? "js" : "static"}
        title={title}
        srcDoc={html}
        sandbox={scripts ? "allow-scripts allow-popups allow-forms allow-modals" : "allow-popups"}
        className="h-full w-full border-0"
      />
    </div>
  );
}
