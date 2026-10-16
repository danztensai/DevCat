// "Install OpenVPN 2.7.8" (Windows): runs the installer DevCat ships, behind one UAC prompt.
import { Download } from "lucide-react";
import { Button } from "../../components/ui";
import { installTool, useToolInstall } from "./actions";
import { NET_KIND_META } from "./meta";

export function InstallToolButton({ kind, version, className }: { kind: "openvpn" | "wireguard"; version: string; className?: string }) {
  const busy = useToolInstall((s) => !!s.busy[kind]);
  return (
    <Button size="sm" variant="primary" className={className} loading={busy} onClick={() => void installTool(kind)}
      title={`Runs the official ${NET_KIND_META[kind].label} ${version} installer included with DevCat (Windows asks for permission once)`}>
      {!busy && <Download className="size-3" />}Install {NET_KIND_META[kind].label} {version}
    </Button>
  );
}
