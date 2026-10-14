// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function TableDesignerTab({ tab }: { tab: Extract<Tab, { type: "table-design" }> }) {
  return <Empty title="TableDesignerTab">Not implemented yet ({tab.title})</Empty>;
}
