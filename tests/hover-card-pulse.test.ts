// Hover-card + burn-rate pulse contracts.
//
// Two behaviors live here:
//  1. A status dot's hover card needs the thread's full title and an honest
//     end-of-conversation snippet, so the snippet picker is a pure function of
//     the conversation outline and says "nothing" instead of guessing.
//  2. A working dot's pulse period tracks its measured token burn: 10× the
//     tokens means 10× the pulses. Unmeasured and zero burn are DIFFERENT
//     states and neither may read as "infinitely fast" or "frozen".
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PULSE_BASE_PERIOD_MS,
  PULSE_MAX_PERIOD_MS,
  PULSE_MIN_PERIOD_MS,
  PULSE_REFERENCE_RATE,
  burnRate,
  endSnippet,
  hoverCardPlacement,
  pulsePeriodMs,
  threadTitle,
  type FlowSample,
} from "../views/model.ts";

// ---------- pulse rate ----------

test("an unmeasured thread keeps the pre-existing base pulse (no fabricated rate)", () => {
  assert.equal(pulsePeriodMs(null), PULSE_BASE_PERIOD_MS);
});

test("pulse period is inversely proportional to burn: 10× tokens is 10× the pulses", () => {
  // The two rates span the legible band, where the inversion holds exactly.
  const fastRate = PULSE_REFERENCE_RATE; // the slowest in-band pulse
  const fasterRate = PULSE_REFERENCE_RATE * 10; // the fastest in-band pulse
  const fast = pulsePeriodMs(fastRate)!;
  const faster = pulsePeriodMs(fasterRate)!;
  assert.ok(faster < fast, "more tokens must pulse faster");
  assert.ok(Math.abs(fast / faster - 10) < 1e-9, `expected 10×, got ${fast / faster}`);
});

test("the reference rate pulses at the pre-existing base period", () => {
  assert.equal(pulsePeriodMs(PULSE_REFERENCE_RATE), PULSE_BASE_PERIOD_MS);
});

test("a measured zero burn holds the slowest legible pulse, never infinity or freeze", () => {
  assert.equal(pulsePeriodMs(0), PULSE_MAX_PERIOD_MS);
  assert.ok(Number.isFinite(pulsePeriodMs(0)));
  // Slower than any measured nonzero rate inside the band.
  assert.ok(pulsePeriodMs(0)! >= pulsePeriodMs(1e-9)!);
});

test("the period is clamped to a legible band at both extremes", () => {
  assert.equal(pulsePeriodMs(1e9), PULSE_MIN_PERIOD_MS);
  assert.equal(pulsePeriodMs(1e-9), PULSE_MAX_PERIOD_MS);
  // Never a strobe, never slower than the ceiling.
  for (const rate of [0, 1e-9, 0.5, 2, 20, 1e6, 1e9]) {
    const period = pulsePeriodMs(rate)!;
    assert.ok(period >= PULSE_MIN_PERIOD_MS, `rate=${rate} period=${period}`);
    assert.ok(period <= PULSE_MAX_PERIOD_MS, `rate=${rate} period=${period}`);
  }
});

test("a non-finite rate is rejected loudly rather than silently coerced", () => {
  assert.throws(() => pulsePeriodMs(Number.NaN), /rate/);
  assert.throws(() => pulsePeriodMs(Number.POSITIVE_INFINITY), /rate/);
  assert.throws(() => pulsePeriodMs(Number.NEGATIVE_INFINITY), /rate/);
});

test("burnRate reports null until two readings exist, then the measured growth", () => {
  const now = 1_000_000;
  assert.equal(burnRate([], now, 60_000), null);
  assert.equal(burnRate([{ at: now - 5_000, used: 100 }], now, 60_000), null);

  // Two readings 10s apart with 500 more tokens: 50 tok/s.
  const samples: FlowSample[] = [
    { at: now - 10_000, used: 100 },
    { at: now - 0, used: 600 },
  ];
  assert.equal(burnRate(samples, now, 60_000), 50);
});

test("burnRate treats a flat ring as a measured zero, not as unknown", () => {
  const now = 2_000_000;
  const flat: FlowSample[] = [
    { at: now - 20_000, used: 900 },
    { at: now - 10_000, used: 900 },
  ];
  assert.equal(burnRate(flat, now, 60_000), 0);
});

test("burnRate ignores readings older than the window and negative growth", () => {
  const now = 3_000_000;
  const samples: FlowSample[] = [
    { at: now - 120_000, used: 0 }, // outside the 60s window
    { at: now - 30_000, used: 5_000 },
    { at: now - 20_000, used: 4_000 }, // context shrank (compaction): not negative burn
    { at: now - 10_000, used: 6_000 },
  ];
  // Fresh positive growth only: 2000 tokens, over the 20s the two surviving
  // positive readings span (t=-30s to t=-10s). 2000 / 20s = 100 tok/s.
  assert.equal(burnRate(samples, now, 60_000), 100);
});

// ---------- end snippet ----------

test("the end snippet is the newest message, whichever side spoke last", () => {
  const items = [
    { role: "user" as const, preview: "start here" },
    { role: "assistant" as const, preview: "working on it" },
    { role: "user" as const, preview: "now also do the other thing" },
  ];
  assert.deepEqual(endSnippet(items), {
    role: "user",
    text: "now also do the other thing",
  });
});

test("the end snippet flattens whitespace and caps long text with an ellipsis", () => {
  const long = `line one\n\n  line two   ${"x".repeat(400)}`;
  const snippet = endSnippet([{ role: "assistant", preview: long }], 60);
  assert.ok(snippet !== null);
  assert.ok(!snippet.text.includes("\n"));
  assert.ok(snippet.text.length <= 60, `length ${snippet.text.length}`);
  assert.ok(snippet.text.endsWith("…"));
});

test("blank trailing messages are skipped rather than shown as empty", () => {
  const items = [
    { role: "assistant" as const, preview: "the real last words" },
    { role: "user" as const, preview: "   \n  " },
  ];
  assert.deepEqual(endSnippet(items), { role: "assistant", text: "the real last words" });
});

test("no usable history yields null — the card says nothing instead of guessing", () => {
  assert.equal(endSnippet([]), null);
  assert.equal(endSnippet([{ role: "assistant", preview: "   " }]), null);
});

// ---------- thread title ----------

test("the card shows the full title, falling back to the host's fallback then the id", () => {
  assert.equal(threadTitle({ title: "A real title", titleFallback: "fallback", id: "thr_1" }), "A real title");
  assert.equal(threadTitle({ title: null, titleFallback: "Housekeeping", id: "thr_1" }), "Housekeeping");
  assert.equal(threadTitle({ title: null, titleFallback: null, id: "thr_1" }), "thr_1");
  // Untrimmed data must not leak newlines into the card's heading.
  assert.equal(threadTitle({ title: "  two\nlines ", titleFallback: null, id: "thr_1" }), "two lines");
});

// ---------- card placement ----------

test("the card sits above its dot when there is room", () => {
  const p = hoverCardPlacement(
    { x: 400, y: 300, w: 8, h: 8 },
    { w: 260, h: 100 },
    { w: 800, h: 600 },
  );
  assert.equal(p.side, "above");
  assert.ok(p.top + 100 <= 300, "card must clear the dot");
});

test("the card flips below a dot near the top and still clears it", () => {
  const p = hoverCardPlacement(
    { x: 400, y: 6, w: 8, h: 8 },
    { w: 260, h: 100 },
    { w: 800, h: 600 },
  );
  assert.equal(p.side, "below");
  assert.ok(p.top >= 6 + 8, "card must not cover the dot");
});

test("the card is clamped inside the panel at both horizontal edges", () => {
  const left = hoverCardPlacement(
    { x: 0, y: 300, w: 8, h: 8 },
    { w: 260, h: 100 },
    { w: 800, h: 600 },
  );
  assert.ok(left.left >= 0);
  const right = hoverCardPlacement(
    { x: 796, y: 300, w: 8, h: 8 },
    { w: 260, h: 100 },
    { w: 800, h: 600 },
  );
  assert.ok(right.left + 260 <= 800, `right edge ${right.left + 260}`);
});

test("a dot under a card taller than the panel still gets a finite, in-panel card", () => {
  const p = hoverCardPlacement(
    { x: 100, y: 100, w: 8, h: 8 },
    { w: 260, h: 900 },
    { w: 800, h: 600 },
  );
  assert.ok(Number.isFinite(p.left) && Number.isFinite(p.top));
  assert.ok(p.top >= 0);
});
