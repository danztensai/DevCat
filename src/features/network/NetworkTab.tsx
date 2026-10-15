// PLACEHOLDER — network profile editor / status / logs tab.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";
export default function NetworkTab({ tab }: { tab: Extract<Tab, { type: "network" }> }) {
  return <Empty title="Network profile">{tab.title}</Empty>;
}
