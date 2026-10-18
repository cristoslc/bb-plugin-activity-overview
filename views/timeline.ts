// Pure helpers for reading bb thread timelines. No SDK imports, so they are
// easy to unit test (see tests/).

/** A timeline row read loosely, so new row kinds never break the flow view. */
export type Row = Record<string, unknown>;

/**
 * A persisted `client/turn/requested` event row's model string — the only
 * vendor-model attribution the host keeps per turn. Loose read: absent or
 * malformed execution blocks return null.
 */
export function executionModel(row: Row | null | undefined): string | null {
  const data = (row?.data ?? null) as Row | null;
  const execution = (data?.execution ?? null) as Row | null;
  const model = execution?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}
