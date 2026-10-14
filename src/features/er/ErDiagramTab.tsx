// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function ErDiagramTab({ tab }: { tab: Extract<Tab, { type: "er-diagram" }> }) {
  return <Empty title="ErDiagramTab">Not implemented yet ({tab.title})</Empty>;
}
