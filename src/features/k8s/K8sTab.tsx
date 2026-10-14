// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function K8sTab({ tab }: { tab: Extract<Tab, { type: "k8s" }> }) {
  return <Empty title="K8sTab">Not implemented yet ({tab.title})</Empty>;
}
