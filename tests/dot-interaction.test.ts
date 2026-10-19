// Interaction-gate tests for the dot-click affordance: a thread unit is only
// actionable (opens its thread) while the camera is zoomed in past a single
// named threshold; at the fitted view the unit is inert so the region/pan
// gesture stays unambiguous.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ZOOMED_IN_SCALE, dotAction, isZoomedIn } from "../views/model.ts";

test("ZOOMED_IN_SCALE is the single shared threshold (1.2)", () => {
  assert.equal(ZOOMED_IN_SCALE, 1.2);
});

test("isZoomedIn is strict: the threshold itself is not zoomed in", () => {
  assert.equal(isZoomedIn(1.0), false);
  assert.equal(isZoomedIn(0.2), false);
  assert.equal(isZoomedIn(1.19), false);
  assert.equal(isZoomedIn(ZOOMED_IN_SCALE), false); // exactly at the threshold
  assert.equal(isZoomedIn(1.2 + 1e-9), true);
  assert.equal(isZoomedIn(1.21), true);
  assert.equal(isZoomedIn(2), true);
  assert.equal(isZoomedIn(5), true);
});

test("isZoomedIn honours a custom threshold", () => {
  assert.equal(isZoomedIn(1.5, 2), false);
  assert.equal(isZoomedIn(2.5, 2), true);
  assert.equal(isZoomedIn(2, 2), false);
});

test("dotAction: open while zoomed in, inert at the fitted view", () => {
  assert.equal(dotAction(1), "inert");
  assert.equal(dotAction(ZOOMED_IN_SCALE), "inert");
  assert.equal(dotAction(1.2 + 1e-9), "open");
  assert.equal(dotAction(3), "open");
});

test("dotAction and isZoomedIn never disagree (one rule, two spellings)", () => {
  for (const k of [0.2, 0.5, 1, 1.19, 1.2, 1.21, 1.5, 2, 5]) {
    assert.equal(dotAction(k), isZoomedIn(k) ? "open" : "inert", `k=${k}`);
  }
});
