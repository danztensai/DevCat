// Opt-in passwordless VPN: a root-owned helper + sudoers rule so VPN connects stop asking
// for the admin password (macOS / Linux). Shown at the top of the VPN group.
import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog } from "../../components/ui";
import { api, errMsg } from "../../lib/api";
import type { NetHelperStatus } from "../../lib/types";
import { confirmDialog } from "../connections/dialogs";
import { useNet } from "./store";

export function PasswordlessVpnRow({ kinds }: { kinds: ("openvpn" | "wireguard")[] }) {
  const helper = useNet((s) => s.helper);
  const elevation = useNet((s) => s.tools?.elevation);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Windows asks through UAC; the helper only exists for macOS / Linux.
  if (!helper?.supported || elevation === "uac") return null;

  const issues = kinds.map((k) => (k === "openvpn" ? helper.openvpnIssue : helper.wireguardIssue)).filter((x): x is string => !!x);

  const remove = async () => {
    const ok = await confirmDialog({
      title: "Turn off passwordless VPN",
      message: `Remove ${helper.helperPath} and ${helper.sudoersPath}? VPN connections will ask for your password again. macOS / Linux asks for your password once to remove them.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      useNet.setState({ helper: await api.netHelperUninstall() });
      toast.success("Passwordless VPN is off");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  let row;
  if (!helper.installed) {
    row = (
      <div className="flex items-start gap-1.5 text-muted">
        <KeyRound className="mt-px size-3 shrink-0" />
        <div className="min-w-0 flex-1">
          VPN connections ask for your password each time.{" "}
          <button className="font-semibold text-accent hover:underline" onClick={() => setOpen(true)}>Set up passwordless VPN…</button>
        </div>
      </div>
    );
  } else {
    row = (
      <div className="flex items-start gap-1.5">
        <ShieldCheck className="mt-px size-3 shrink-0 text-ok" />
        <div className="min-w-0 flex-1">
          <span className="text-ok">Passwordless VPN is on</span>
          {!helper.upToDate && <span className="text-warn"> · needs an update</span>}
          {" · "}
          {!helper.upToDate && (
            <><button className="font-semibold text-accent hover:underline disabled:opacity-50" disabled={busy} onClick={() => setOpen(true)}>Update helper</button>{" · "}</>
          )}
          <button className="text-muted hover:text-fg hover:underline disabled:opacity-50" disabled={busy} onClick={() => void remove()}>Remove</button>
          {issues.map((i) => <div key={i} className="mt-0.5 text-warn" title={i}>Still asks for a password: {i}</div>)}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mx-2 mb-1 rounded border border-line bg-app/40 px-2 py-1 text-[11px]">{row}</div>
      <SetupDialog open={open} onClose={() => setOpen(false)} helper={helper} update={helper.installed} />
    </>
  );
}

function SetupDialog({ open, onClose, helper, update }: { open: boolean; onClose: () => void; helper: NetHelperStatus; update: boolean }) {
  const [busy, setBusy] = useState(false);
  const install = async () => {
    setBusy(true);
    try {
      const st = await api.netHelperInstall();
      useNet.setState({ helper: st });
      if (st.upToDate) {
        toast.success(update ? "Passwordless VPN helper updated" : "Passwordless VPN is on");
        onClose();
      } else {
        toast.error("The helper was installed, but sudo still asks for a password. Check that /etc/sudoers includes /etc/sudoers.d.");
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const issues = [helper.openvpnIssue, helper.wireguardIssue].filter((x): x is string => !!x);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={update ? "Update passwordless VPN helper" : "Set up passwordless VPN"}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!helper.sudoersLine} onClick={() => void install()}>
            {update ? "Update" : "Set up"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p>
          {update
            ? "DevCat has changed since the helper was installed. Updating replaces the helper with this version."
            : "VPN connections will stop asking for your administrator password. Setting this up asks for it once and installs:"}
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            A copy of DevCat that only runs VPN commands, owned by root:
            <div className="selectable mt-0.5 font-mono text-[12px] text-muted">{helper.helperPath}</div>
          </li>
          <li>
            A sudoers rule letting your account run that helper without a password:
            <div className="selectable mt-0.5 font-mono text-[12px] text-muted">{helper.sudoersPath}</div>
            <div className="selectable mt-0.5 rounded bg-app px-2 py-1 font-mono text-[12px]">{helper.sudoersLine ?? "Your account name can't be used in a sudoers rule."}</div>
          </li>
        </ul>
        <p className="text-muted">
          The helper refuses configs that run scripts or load plugins as root (OpenVPN <code>up</code>, <code>down</code>,{" "}
          <code>plugin</code>…, WireGuard <code>PostUp</code>, <code>PreDown</code>…) and files that aren't yours. You can still connect those with a
          password prompt. It only runs OpenVPN and wg-quick from root-owned locations.
        </p>
        <p className="text-muted">
          Any program running as your user can then start or stop VPN connections without asking. You can remove the helper at any time.
        </p>
        {issues.length > 0 && (
          <div className="rounded border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[12px] text-warn">
            {issues.map((i) => <div key={i}>{i}. That tool will keep asking for your password.</div>)}
          </div>
        )}
      </div>
    </Dialog>
  );
}
