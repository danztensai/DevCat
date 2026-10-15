// File preview tab: toolbar (path, size, kind, actions) + a viewer per FilePreview kind,
// or git blame for text files inside a repository.
import { Copy, ExternalLink, FolderSearch, History, RefreshCw, UserSearch } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Badge, ErrorBox, IconButton, Spinner, Toolbar } from "../../components/ui";
import { api } from "../../lib/api";
import type { FilePreview } from "../../lib/types";
import { useTabs } from "../../store/tabs";
import type { Tab } from "../../tabs/types";
import { BlameView } from "../git/BlameView";
import { openGitRepo } from "../git/open";
import { useRepoRoot } from "../git/repoOf";
import { FileIcon } from "./FileIcon";
import { copyText, fmtSize, openExternally, relPath, revealPath } from "./format";
import { CsvViewer, SheetViewer } from "./viewers/SheetViewer";
import { BinaryCard, DocxViewer, ImageViewer, MarkdownViewer, TextViewer } from "./viewers/simple";

const PdfViewer = lazy(() => import("./viewers/PdfViewer"));

const KIND_LABEL: Record<FilePreview["kind"], string> = {
  text: "Text", markdown: "Markdown", image: "Image", pdf: "PDF", sheet: "Spreadsheet", csv: "CSV", docx: "Word", binary: "Binary", too_large: "Too large",
};

export default function FilePreviewTab({ tab }: { tab: Extract<Tab, { type: "file" }> }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [reload, setReload] = useState(0);
  const repo = useRepoRoot(tab.path);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.fsPreview(tab.path);
      setPreview(p);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tab.path]);

  useEffect(() => { void load(); }, [load]);

  const shown = relPath(tab.path, tab.root);
  const kind = preview?.kind;
  const canBlame = !!repo && (kind === "text" || kind === "markdown");
  const blame = !!tab.blame && repo !== null && (!preview || canBlame);
  const setBlame = (v: boolean) => useTabs.getState().update(tab.id, { blame: v } as never);

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <Toolbar className="gap-2">
        <FileIcon name={tab.path} />
        {/* rtl keeps the file name visible when a long path gets truncated */}
        <span className="selectable min-w-0 truncate font-mono text-[12px] text-fg/90" title={tab.path} dir="rtl">
          <bdi>{shown}</bdi>
        </span>
        {preview && <span className="shrink-0 text-[11px] text-faint">{fmtSize(preview.size)}</span>}
        {kind && <Badge tone={kind === "binary" || kind === "too_large" ? "warn" : "default"}>{KIND_LABEL[kind] ?? kind}</Badge>}
        {preview?.language && kind === "text" && <span className="shrink-0 font-mono text-[11px] text-faint">{preview.language}</span>}
        <div className="flex-1" />
        <div ref={setSlot} className="flex shrink-0 items-center gap-1.5" />
        <div className="mx-0.5 h-4 w-px shrink-0 bg-line" />
        {canBlame && (
          <>
            <IconButton title={blame ? "Hide blame" : "Blame"} active={blame} onClick={() => setBlame(!blame)}><UserSearch className="size-3.5" /></IconButton>
            <IconButton title="File history" onClick={() => openGitRepo(repo, { path: tab.path })}><History className="size-3.5" /></IconButton>
          </>
        )}
        <IconButton title="Refresh" onClick={() => { void load(); setReload((n) => n + 1); }}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /></IconButton>
        <IconButton title="Copy path" onClick={() => void copyText(tab.path)}><Copy className="size-3.5" /></IconButton>
        <IconButton title="Open with default app" onClick={() => void openExternally(tab.path)}><ExternalLink className="size-3.5" /></IconButton>
        <IconButton title="Reveal in Finder" onClick={() => void revealPath(tab.path)}><FolderSearch className="size-3.5" /></IconButton>
      </Toolbar>
      <div className="min-h-0 flex-1">
        {error ? (
          <ErrorBox error={error} />
        ) : !preview || (blame && !repo) ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : blame && repo ? (
          <BlameView key={tab.path} path={tab.path} repo={repo} slot={slot} reload={reload} />
        ) : (
          <Viewer key={preview.kind} preview={preview} slot={slot} root={tab.root ?? null} />
        )}
      </div>
    </div>
  );
}

function Viewer({ preview, slot, root }: { preview: FilePreview; slot: HTMLElement | null; root: string | null }) {
  const props = { preview, slot, root };
  switch (preview.kind) {
    case "text": return <TextViewer {...props} />;
    case "markdown": return <MarkdownViewer {...props} />;
    case "image": return <ImageViewer {...props} />;
    case "pdf": return <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}><PdfViewer preview={preview} slot={slot} /></Suspense>;
    case "sheet": return <SheetViewer preview={preview} slot={slot} />;
    case "csv": return <CsvViewer preview={preview} slot={slot} />;
    case "docx": return <DocxViewer {...props} />;
    default: return <BinaryCard {...props} />;
  }
}
