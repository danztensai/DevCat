// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function RedisTab({ tab }: { tab: Extract<Tab, { type: "redis" }> }) {
  return <Empty title="RedisTab">Not implemented yet ({tab.title})</Empty>;
}
