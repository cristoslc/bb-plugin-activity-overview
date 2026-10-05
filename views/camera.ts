// Camera-state persistence for the map-canvas views: a pure codec for the
// session-store document `{ tab, cams }` — the last-visited tab plus one
// camera per tab, so bb forward/back restores both. The DOM side (the
// sessionStorage calls) stays in views/Views.tsx; this module knows nothing
// about storage, only about the document shape.

/** A committed map-canvas transform: scale plus world-space pan. */
export type Camera = { k: number; tx: number; ty: number };

/** The persisted document: last-visited tab and each tab's camera. */
export type CameraStore = { tab: string; cams: Record<string, Camera> };

export const CAMERA_STORE_KEY = "activity-overview:camera";

export const DEFAULT_CAMERA_STORE: CameraStore = { tab: "board", cams: {} };

const isCamera = (v: unknown): v is Camera =>
  typeof v === "object" &&
  v !== null &&
  Number.isFinite((v as Camera).k) &&
  Number.isFinite((v as Camera).tx) &&
  Number.isFinite((v as Camera).ty);

/**
 * Decode a stored value. Missing or malformed values decode to the empty
 * default frame; cameras under unknown tab ids or with missing/non-finite
 * fields are dropped so a stale doc can never poison the canvas transform.
 */
export function parseCameraStore(
  raw: string | null,
  knownTabs: readonly string[],
): CameraStore {
  if (raw === null) return DEFAULT_CAMERA_STORE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CAMERA_STORE;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_CAMERA_STORE;
  const rec = parsed as Record<string, unknown>;
  const cams: Record<string, Camera> = {};
  if (typeof rec.cams === "object" && rec.cams !== null) {
    const src = rec.cams as Record<string, unknown>;
    for (const id of knownTabs) {
      if (isCamera(src[id])) cams[id] = src[id];
    }
  }
  return {
    tab: typeof rec.tab === "string" ? rec.tab : DEFAULT_CAMERA_STORE.tab,
    cams,
  };
}

/** Merge a patch into the store; writers patch, they never replace. */
export function mergeCameraStore(
  store: CameraStore,
  patch: { tab?: string; cams?: Record<string, Camera> },
): CameraStore {
  return {
    tab: patch.tab ?? store.tab,
    cams: { ...store.cams, ...(patch.cams ?? {}) },
  };
}