// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function RabbitTab({ tab }: { tab: Extract<Tab, { type: "rabbitmq" }> }) {
  return <Empty title="RabbitTab">Not implemented yet ({tab.title})</Empty>;
}
