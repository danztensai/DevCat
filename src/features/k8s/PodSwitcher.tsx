// Pod picker shown in logs / shell panels opened from a workload (Deployment, StatefulSet, …).
import { Select } from "../../components/ui";

export default function PodSwitcher({ owner, pods, pod, onChange }: { owner?: string; pods: string[]; pod: string; onChange: (pod: string) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      {owner && <span className="max-w-48 truncate text-muted" title={owner}>{owner}</span>}
      <Select className="h-6 w-auto max-w-72 font-mono text-xs" value={pod} onChange={(e) => onChange(e.target.value)} title="Pod">
        {(pods.includes(pod) ? pods : [pod, ...pods]).map((p) => <option key={p} value={p}>{p}</option>)}
      </Select>
      <span className="text-faint">{pods.length} pod{pods.length === 1 ? "" : "s"}</span>
    </div>
  );
}
