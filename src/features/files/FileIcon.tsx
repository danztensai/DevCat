// File-type icon by extension / well-known name (lucide icons, tinted per family).
import clsx from "clsx";
import {
  BookOpen, Braces, Database, File, FileArchive, FileAudio, FileCode, FileCog, FileImage, FileLock, FileSpreadsheet,
  FileTerminal, FileText, FileType, FileVideo, Folder, FolderOpen, Presentation, type LucideIcon,
} from "lucide-react";
import { basename, extOf } from "./format";

type Fam = [LucideIcon, string];

const CODE: Fam = [FileCode, "text-info"];
const FAMILIES: Record<string, Fam> = {};
const add = (exts: string, fam: Fam) => exts.split(" ").forEach((e) => (FAMILIES[e] = fam));
add("ts tsx js jsx mjs cjs vue svelte astro", [FileCode, "text-info"]);
add("rs go py rb java kt kts scala swift c h cc cpp hpp cs php lua dart zig ex exs erl hs ml clj r jl", CODE);
add("html htm css scss sass less", [FileCode, "text-[#e879f9]"]);
add("json jsonc json5 yaml yml toml xml plist ini env", [Braces, "text-warn"]);
add("md mdx markdown rst txt log adoc", [FileText, "text-muted"]);
add("sh bash zsh fish ps1 bat cmd", [FileTerminal, "text-ok"]);
add("png jpg jpeg gif webp bmp ico svg avif heic tiff tif", [FileImage, "text-[#c084fc]"]);
add("mp4 mov mkv webm avi", [FileVideo, "text-[#c084fc]"]);
add("mp3 wav flac ogg m4a aac", [FileAudio, "text-[#c084fc]"]);
add("zip tar gz tgz bz2 xz 7z rar jar war", [FileArchive, "text-faint"]);
add("xlsx xls xlsm ods csv tsv", [FileSpreadsheet, "text-ok"]);
add("pdf", [BookOpen, "text-danger"]);
add("doc docx odt rtf pages", [FileText, "text-info"]);
add("ppt pptx key odp", [Presentation, "text-accent"]);
add("sql sqlite db sqlite3 prisma graphql gql", [Database, "text-accent"]);
add("ttf otf woff woff2", [FileType, "text-muted"]);
add("lock", [FileLock, "text-faint"]);
add("pem key crt cer p12", [FileLock, "text-warn"]);

const NAMES: Record<string, Fam> = {
  dockerfile: [FileCog, "text-info"],
  makefile: [FileTerminal, "text-ok"],
  ".gitignore": [FileCog, "text-faint"],
  ".gitattributes": [FileCog, "text-faint"],
  ".editorconfig": [FileCog, "text-faint"],
  ".env": [FileCog, "text-warn"],
  "license": [FileText, "text-muted"],
  "claude.md": [FileText, "text-accent"],
};

export function FileIcon({ name, isDir, open, className }: { name: string; isDir?: boolean; open?: boolean; className?: string }) {
  if (isDir) {
    const I = open ? FolderOpen : Folder;
    return <I className={clsx("size-3.5 shrink-0 text-muted", className)} />;
  }
  const b = basename(name).toLowerCase();
  const [I, tone] = NAMES[b] ?? (b.startsWith(".env") ? NAMES[".env"] : FAMILIES[extOf(b)]) ?? [File, "text-faint"];
  return <I className={clsx("size-3.5 shrink-0", tone, className)} />;
}
