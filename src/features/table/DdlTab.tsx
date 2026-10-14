// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function DdlTab({ tab }: { tab: Extract<Tab, { type: "ddl" }> }) {
  return <Empty title="DdlTab">Not implemented yet ({tab.title})</Empty>;
}
