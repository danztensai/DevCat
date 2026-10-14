// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function HistoryTab({ tab }: { tab: Extract<Tab, { type: "history" }> }) {
  return <Empty title="HistoryTab">Not implemented yet ({tab.title})</Empty>;
}
