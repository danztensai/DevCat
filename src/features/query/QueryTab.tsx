// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function QueryTab({ tab }: { tab: Extract<Tab, { type: "query" }> }) {
  return <Empty title="QueryTab">Not implemented yet ({tab.title})</Empty>;
}
