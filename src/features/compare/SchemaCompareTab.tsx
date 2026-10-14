// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function SchemaCompareTab({ tab }: { tab: Extract<Tab, { type: "schema-compare" }> }) {
  return <Empty title="SchemaCompareTab">Not implemented yet ({tab.title})</Empty>;
}
