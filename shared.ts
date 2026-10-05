// bb-plugin-activity-overview — shared frontend/backend constants.

/** Realtime channel: coalesced thread:changed notifications for the flow view. */
export const SHAPE_CHANGED = "activity-overview:shape-changed";

export type ShapeChangedPayload = { threadIds: string[] };