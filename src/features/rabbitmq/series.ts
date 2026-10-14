// Chart series definitions and builders shared by the overview and detail panels.
import type { MessageStats, RateDetails } from "./api";
import { counterRates, gaugeSamples, rate } from "./format";
import { SERIES, type SeriesDef } from "./parts";

export const RATE_SERIES: SeriesDef[] = [
  { key: "publish", label: "Publish", color: SERIES[0] },
  { key: "deliver", label: "Deliver / get", color: SERIES[1] },
  { key: "ack", label: "Ack", color: SERIES[2] },
  { key: "redeliver", label: "Redeliver", color: SERIES[3] },
];
export const QUEUED_SERIES: SeriesDef[] = [
  { key: "ready", label: "Ready", color: SERIES[0] },
  { key: "unacked", label: "Unacked", color: SERIES[1] },
  { key: "total", label: "Total", color: SERIES[2], dashed: true },
];

export interface Lengths {
  messages?: number; messages_ready?: number; messages_unacknowledged?: number;
  messages_details?: RateDetails; messages_ready_details?: RateDetails; messages_unacknowledged_details?: RateDetails;
}

/** Chart inputs from any object carrying message_stats + queue length details (overview, vhost, queue). */
export function rateInput(stats: MessageStats | undefined, at: number) {
  const s = stats ?? {};
  return {
    at,
    sampled: {
      publish: counterRates(s.publish_details?.samples),
      deliver: counterRates(s.deliver_get_details?.samples),
      ack: counterRates(s.ack_details?.samples),
      redeliver: counterRates(s.redeliver_details?.samples),
    },
    live: {
      publish: rate(s.publish_details), deliver: rate(s.deliver_get_details),
      ack: rate(s.ack_details), redeliver: rate(s.redeliver_details),
    },
  };
}

export function lengthInput(l: Lengths | undefined, at: number) {
  const q = l ?? {};
  return {
    at,
    sampled: {
      ready: gaugeSamples(q.messages_ready_details?.samples),
      unacked: gaugeSamples(q.messages_unacknowledged_details?.samples),
      total: gaugeSamples(q.messages_details?.samples),
    },
    live: { ready: q.messages_ready ?? 0, unacked: q.messages_unacknowledged ?? 0, total: q.messages ?? 0 },
  };
}
