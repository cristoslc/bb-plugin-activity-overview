// Camera-persistence codec tests for views/camera.ts: the session-store
// document `{ tab, cams }` must survive bb forward/back as the last-visited
// tab plus a per-tab camera, and malformed stored values must drop to the
// default frame instead of leaking junk into the canvas transform.
//
// Two later rules ride on top:
//  - a camera is only meaningful against the world it was captured on, so a
//    stored entry is trusted only when it carries matching world dimensions
//    (an unstamped legacy entry is rejected outright);
//  - the opening fit auto-runs against the LATEST world while armed, so a
//    placeholder world followed by the settled one ends at the settled fit,
//    and the first real interaction stops it for good.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARMED_LATCH,
  CAMERA_STORE_KEY,
  DEFAULT_CAMERA_STORE,
  cameraMatchesWorld,
  disarm,
  fitTransform,
  mergeCameraStore,
  parseCameraStore,
  reportWorld,
  resolveOpening,
  type Camera,
} from "../views/camera.ts";

const TABS = ["board", "treemap", "tiles"] as const;

// A stamped camera: a transform plus the world it was captured against.
const CAM: Camera = { k: 1.5, tx: -120, ty: -40, W: 1064, H: 672 };

test("missing stored value decodes to the default store", () => {
  assert.deepEqual(parseCameraStore(null, TABS), DEFAULT_CAMERA_STORE);
});

test("malformed JSON decodes to the default store", () => {
  assert.deepEqual(parseCameraStore("not json", TABS), DEFAULT_CAMERA_STORE);
});

test("non-object JSON decodes to the default store", () => {
  assert.deepEqual(parseCameraStore("42", TABS), DEFAULT_CAMERA_STORE);
  assert.deepEqual(parseCameraStore('"flow"', TABS), DEFAULT_CAMERA_STORE);
});

test("a valid document keeps the tab and the known tabs' stamped cameras", () => {
  const raw = JSON.stringify({
    tab: "treemap",
    cams: { treemap: CAM, board: { k: 2, tx: 0, ty: 0, W: 1064, H: 672 } },
  });
  const store = parseCameraStore(raw, TABS);
  assert.equal(store.tab, "treemap");
  assert.deepEqual(store.cams.treemap, CAM);
  assert.deepEqual(store.cams.board, { k: 2, tx: 0, ty: 0, W: 1064, H: 672 });
});

test("unknown tab ids are dropped, recognized keys survive others' junk", () => {
  const raw = JSON.stringify({
    tab: "board",
    // Removed view ids behave like any unknown id.
    cams: { board: CAM, flow: { k: 9, tx: 9, ty: 9, W: 1, H: 1 } },
  });
  const store = parseCameraStore(raw, TABS);
  assert.deepEqual(Object.keys(store.cams), ["board"]);
});

test("a camera with missing or non-finite transform fields is dropped", () => {
  const raw = JSON.stringify({
    tab: "board",
    cams: {
      board: { k: 1, tx: NaN, ty: 0, W: 1064, H: 672 },
      tiles: { k: 1, tx: 0, W: 1064, H: 672 },
      treemap: CAM,
      flow: CAM,
    },
  });
  const store = parseCameraStore(raw, TABS);
  assert.deepEqual(store.cams, { treemap: CAM });
});

test("a non-string tab falls back to the default tab", () => {
  const raw = JSON.stringify({ tab: 7, cams: {} });
  assert.equal(parseCameraStore(raw, TABS).tab, DEFAULT_CAMERA_STORE.tab);
});

test("merge patches the tab without clobbering other tabs' cameras", () => {
  const store = { tab: "board", cams: { board: CAM } };
  const merged = mergeCameraStore(store, { tab: "tiles", cams: { tiles: { k: 0.8, tx: 10, ty: 20, W: 1064, H: 672 } } });
  assert.equal(merged.tab, "tiles");
  assert.deepEqual(merged.cams.board, CAM);
  assert.deepEqual(merged.cams.tiles, { k: 0.8, tx: 10, ty: 20, W: 1064, H: 672 });
  // The input store is untouched (writers keep read-merge-write clean).
  assert.deepEqual(store.cams, { board: CAM });
});

test("the store key is the plugin-scoped session key", () => {
  assert.equal(CAMERA_STORE_KEY, "activity-overview:camera");
});

// ---------- unstamped legacy entries are rejected at decode ----------

test("an UNSTAMPED legacy camera is dropped by the codec (the operator's store)", () => {
  // The exact session doc the operator's window holds: a Board camera written
  // before the store carried world dimensions. It must never survive decode.
  const raw = JSON.stringify({
    tab: "board",
    cams: { board: { k: 0.7795823665893271, tx: 435.2668213457076, ty: 76 } },
  });
  const store = parseCameraStore(raw, TABS);
  assert.equal(store.cams.board, undefined, "an unstamped camera must be dropped");
  assert.deepEqual(store.cams, {});
});

test("a stamped-or-nothing store: every kept camera carries finite world dims", () => {
  const raw = JSON.stringify({
    tab: "board",
    cams: {
      board: { k: 1, tx: 0, ty: 0, W: 1064, H: 672 }, // stamped: kept
      treemap: { k: 1, tx: 0, ty: 0 },               // unstamped: dropped
      tiles: { k: 1, tx: 0, ty: 0, W: null, H: 672 }, // half-stamped: dropped
    },
  });
  const store = parseCameraStore(raw, TABS);
  assert.deepEqual(Object.keys(store.cams), ["board"]);
});

// ---------- world-matching restores ----------

const WORLD = { W: 1064, H: 672 };
const BOX = { x: 28, y: 76, w: 1064, h: 672 };
const OPTS = { minScale: 0.2 };

test("cameraMatchesWorld: true only when the stored world is present and within tolerance", () => {
  const cam: Camera = { k: 1, tx: 28, ty: 76, W: 1064, H: 672 };
  assert.equal(cameraMatchesWorld(cam, WORLD), true);
  // within the tolerance band (sub-pixel / rounding drift)
  assert.equal(cameraMatchesWorld({ ...cam, H: 672 * 1.01 }, WORLD), true);
  assert.equal(cameraMatchesWorld({ ...cam, H: 672 * 0.99 }, WORLD), true);
  // materially different (the roster changed the Board's world height)
  assert.equal(cameraMatchesWorld({ ...cam, H: 862 }, WORLD), false);
  assert.equal(cameraMatchesWorld({ ...cam, W: 320 }, WORLD), false);
  // an unstamped camera can never be trusted
  assert.equal(cameraMatchesWorld({ k: 1, tx: 0, ty: 0 }, WORLD), false);
  assert.equal(cameraMatchesWorld({ k: 1, tx: 0, ty: 0, H: 672 }, WORLD), false);
});

test("resolveOpening: a MATCHING stamped camera wins; a stale or unstamped one fits", () => {
  assert.deepEqual(
    resolveOpening({ k: 2, tx: -150, ty: -80, W: 1064, H: 672 }, WORLD, BOX, OPTS),
    { k: 2, tx: -150, ty: -80, restored: true },
  );
  for (const stale of [
    { k: 0.779582, tx: 435.267, ty: 76, W: 320, H: 862 }, // wrong world
    { k: 0.779582, tx: 435.267, ty: 76 },                  // unstamped
    null,
  ] as const) {
    const out = resolveOpening(stale as Camera | null, WORLD, BOX, OPTS);
    assert.equal(out.restored, false);
    assert.equal(out.k, 1);
    assert.equal(out.tx, BOX.x);
    assert.equal(out.ty, BOX.y);
  }
});

test("fitTransform: fills the box, centers, and never zooms past 1×", () => {
  const small = fitTransform({ W: 400, H: 200 }, BOX, 0.2);
  assert.equal(small.k, 1);
  assert.equal(small.tx, BOX.x + (BOX.w - 400) / 2);
  assert.equal(small.ty, BOX.y + (BOX.h - 200) / 2);
  const big = fitTransform({ W: 2128, H: 1344 }, BOX, 0.2);
  assert.ok(Math.abs(big.k - 0.5) < 1e-9, `k ${big.k}`);
});

// ---------- the opening latch (the off-fit Board defect) ----------

test("reportWorld: the real mount sequence (placeholder world, then settled) ends at the settled fit", () => {
  // First report: the pre-measurement world the Board packs to when the panel
  // width is still MIN_STAGE_W and the height budget its floor (320x862).
  const first = reportWorld(ARMED_LATCH, { W: 320, H: 862 }, null, BOX, OPTS);
  assert.ok(first.opening !== null);
  assert.equal(first.latch.armed, true, "a fit stays armed for the settled world");
  // Second report: the settled world (1064x672) — the opening re-fits to 1x.
  const second = reportWorld(first.latch, { W: 1064, H: 672 }, null, BOX, OPTS);
  assert.ok(second.opening !== null);
  assert.equal(second.opening!.k, 1);
  assert.equal(second.opening!.tx, BOX.x);
  assert.equal(second.opening!.ty, BOX.y);
  assert.equal(second.opening!.restored, false);
  // and no further world change ever re-fits (the latch stays armed but the
  // world has settled; the end state is the settled fit)
});

test("reportWorld: a null world (panel unmeasured) is a no-op and stays armed", () => {
  const r = reportWorld(ARMED_LATCH, null, null, BOX, OPTS);
  assert.equal(r.opening, null);
  assert.equal(r.latch.armed, true);
});

test("reportWorld: after disarm, a later world change never re-fits", () => {
  const armed = reportWorld(ARMED_LATCH, WORLD, null, BOX, OPTS);
  assert.ok(armed.opening !== null);
  const stopped = disarm(armed.latch);
  assert.equal(stopped.armed, false);
  // the roster grows, the Board world changes shape — no re-fit
  const later = reportWorld(stopped, { W: 1064, H: 900 }, null, BOX, OPTS);
  assert.equal(later.opening, null);
  assert.equal(later.latch.armed, false);
});

test("reportWorld: a matching restored camera beats the default and disarms", () => {
  const saved: Camera = { k: 2, tx: -150, ty: -80, W: 1064, H: 672 };
  const r = reportWorld(ARMED_LATCH, WORLD, saved, BOX, OPTS);
  assert.ok(r.opening !== null);
  assert.equal(r.opening!.restored, true);
  assert.equal(r.opening!.k, 2);
  assert.equal(r.latch.armed, false, "a restored camera stops the auto-fit");
});

test("reportWorld: a stale or unstamped saved camera is dropped and the fit runs", () => {
  for (const saved of [
    { k: 0.779582, tx: 435.267, ty: 76 },        // unstamped legacy
    { k: 0.779582, tx: 435.267, ty: 76, W: 320, H: 862 }, // wrong world
  ] as Camera[]) {
    const r = reportWorld(ARMED_LATCH, WORLD, saved, BOX, OPTS);
    assert.ok(r.opening !== null);
    assert.equal(r.opening!.restored, false);
    assert.equal(r.opening!.k, 1);
    assert.equal(r.latch.armed, true);
  }
});

test("disarm is idempotent and never re-arms", () => {
  const once = disarm(ARMED_LATCH);
  assert.equal(disarm(once).armed, false);
  assert.equal(disarm(disarm(once)).armed, false);
});
