// PLACEHOLDER — Claude Code workspace tab: Chat / Diff / Code Review.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";
export default function ClaudeTab({ tab }: { tab: Extract<Tab, { type: "claude" }> }) {
  return <Empty title="Claude Code">{tab.cwd}</Empty>;
}
