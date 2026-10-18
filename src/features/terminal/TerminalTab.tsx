// A terminal tab: a login shell in a folder (local, or on an SSH host), on its own, apart from
// any agent chat. Closing the tab ends the shell.
import { useTabs } from "../../store/tabs";
import type { Tab } from "../../tabs/types";
import { TerminalPane } from "../claude/TerminalPane";

type TerminalTabT = Extract<Tab, { type: "terminal" }>;

export default function TerminalTab({ tab }: { tab: TerminalTabT }) {
  const active = useTabs((s) => s.activeId === tab.id);
  return (
    <div className="h-full bg-app">
      <TerminalPane cwd={tab.cwd} program={null} name="shell" visible={active} />
    </div>
  );
}
