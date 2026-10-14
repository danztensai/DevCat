// Typed wrappers around the rmq_* Tauri commands (src-tauri/src/infra/rabbitmq).
// Management API objects are large and version dependent, so only the fields the
// UI reads are typed; everything else stays reachable through the index signature.
import { invoke } from "@tauri-apps/api/core";

type Loose = { [k: string]: any };

export interface Sample { sample: number; timestamp: number }
export interface RateDetails { rate: number; samples?: Sample[]; avg?: number; avg_rate?: number }

export interface MessageStats extends Loose {
  publish?: number; publish_details?: RateDetails;
  publish_in_details?: RateDetails; publish_out_details?: RateDetails;
  deliver_get?: number; deliver_get_details?: RateDetails;
  deliver_details?: RateDetails;
  ack?: number; ack_details?: RateDetails;
  redeliver?: number; redeliver_details?: RateDetails;
  confirm_details?: RateDetails;
  return_unroutable_details?: RateDetails;
}

export interface Overview extends Loose {
  rabbitmq_version: string;
  erlang_version: string;
  management_version?: string;
  cluster_name?: string;
  node?: string;
  message_stats?: MessageStats;
  queue_totals?: {
    messages?: number; messages_ready?: number; messages_unacknowledged?: number;
    messages_details?: RateDetails; messages_ready_details?: RateDetails; messages_unacknowledged_details?: RateDetails;
  };
  object_totals?: { connections: number; channels: number; exchanges: number; queues: number; consumers: number };
  listeners?: { node: string; protocol: string; ip_address: string; port: number }[];
}

export interface RmqNode extends Loose {
  name: string; type?: string; running: boolean; uptime?: number;
  mem_used?: number; mem_limit?: number; mem_alarm?: boolean;
  disk_free?: number; disk_free_limit?: number; disk_free_alarm?: boolean;
  fd_used?: number; fd_total?: number; sockets_used?: number; sockets_total?: number;
  proc_used?: number; proc_total?: number; run_queue?: number; processors?: number;
  partitions?: string[];
}

export interface Queue extends Loose {
  name: string; vhost: string; type?: string; durable: boolean; auto_delete: boolean;
  exclusive?: boolean; arguments: Record<string, unknown>; state?: string; node?: string;
  policy?: string | null; consumers?: number; consumer_utilisation?: number | null;
  messages?: number; messages_ready?: number; messages_unacknowledged?: number;
  messages_details?: RateDetails; messages_ready_details?: RateDetails; messages_unacknowledged_details?: RateDetails;
  message_bytes?: number; memory?: number; message_stats?: MessageStats;
  consumer_details?: ConsumerDetail[]; idle_since?: string;
  members?: string[]; leader?: string; online?: string[];
}

export interface Exchange extends Loose {
  name: string; vhost: string; type: string; durable: boolean; auto_delete: boolean;
  internal: boolean; arguments: Record<string, unknown>; policy?: string | null;
  message_stats?: MessageStats;
}

export interface Binding extends Loose {
  source: string; vhost: string; destination: string; destination_type: "queue" | "exchange";
  routing_key: string; arguments: Record<string, unknown>; properties_key: string;
}

export interface ConsumerDetail extends Loose {
  consumer_tag: string; ack_required: boolean; exclusive: boolean; prefetch_count: number;
  active?: boolean; activity_status?: string; arguments?: Record<string, unknown>;
  queue?: { name: string; vhost: string };
  channel_details?: { name: string; connection_name: string; peer_host?: string; peer_port?: number; user?: string };
}

export interface Connection extends Loose {
  name: string; user: string; vhost: string; state?: string; protocol?: string; node?: string;
  ssl?: boolean; channels?: number; peer_host?: string; peer_port?: number; connected_at?: number;
  timeout?: number; frame_max?: number; client_properties?: Loose; user_provided_name?: string;
  recv_oct_details?: RateDetails; send_oct_details?: RateDetails; recv_oct?: number; send_oct?: number;
}

export interface Channel extends Loose {
  name: string; user: string; vhost: string; number: number; state?: string;
  connection_details?: { name: string; peer_host?: string; peer_port?: number };
  consumer_count?: number; prefetch_count?: number; global_prefetch_count?: number;
  messages_unacknowledged?: number; messages_unconfirmed?: number; messages_uncommitted?: number;
  confirm?: boolean; transactional?: boolean; message_stats?: MessageStats;
}

export interface Vhost extends Loose {
  name: string; description?: string; tags?: string[]; tracing?: boolean;
  default_queue_type?: string; metadata?: Loose;
  messages?: number; messages_ready?: number; messages_unacknowledged?: number;
  message_stats?: MessageStats; cluster_state?: Record<string, string>;
}

export interface User extends Loose { name: string; tags: string[] | string; hashing_algorithm?: string; limits?: Loose }
export interface Permission extends Loose { user: string; vhost: string; configure: string; write: string; read: string }
export interface Policy extends Loose {
  name: string; vhost: string; pattern: string; "apply-to": string; priority: number; definition: Loose;
}

export interface Page<T> {
  items: T[];
  total_count: number;
  filtered_count: number;
  page_count: number;
  page: number;
  page_size: number;
}

export interface GotMessage extends Loose {
  payload: string;
  payload_bytes: number;
  payload_encoding: "string" | "base64";
  redelivered: boolean;
  exchange: string;
  routing_key: string;
  message_count: number;
  properties: Loose & { headers?: Record<string, unknown> };
}

export type Resource =
  | "queues" | "exchanges" | "bindings" | "connections" | "channels" | "consumers"
  | "vhosts" | "users" | "policies" | "permissions" | "nodes";

export type AckMode = "ack_requeue_true" | "ack_requeue_false" | "reject_requeue_true" | "reject_requeue_false";

export interface ListPageArgs {
  resource: Resource;
  vhost?: string | null;
  page?: number;
  pageSize?: number;
  nameFilter?: string | null;
  useRegex?: boolean;
  sort?: string | null;
  sortReverse?: boolean;
}

export const rmq = {
  overview: (connId: string) => invoke<Overview>("rmq_overview", { connId }),
  nodes: (connId: string) => invoke<RmqNode[]>("rmq_nodes", { connId }),
  list: <T = Loose>(connId: string, resource: Resource, vhost?: string | null) =>
    invoke<T[]>("rmq_list", { connId, resource, vhost: vhost || null }),
  listPage: <T = Loose>(connId: string, a: ListPageArgs) =>
    invoke<Page<T>>("rmq_list_page", {
      connId, resource: a.resource, vhost: a.vhost || null, page: a.page ?? 1, pageSize: a.pageSize ?? 100,
      nameFilter: a.nameFilter || null, useRegex: a.useRegex ?? false, sort: a.sort || null, sortReverse: a.sortReverse ?? false,
    }),
  get: <T = Loose>(connId: string, resource: Resource, vhost: string | null, name: string) =>
    invoke<T>("rmq_get", { connId, resource, vhost, name }),
  bindings: (connId: string, vhost: string, kind: "queue" | "source" | "destination", name: string) =>
    invoke<Binding[]>("rmq_bindings", { connId, vhost, kind, name }),

  declareQueue: (connId: string, vhost: string, name: string, durable: boolean, autoDelete: boolean, args: Record<string, unknown>) =>
    invoke<void>("rmq_declare_queue", { connId, vhost, name, durable, autoDelete, arguments: args }),
  deleteQueue: (connId: string, vhost: string, name: string, ifEmpty = false, ifUnused = false) =>
    invoke<void>("rmq_delete_queue", { connId, vhost, name, ifEmpty, ifUnused }),
  purgeQueue: (connId: string, vhost: string, name: string) => invoke<void>("rmq_purge_queue", { connId, vhost, name }),
  getMessages: (connId: string, vhost: string, queue: string, count: number, ackmode: AckMode, encoding: "auto" | "base64", truncate?: number | null) =>
    invoke<GotMessage[]>("rmq_get_messages", { connId, vhost, queue, count, ackmode, encoding, truncate: truncate ?? null }),

  declareExchange: (connId: string, vhost: string, name: string, type: string, durable: boolean, autoDelete: boolean, internal: boolean, args: Record<string, unknown>) =>
    invoke<void>("rmq_declare_exchange", { connId, vhost, name, exchangeType: type, durable, autoDelete, internal, arguments: args }),
  deleteExchange: (connId: string, vhost: string, name: string, ifUnused = false) =>
    invoke<void>("rmq_delete_exchange", { connId, vhost, name, ifUnused }),
  publish: (connId: string, vhost: string, exchange: string, routingKey: string, payload: string, payloadEncoding: "string" | "base64", properties: Record<string, unknown>) =>
    invoke<boolean>("rmq_publish", { connId, vhost, exchange, routingKey, payload, payloadEncoding, properties }),

  createBinding: (connId: string, vhost: string, source: string, destinationType: "q" | "e", destination: string, routingKey: string, args: Record<string, unknown>) =>
    invoke<void>("rmq_create_binding", { connId, vhost, source, destinationType, destination, routingKey, arguments: args }),
  deleteBinding: (connId: string, vhost: string, source: string, destinationType: "q" | "e", destination: string, propsKey: string) =>
    invoke<void>("rmq_delete_binding", { connId, vhost, source, destinationType, destination, propsKey }),

  closeConnection: (connId: string, name: string, reason?: string) =>
    invoke<void>("rmq_close_connection", { connId, name, reason: reason || null }),
  request: <T = unknown>(connId: string, method: string, path: string, body?: unknown) =>
    invoke<T>("rmq_request", { connId, method, path, body: body ?? null }),
};
