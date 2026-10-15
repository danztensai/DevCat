// Promise-based confirm / prompt dialogs (window.confirm/prompt don't work in the webview).
//   const { dlg, element } = useGitDialogs();
//   if (await dlg.confirm({ title, body, ok: "Delete", danger: true })) …
//   const r = await dlg.prompt({ title, label: "Branch name" }); if (r) … r.value
//   … {element}
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button, Checkbox, Dialog, Field, Input } from "../../components/ui";

export interface ConfirmOpts { title: string; body: ReactNode; ok?: string; danger?: boolean }

export interface PromptOpts {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  hint?: string;
  ok?: string;
  /** Optional second, free-text field (e.g. a tag message). */
  second?: { label: string; placeholder?: string };
  checkbox?: { label: string; initial?: boolean };
  /** Allow an empty value (e.g. an optional stash message). */
  allowEmpty?: boolean;
  /** Return an error message to block submitting. */
  validate?: (v: string) => string | null;
  body?: ReactNode;
}

export interface PromptResult { value: string; second: string; checked: boolean }

type State =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (r: PromptResult | null) => void };

/** Git ref names: no spaces, "..", "~^:?*[\", leading "-", trailing "/" or ".lock". */
export function validateRefName(v: string): string | null {
  const s = v.trim();
  if (!s) return "Required";
  if (/\s/.test(s)) return "No spaces allowed";
  if (/\.\.|[~^:?*[\\]|@\{/.test(s) || s.startsWith("-") || s.startsWith("/") || s.endsWith("/") || s.endsWith(".") || s.endsWith(".lock")) {
    return "Not a valid git ref name";
  }
  return null;
}

/** Stable handle passed to the action helpers. */
export interface Dialogs {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<PromptResult | null>;
}

export function useGitDialogs(): { dlg: Dialogs; element: ReactNode } {
  const [state, setState] = useState<State | null>(null);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })), []);
  const prompt = useCallback((opts: PromptOpts) => new Promise<PromptResult | null>((resolve) => setState({ kind: "prompt", opts, resolve })), []);

  const dlg = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);
  const element = state ? (
    state.kind === "confirm"
      ? <ConfirmDialog key="c" opts={state.opts} onDone={(ok) => { setState(null); state.resolve(ok); }} />
      : <PromptDialog key="p" opts={state.opts} onDone={(r) => { setState(null); state.resolve(r); }} />
  ) : null;

  return { dlg, element };
}

function ConfirmDialog({ opts, onDone }: { opts: ConfirmOpts; onDone: (ok: boolean) => void }) {
  const cancel = useCallback(() => onDone(false), [onDone]);
  return (
    <Dialog
      open
      onClose={cancel}
      title={opts.title}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
          <Button variant={opts.danger ? "danger" : "primary"} autoFocus onClick={() => onDone(true)}>{opts.ok ?? "OK"}</Button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-fg/90">{opts.body}</div>
    </Dialog>
  );
}

function PromptDialog({ opts, onDone }: { opts: PromptOpts; onDone: (r: PromptResult | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? "");
  const [second, setSecond] = useState("");
  const [checked, setChecked] = useState(opts.checkbox?.initial ?? false);
  const [touched, setTouched] = useState(false);
  const cancel = useCallback(() => onDone(null), [onDone]);

  const error = opts.validate ? opts.validate(value) : !opts.allowEmpty && !value.trim() ? "Required" : null;
  const submit = () => {
    setTouched(true);
    if (!error) onDone({ value: value.trim(), second: second.trim(), checked });
  };

  return (
    <Dialog
      open
      onClose={cancel}
      title={opts.title}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
          <Button variant="primary" disabled={touched && !!error} onClick={submit}>{opts.ok ?? "OK"}</Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {opts.body && <div className="text-[13px] text-fg/85">{opts.body}</div>}
        <Field label={opts.label} hint={touched && error ? undefined : opts.hint}>
          <Input autoFocus onFocus={(e) => e.target.select()} value={value} placeholder={opts.placeholder} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {touched && error && <div className="-mt-2 text-[11px] text-danger">{error}</div>}
        {opts.second && (
          <Field label={opts.second.label}>
            <Input value={second} placeholder={opts.second.placeholder} onChange={(e) => setSecond(e.target.value)} />
          </Field>
        )}
        {opts.checkbox && <Checkbox label={opts.checkbox.label} checked={checked} onChange={setChecked} />}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
