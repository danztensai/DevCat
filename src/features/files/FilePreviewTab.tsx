// PLACEHOLDER — file preview tab.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";
export default function FilePreviewTab({ tab }: { tab: Extract<Tab, { type: "file" }> }) {
  return <Empty title="Preview">{tab.path}</Empty>;
}
