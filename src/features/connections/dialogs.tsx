// Promise-based confirm / prompt dialogs. <DialogHost/> is mounted once by ConnectionDialog
// (which AppShell mounts globally), so any feature can `await confirmDialog(...)`.
import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { Button, Dialog, Input } from "../../components/ui";

interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  /** Shown in a scrollable monospace block (e.g. SQL to be executed). */
  code?: string;
  confirmLabel?: string;
  danger?: boolean;
  width?: number;
}
interface PromptOpts {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

type Pending =
  | { type: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { type: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

const useDialogs = create<{ pending: Pending | null }>(() => ({ pending: null }));

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => useDialogs.setState({ pending: { type: "confirm", opts, resolve } }));
}

export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => useDialogs.setState({ pending: { type: "prompt", opts, resolve } }));
}

export function DialogHost() {
  const pending = useDialogs((s) => s.pending);
  if (!pending) return null;
  const done = (v: boolean | string | null) => {
    useDialogs.setState({ pending: null });
    (pending.resolve as (x: unknown) => void)(v);
  };
  return pending.type === "confirm"
    ? <ConfirmView opts={pending.opts} onDone={done} />
    : <PromptView opts={pending.opts} onDone={done} />;
}

function ConfirmView({ opts, onDone }: { opts: ConfirmOpts; onDone: (v: boolean) => void }) {
  return (
    <Dialog
      open
      title={opts.title}
      width={opts.width ?? (opts.code ? 680 : 420)}
      onClose={() => onDone(false)}
      footer={
        <>
          <Button onClick={() => onDone(false)}>Cancel</Button>
          <Button autoFocus variant={opts.danger ? "danger" : "primary"} onClick={() => onDone(true)}>
            {opts.confirmLabel ?? "OK"}
          </Button>
        </>
      }
    >
      {opts.message && <div className="text-[13px] text-fg/90">{opts.message}</div>}
      {opts.code && (
        <pre className="selectable mt-3 max-h-[50vh] overflow-auto rounded-md border border-line bg-app p-3 font-mono text-xs whitespace-pre-wrap">
          {opts.code}
        </pre>
      )}
    </Dialog>
  );
}

function PromptView({ opts, onDone }: { opts: PromptOpts; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const submit = () => value.trim() && onDone(value.trim());
  return (
    <Dialog
      open
      title={opts.title}
      width={420}
      onClose={() => onDone(null)}
      footer={
        <>
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button variant="primary" disabled={!value.trim()} onClick={submit}>{opts.confirmLabel ?? "OK"}</Button>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        {opts.label && <span className="text-xs text-muted">{opts.label}</span>}
        <Input
          autoFocus
          value={value}
          placeholder={opts.placeholder}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>
    </Dialog>
  );
}
