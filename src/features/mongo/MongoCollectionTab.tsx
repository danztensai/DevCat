// PLACEHOLDER — to be implemented.
import { Empty } from "../../components/ui";
import type { Tab } from "../../tabs/types";

export default function MongoCollectionTab({ tab }: { tab: Extract<Tab, { type: "mongo-collection" }> }) {
  return <Empty title="MongoCollectionTab">Not implemented yet ({tab.title})</Empty>;
}
