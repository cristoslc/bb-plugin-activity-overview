// Camera-state persistence for the map-canvas views: a pure codec for the
// session-store document `{ tab, cams }` — the last-visited tab plus one
// camera per tab, so bb forward/back restores both. The DOM side (the
// sessionStorage calls) stays in views/Views.tsx; this module knows nothing
// about storage, only about the document shape.

/** A committed map-canvas transform: scale plus world-space pan. `W`/`H` are
 * the world dimensions the transform was captured against. A stored camera is
 * only meaningful against the world it was captured on, so the codec rejects
 * any entry without finite world dims (a legacy document, or one written
 * before the world was known) rather than restore it blindly. */
export type Camera = { k: number; tx: number; ty: number; W?: number; H?: number };

/** The persisted document: last-visited tab and each tab's camera. */
export type CameraStore = { tab: string; cams: Record<string, Camera> };

/** World bounds of a view (matches WorldSize in views/Views.tsx). */
export type WorldSize = { W: number; H: number };

/** The chrome-free fit box a fitted opening targets. */
export type ViewBox = { x: number; y: number; w: number; h: number };

/** A resolved opening transform: `restored` is true when a valid saved
 * camera was reused, false when the fitted default ran. */
export type OpeningTransform = { k: number; tx: number; ty: number; restored: boolean };

/**
 * The opening latch. `armed` means the auto-fit still owns the camera: it
 * re-runs whenever the world changes (the Board's world height tracks the
 * roster, and the panel's first world is its pre-measurement placeholder). The
 * first real operator interaction — pan, wheel zoom, the ⤢ Fit control, or a
 * treemap focus — disarms it, and once disarmed it never re-arms, so a later
 * roster change cannot yank the camera out from under the operator.
 */
export type OpeningLatch = { armed: boolean };

export const ARMED_LATCH: OpeningLatch = { armed: true };

/** Disarm the opening latch; idempotent, and never re-arms. */
export function disarm(latch: OpeningLatch): OpeningLatch {
  return latch.armed ? { armed: false } : latch;
}

export const CAMERA_STORE_KEY = "activity-overview:camera";

export const DEFAULT_CAMERA_STORE: CameraStore = { tab: "board", cams: {} };

const isCamera = (v: unknown): v is Camera =>
  typeof v === "object" &&
  v !== null &&
  Number.isFinite((v as Camera).k) &&
  Number.isFinite((v as Camera).tx) &&
  Number.isFinite((v as Camera).ty);

/** A stored camera is only usable when it carries finite world dims; an
 * unstamped or half-stamped entry has no world to validate against, so it is
 * rejected at decode rather than restored blind. */
const isStampedCamera = (v: unknown): v is Camera =>
  isCamera(v) && Number.isFinite((v as Camera).W) && Number.isFinite((v as Camera).H);

/**
 * Decode a stored value. Missing or malformed values decode to the empty
 * default frame; cameras under unknown tab ids, with missing/non-finite
 * transform fields, or without finite world dims (an unstamped legacy entry)
 * are dropped so a stale doc can never poison the canvas transform.
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
      if (isStampedCamera(src[id])) cams[id] = src[id];
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

/**
 * Whether a stored camera is still valid for the live world. A camera is only
 * meaningful against the world it was captured on: when the roster changes,
 * the Board's world height changes with it, so a camera fitted for the old
 * world would restore off-fit. Require the stored dims to be present and both
 * within `tol` (a small relative band that absorbs sub-pixel and rounding
 * drift but rejects a materially different world). A camera with no dims is
 * never trusted.
 */
export function cameraMatchesWorld(
  cam: Camera,
  world: WorldSize,
  tol = 0.02,
): boolean {
  if (!Number.isFinite(cam.W) || !Number.isFinite(cam.H)) return false;
  if (!(world.W > 0) || !(world.H > 0)) return false;
  const near = (a: number, b: number) => Math.abs(a - b) <= tol * Math.max(a, b);
  return near(cam.W!, world.W) && near(cam.H!, world.H);
}

/**
 * The fitted opening transform: the whole world scaled into `box` and
 * centered, never zooming past 1× (a small world opens at 1× rather than
 * ballooning). Mirrors MapCanvas's fit() exactly, so a caller can compare a
 * restored camera against it without owning the canvas.
 */
export function fitTransform(world: WorldSize, box: ViewBox, minScale = 0.2): OpeningTransform {
  const k = Math.min(Math.max(Math.min(box.w / world.W, box.h / world.H), minScale), 1);
  return {
    k,
    tx: box.x + (box.w - world.W * k) / 2,
    ty: box.y + (box.h - world.H * k) / 2,
    restored: false,
  };
}

/**
 * The opening transform for a mount: reuse the saved camera when it still
 * matches the live world (bb forward/back keeps working), otherwise fit.
 */
export function resolveOpening(
  saved: Camera | null,
  world: WorldSize,
  box: ViewBox,
  opts: { minScale?: number; tol?: number } = {},
): OpeningTransform {
  if (saved !== null && cameraMatchesWorld(saved, world, opts.tol)) {
    return { k: saved.k, tx: saved.tx, ty: saved.ty, restored: true };
  }
  return fitTransform(world, box, opts.minScale);
}

/**
 * Advance the opening for one world report. While the latch is armed, every
 * settled world report yields an opening: a matching saved camera wins and
 * disarms the latch; otherwise the fit is (re)computed — so the placeholder
 * world the panel reports before it is measured is superseded by the settled
 * one. A null/invalid world (the panel still unmeasured) is a no-op that keeps
 * the latch armed. Once disarmed, later world changes yield no opening at all.
 */
export function reportWorld(
  latch: OpeningLatch,
  world: WorldSize | null,
  saved: Camera | null,
  box: ViewBox,
  opts: { minScale?: number; tol?: number } = {},
): { latch: OpeningLatch; opening: OpeningTransform | null } {
  if (!latch.armed) return { latch, opening: null };
  if (world === null || !(world.W > 0) || !(world.H > 0)) return { latch, opening: null };
  const opening = resolveOpening(saved, world, box, opts);
  return { latch: opening.restored ? disarm(latch) : latch, opening };
}