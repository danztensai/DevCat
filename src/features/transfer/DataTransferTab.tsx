import clsx from "clsx";
import { ArrowLeftRight, DatabaseBackup, Download, RotateCcw, Upload, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { Tab } from "../../tabs/types";
import { BackupPanel, CopyPanel, RestorePanel } from "./BackupPanels";
import { ExportPanel } from "./ExportPanel";
import { ImportPanel } from "./ImportPanel";
import { JobLog, useJob } from "./JobLog";
import { lsGet, lsSet, type Target } from "./shared";

type TransferTab = Extract<Tab, { type: "data-transfer" }>;
type Tool = "export" | "import" | "backup" | "restore" | "copy";

const TOOLS: { id: Tool; label: string; icon: LucideIcon; desc: string }[] = [
  { id: "export", label: "Export", icon: Download, desc: "Write tables or a query result to CSV, JSON, SQL or Excel files." },
  { id: "import", label: "Import", icon: Upload, desc: "Load a CSV or JSON file into an existing table." },
  { id: "backup", label: "Backup", icon: DatabaseBackup, desc: "Dump structure and data of a database or schema to a .sql file." },
  { id: "restore", label: "Restore", icon: RotateCcw, desc: "Run a .sql backup script against a database." },
  { id: "copy", label: "Copy between connections", icon: ArrowLeftRight, desc: "Transfer tables and rows from one connection to another." },
];

export default function DataTransferTab({ tab }: { tab: TransferTab }) {
  const [tool, setTool] = useState<Tool>(() => lsGet<Tool>("transfer:tool", "export"));
  const job = useJob();
  const initial: Target = { connId: tab.connId ?? "", database: tab.database ?? null, schema: tab.schema ?? null };
  const meta = TOOLS.find((t) => t.id === tool)!;
  const [visited, setVisited] = useState<Set<Tool>>(() => new Set([tool]));
  const select = (t: Tool) => { setTool(t); setVisited((v) => new Set(v).add(t)); lsSet("transfer:tool", t); };
  const panel = (id: Tool, node: React.ReactNode) => visited.has(id) && <div className={clsx(tool !== id && "hidden")}>{node}</div>;

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2" aria-label="Transfer tools">
        <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Data transfer</div>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => select(t.id)}
            disabled={job.job.running && t.id !== tool}
            className={clsx(
              "flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] disabled:opacity-40",
              tool === t.id ? "bg-accent/15 text-fg" : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <t.icon className={clsx("size-4 shrink-0", tool === t.id && "text-accent")} />
            <span className="truncate">{t.label}</span>
          </button>
        ))}
      </nav>
      <Group orientation="vertical" className="min-w-0 flex-1">
        <Panel defaultSize="70%" minSize="30%">
          <div className="h-full overflow-auto bg-app">
            <div className="mx-auto max-w-6xl p-4">
              <div className="mb-3">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold"><meta.icon className="size-4 text-accent" />{meta.label}</h2>
                <p className="text-xs text-muted">{meta.desc}</p>
              </div>
              {/* keep panels mounted so form state survives switching tools */}
              {panel("export", <ExportPanel initial={initial} job={job} />)}
              {panel("import", <ImportPanel initial={initial} job={job} />)}
              {panel("backup", <BackupPanel initial={initial} job={job} />)}
              {panel("restore", <RestorePanel initial={initial} job={job} />)}
              {panel("copy", <CopyPanel initial={initial} job={job} />)}
            </div>
          </div>
        </Panel>
        <Separator className="h-px bg-line hover:bg-accent data-[separator=active]:bg-accent" />
        <Panel minSize="12%">
          <JobLog job={job} />
        </Panel>
      </Group>
    </div>
  );
}
