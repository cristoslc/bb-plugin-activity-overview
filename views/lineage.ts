// Pure helpers for thread-family lineage decoration in the shape build
// (server.ts). No SDK imports, so they are easy to unit test (see tests/).

/**
 * The bits of a thread the lineage helpers read. `projectId` is `null` for
 * personal-scope threads on older hosts; a null-to-null comparison counts as
 * the same scope so such families stay unwritten.
 */
export type LineageThread = {
  id: string;
  projectId: string | null;
  parentThreadId: string | null;
};

/**
 * The "spawned by" hint for a thread node, or `null` when the family
 * connection needs no extra labeling: no parent, or a parent in the same
 * project whose lineage the parent's delegation rows already show. A parent
 * outside the visible roster (archived, hidden, or past the roster ceiling)
 * renders plainly as "archived or hidden thread" rather than staying silent.
 */
export function spawnHint(
  thread: { id: string; projectId: string | null; parentThreadId: string | null },
  byId: ReadonlyMap<string, LineageThread>,
  projectName: (projectId: string) => string | null,
): string | null {
  const parentId = thread.parentThreadId;
  if (parentId === null || parentId === thread.id) return null;
  const parent = byId.get(parentId);
  if (parent === undefined) return "archived or hidden thread";
  if (parent.projectId === thread.projectId) return null;
  if (parent.projectId === null) return null;
  return projectName(parent.projectId) ?? parent.projectId;
}

/**
 * The child thread a delegation row links to: `childRef` only counts when it
 * is a string naming a thread in the current roster, so provider session ids
 * and refs to archived threads never masquerade as a link.
 */
export function delegationChildId(
  childRef: unknown,
  threadIds: ReadonlySet<string>,
): string | null {
  if (typeof childRef !== "string") return null;
  return threadIds.has(childRef) ? childRef : null;
}