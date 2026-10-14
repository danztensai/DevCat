import { ArrowLeftRight, GitCompare, Plus } from "lucide-react";
import { KIND_META, KindIcon } from "../components/ui/KindIcon";
import type { ConnectionKind } from "../lib/types";
import { openTab } from "../store/tabs";
import { useUi } from "../store/ui";

const kinds = Object.keys(KIND_META) as ConnectionKind[];

export default function Welcome() {
  const openDialog = useUi((s) => s.openConnectionDialog);
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-8 py-14">
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-bold tracking-tight">DevCat</h1>
          <span className="text-muted">databases, queues and clusters in one place</span>
        </div>
        <h2 className="mt-10 mb-3 text-xs font-semibold uppercase tracking-wider text-muted">New connection</h2>
        <div className="grid grid-cols-4 gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              onClick={() => openDialog(null, k)}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-3 text-left hover:border-accent/60 hover:bg-raised"
            >
              <KindIcon kind={k} className="size-5" />
              <span className="text-[13px]">{KIND_META[k].label}</span>
            </button>
          ))}
        </div>
        <h2 className="mt-10 mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Tools</h2>
        <div className="grid grid-cols-3 gap-2">
          <ToolCard icon={<GitCompare className="size-5 text-info" />} title="Schema compare" desc="Diff two schemas and generate a sync script"
            onClick={() => openTab({ type: "schema-compare" }, "Schema Compare")} />
          <ToolCard icon={<ArrowLeftRight className="size-5 text-ok" />} title="Data transfer" desc="Export, import, backup, restore, copy tables"
            onClick={() => openTab({ type: "data-transfer" }, "Data Transfer")} />
          <ToolCard icon={<Plus className="size-5 text-accent" />} title="Add connection" desc="PostgreSQL, MySQL, Kubernetes, RabbitMQ…"
            onClick={() => openDialog(null)} />
        </div>
      </div>
    </div>
  );
}

function ToolCard({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4 text-left hover:border-accent/60 hover:bg-raised">
      {icon}
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted">{desc}</div>
    </button>
  );
}
