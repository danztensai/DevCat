// Tiny shield shown on connection rows that depend on a VPN / SSH tunnel (options.networkId).
import clsx from "clsx";
import { Cable, Shield } from "lucide-react";
import { STATE_LABEL } from "./meta";
import { useNet, useNetStatus } from "./store";

export function NetBadge({ id }: { id: string }) {
  const status = useNetStatus(id);
  const profile = useNet((s) => s.profiles.find((p) => p.id === id));
  const state = status?.state ?? "disconnected";
  const Icon = profile?.kind === "ssh" ? Cable : Shield;
  return (
    <span title={profile ? `Via ${profile.name} — ${STATE_LABEL[state]}` : "Network profile missing"} className="shrink-0">
      <Icon
        className={clsx(
          "size-3",
          !profile ? "text-danger" : state === "connected" ? "text-ok" : state === "error" ? "text-danger" : state === "disconnected" ? "text-faint" : "animate-pulse text-warn",
        )}
      />
    </span>
  );
}
