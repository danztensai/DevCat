// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function DataTransferTab({ tab }: { tab: Extract<Tab, { type: "data-transfer" }> }) {
  return <Empty title="DataTransferTab">Not implemented yet ({tab.title})</Empty>;
}
