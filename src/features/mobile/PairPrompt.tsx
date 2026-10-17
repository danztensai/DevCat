// "Allow this phone to control DevCat?": shown in every window when a phone with a valid
// pairing code asks to pair. The first answer wins; the backend times out after 2 minutes.
import { Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog } from "../../components/ui";
import { errMsg } from "../../lib/api";
import { mobileApi, type Access } from "./api";
import { useMobile } from "./store";

export function PairPrompt() {
  const req = useMobile((s) => s.status?.pending[0] ?? null);
  const [access, setAccess] = useState<Access>("full");
  if (!req) return null;
  const answer = async (a: Access | null) => {
    try {
      await mobileApi.pairAnswer(req.requestId, a);
      if (a) toast.success(`${req.name} is paired`, { description: a === "readonly" ? "Read-only access" : "Full access" });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog
      open
      onClose={() => void answer(null)}
      title="Allow this phone to control DevCat?"
      width={460}
      footer={<><Button variant="ghost" onClick={() => void answer(null)}>Deny</Button><Button variant="primary" onClick={() => void answer(access)}>Allow</Button></>}
    >
      <div className="space-y-3 text-[13px]">
        <div className="flex items-center gap-3 rounded-md border border-line bg-raised px-3 py-2.5">
          <Smartphone className="size-5 text-muted" />
          <div className="min-w-0">
            <div className="font-semibold">{req.name}</div>
            <div className="truncate text-[11px] text-muted">
              {req.platform || "phone"}{req.addr ? ` · ${req.addr.replace(/:\d+$/, "")}` : ""} · key <span className="font-mono">{req.deviceId.slice(0, 6)}…{req.deviceId.slice(-6)}</span>
            </div>
          </div>
        </div>
        <p className="text-[12px] text-muted">
          It scanned this computer's pairing code. It will see your connections, agents, VPNs and clusters, and with full access it can run queries, edit data and type into terminals. Passwords never leave this computer.
        </p>
        <div className="flex rounded-md border border-line bg-app p-0.5">
          {(["full", "readonly"] as Access[]).map((a) => (
            <button key={a} onClick={() => setAccess(a)} className={`flex-1 rounded py-1 text-[12px] ${access === a ? "bg-hover font-semibold text-fg" : "text-muted"}`}>
              {a === "full" ? "Full access" : "Read-only"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint">Didn't scan a code just now? Click Deny.</p>
      </div>
    </Dialog>
  );
}
