// bb-plugin-activity-overview — shared frontend/backend constants.

/** Realtime channel: coalesced thread:changed notifications for the token
 * flow view (its per-minute burn buckets move on live threads). */
export const FLOW_CHANGED = "activity-overview:flow-changed";

export type FlowChangedPayload = { threadIds: string[] };
