// Camera-persistence codec tests for views/camera.ts: the session-store
// document `{ tab, cams }` must survive bb forward/back as the last-visited
// tab plus a per-tab camera, and malformed stored values must drop to the
// default frame instead of leaking junk into the canvas transform.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAMERA_STORE_KEY,
  DEFAULT_CAMERA_STORE,
  mergeCameraStore,
  parseCameraStore,
} from "../views/camera.ts";

const TABS = ["board", "treemap", "tiles", "graph", "flow"] as const;

const CAM = { k: 1.5, tx: -120, ty: -40 };

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

test("a valid document keeps the tab and the known tabs' cameras", () => {
  const raw = JSON.stringify({
    tab: "flow",
    cams: { flow: CAM, board: { k: 2, tx: 0, ty: 0 } },
  });
  const store = parseCameraStore(raw, TABS);
  assert.equal(store.tab, "flow");
  assert.deepEqual(store.cams.flow, CAM);
  assert.deepEqual(store.cams.board, { k: 2, tx: 0, ty: 0 });
});

test("unknown tab ids are dropped, recognized keys survive others' junk", () => {
  const raw = JSON.stringify({
    tab: "board",
    cams: { board: CAM, nope: { k: 9, tx: 9, ty: 9 } },
  });
  const store = parseCameraStore(raw, TABS);
  assert.deepEqual(Object.keys(store.cams), ["board"]);
});

test("a camera with missing or non-finite fields is dropped", () => {
  const raw = JSON.stringify({
    tab: "board",
    cams: {
      board: { k: 1, tx: NaN, ty: 0 },
      tiles: { k: 1, tx: 0 },
      graph: null,
      flow: CAM,
    },
  });
  const store = parseCameraStore(raw, TABS);
  assert.deepEqual(store.cams, { flow: CAM });
});

test("a non-string tab falls back to the default tab", () => {
  const raw = JSON.stringify({ tab: 7, cams: {} });
  assert.equal(parseCameraStore(raw, TABS).tab, DEFAULT_CAMERA_STORE.tab);
});

test("merge patches the tab without clobbering other tabs' cameras", () => {
  const store = { tab: "board", cams: { board: CAM } };
  const merged = mergeCameraStore(store, { tab: "flow", cams: { flow: { k: 0.8, tx: 10, ty: 20 } } });
  assert.equal(merged.tab, "flow");
  assert.deepEqual(merged.cams.board, CAM);
  assert.deepEqual(merged.cams.flow, { k: 0.8, tx: 10, ty: 20 });
  // The input store is untouched (writers keep read-merge-write clean).
  assert.deepEqual(store.cams, { board: CAM });
});

test("the store key is the plugin-scoped session key", () => {
  assert.equal(CAMERA_STORE_KEY, "activity-overview:camera");
});