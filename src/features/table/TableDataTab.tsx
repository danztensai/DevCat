// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function TableDataTab({ tab }: { tab: Extract<Tab, { type: "table-data" }> }) {
  return <Empty title="TableDataTab">Not implemented yet ({tab.title})</Empty>;
}
