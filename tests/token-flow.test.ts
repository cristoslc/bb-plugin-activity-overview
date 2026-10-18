// Token flow (amplitude wave) model tests: family grouping, the burn-window
// resample, and the layout invariants the approved mockup settled.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FLOW_BUCKETS,
  TOKEN_FLOW,
  buildFamilies,
  buildRiverPaths,
  providerOfModel,
  resampleWindow,
  riverCenterPath,
  riverProfileAt,
  riverWidthAt,
  riverYAt,
  tokenFlowLayout,
  tokenFlowStatus,
  type FlowThread,
} from "../views/model.ts";

function fThread(over: Partial<FlowThread> = {}): FlowThread {
  return {
    id: over.id ?? "thr_a",
    projectId: over.projectId ?? "proj_1",
    projectName: over.projectName ?? "project-a",
    title: over.title ?? "thread a",
    status: over.status ?? "done",
    parentThreadId: over.parentThreadId ?? null,
    createdAt: over.createdAt ?? 1000,
    updatedAt: over.updatedAt ?? 1000,
    usedTokens: over.usedTokens ?? 500,
    modelContextWindow: over.modelContextWindow ?? 200_000,
    model: over.model ?? "anthropic/claude-sonnet",
    provider: over.provider ?? "anthropic",
    rate: over.rate ?? 0,
    tracked: over.tracked ?? 0,
    series: over.series ?? new Array<number>(FLOW_BUCKETS).fill(0),
  };
}

test("providerOfModel maps prefixes onto the right provider row", () => {
  for (const [model, want] of [
    ["ollama-cloud/glm-5.3-flash:cloud", "ollama"],
    ["anthropic/claude-sonnet-4", "anthropic"],
    ["claude-sonnet-4", "anthropic"],
    ["openai/gpt-5.2", "openai"],
    ["google/gemini-3-flash", "google"],
    ["gemini-3-flash", "google"],
    ["pi", "other"],
    ["deepseek/deepseek-chat", "other"],
    [null, "other"],
  ] as Array<[string | null, string]>) {
    assert.equal(providerOfModel(model), want, `model=${String(model)}`);
  }
});

test("tokenFlowStatus folds the shape statuses into five", () => {
  assert.equal(tokenFlowStatus("running"), "running");
  assert.equal(tokenFlowStatus("queued"), "waiting");
  assert.equal(tokenFlowStatus("interrupted"), "done");
  assert.equal(tokenFlowStatus("idle"), "idle");
});

test("families: children attach to their parent's family, parent first", () => {
  const parent = fThread({ id: "thr_parent" });
  const child = fThread({ id: "thr_child", parentThreadId: "thr_parent", createdAt: 2000 });
  const child2 = fThread({ id: "thr_child2", parentThreadId: "thr_parent", createdAt: 3000 });
  const fams = buildFamilies([child2, child, parent]);
  assert.equal(fams.length, 1);
  assert.deepEqual(
    fams[0]!.threads.map((t) => t.id),
    ["thr_parent", "thr_child", "thr_child2"],
  );
});

test("families: a child whose parent left the roster stands alone", () => {
  const orphan = fThread({ id: "thr_orphan", parentThreadId: "thr_gone" });
  const fams = buildFamilies([orphan]);
  assert.equal(fams.length, 1);
  assert.equal(fams[0]!.threads[0]!.id, "thr_orphan");
});

test("resampleWindow buckets positive growth into equal wall-clock intervals", () => {
  const now = 1_000_000;
  const windowMs = 60_000;
  // Growth of 1000 spread across the newest tenth of the window (newest bucket).
  const samples = [
    { at: now - windowMs, used: 0 },
    { at: now - windowMs * 0.05, used: 1000 },
  ];
  const out = resampleWindow(samples, now, windowMs, FLOW_BUCKETS);
  assert.equal(out.length, FLOW_BUCKETS);
  assert.equal(out.reduce((s, v) => s + v, 0), 1000, "all growth is attributed");
  assert.ok(out[FLOW_BUCKETS - 1]! > 0, "newest bucket carries the fresh growth");
  assert.equal(out[0], 0, "oldest bucket is empty");
});

test("resampleWindow ignores negative (context-shedding) deltas and pre-window samples", () => {
  const now = 1_000_000;
  const windowMs = 60_000;
  const samples = [
    { at: now - windowMs * 2, used: 4000 }, // fully before the window
    { at: now - windowMs * 1.5, used: 6000 },
    { at: now - windowMs * 1.2, used: 5000 }, // a drop — not growth
    { at: now - windowMs * 0.5, used: 5500 }, // +500 inside the window
  ];
  const out = resampleWindow(samples, now, windowMs, FLOW_BUCKETS);
  assert.equal(out.reduce((s, v) => s + v, 0), 500, "only the positive in-window growth counts");
});

test("resampleWindow: too few samples yields an all-zero series", () => {
  const out = resampleWindow([], 1000, 60_000, FLOW_BUCKETS);
  assert.equal(out.length, FLOW_BUCKETS);
  assert.ok(out.every((v) => v === 0));
});

test("layout: provider slots are token-scaled; project boxes span their cards", () => {
  const threads = [
    fThread({ id: "t1", usedTokens: 1000 }),
    fThread({ id: "t2", usedTokens: 2000, model: "openai/gpt-5.2", provider: "openai" }),
    fThread({ id: "t3", usedTokens: 500, parentThreadId: "t1", model: "ollama/m", provider: "ollama" }),
  ];
  const l = tokenFlowLayout(threads);
  assert.ok(l.scale > 0);
  // Provider slots carry the shared token scale: Σ ≈ total·scale.
  const provSum = l.providers.reduce((s, p) => s + p.slots.reduce((x, sl) => x + sl.h, 0), 0);
  const expected = 3500 * l.scale;
  assert.ok(Math.abs(provSum - expected) < 8, `Σ slots ${provSum} ≈ ${expected}`);
  assert.equal(l.rivers.length, 3, "one river per burning thread");
  // Project boxes sit inside the frame and cover at least their cards' span.
  for (const p of l.projects) {
    assert.ok(p.h > 0);
    assert.ok(p.y >= TOKEN_FLOW.TOP - 0.001);
    assert.ok(p.y + p.h <= l.H - TOKEN_FLOW.BOTTOM + 0.001);
  }
});

test("layout: the biggest spender's candle is the 200px design constant", () => {
  const threads = [
    fThread({ id: "big", usedTokens: 100_000 }),
    fThread({ id: "small", usedTokens: 1000 }),
  ];
  const l = tokenFlowLayout(threads);
  const big = l.cards.find((c) => c.thread.id === "big")!;
  assert.ok(Math.abs(big.candleH - TOKEN_FLOW.TOTAL_PX) < 0.5, `candle ${big.candleH}`);
});

test("layout: a project's candle run equals its middle bar's height", () => {
  const threads = [
    fThread({ id: "a1", usedTokens: 4000, projectId: "p1", projectName: "alpha" }),
    fThread({ id: "a2", usedTokens: 900, projectId: "p1", projectName: "alpha", createdAt: 1500 }),
    fThread({ id: "b1", usedTokens: 2500, projectId: "p2", projectName: "beta" }),
  ];
  const l = tokenFlowLayout(threads);
  for (const p of l.projects) {
    const members = l.cards.filter((c) => c.thread.projectId === p.id);
    const tops = members.map((c) => c.candleY);
    const bots = members.map((c) => c.candleY + c.candleH);
    const run = Math.max(...bots) - Math.min(...tops);
    assert.ok(
      Math.abs(run - p.h) < 1.5,
      `${p.label}: candle run ${run} mirrors bar ${p.h}`,
    );
  }
});

test("layout: cards cluster by project, in project order (rivers stay uncrossed)", () => {
  const threads = [
    fThread({ id: "b1", projectId: "p2", projectName: "beta" }),
    fThread({ id: "a1", projectId: "p1", projectName: "alpha" }),
    fThread({ id: "c1", projectId: "p3", projectName: "gamma" }),
  ];
  const l = tokenFlowLayout(threads);
  assert.deepEqual(
    l.clusters.map((c) => c.name),
    ["alpha", "beta", "gamma"],
    "clusters are alphabetical like the middle column",
  );
  // Cluster captions descend down the rail (top → bottom).
  const ys = l.clusters.map((c) => c.captionY);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! > ys[i - 1]!, "clusters stack top→bottom");
});

test("layout: the selected family's rows grow; others keep the base row height", () => {
  const threads = [
    fThread({ id: "p", usedTokens: 100, projectId: "p1", projectName: "alpha" }),
    fThread({ id: "c", usedTokens: 100, parentThreadId: "p", projectId: "p1", projectName: "alpha" }),
    fThread({ id: "x", usedTokens: 100, projectId: "p2", projectName: "beta" }),
  ];
  const rest = tokenFlowLayout(threads);
  const grown = tokenFlowLayout(threads, { selected: "p", mix: 1 });
  const famP0 = rest.families.find((f) => f.key === "p")!;
  const famP1 = grown.families.find((f) => f.key === "p")!;
  assert.ok(famP1.zoneH > famP0.zoneH, "the selected family's zone grew");
  const famX0 = rest.families.find((f) => f.key === "x")!;
  const famX1 = grown.families.find((f) => f.key === "x")!;
  assert.equal(famX1.zoneH, famX0.zoneH, "unselected families do not move");
});

test("layout: rivers land on their card row's mid; candles sit in the row", () => {
  const threads = [fThread({ id: "t1", usedTokens: 800 }), fThread({ id: "t0", usedTokens: 0 })];
  const l = tokenFlowLayout(threads);
  assert.equal(l.rivers.length, 1, "only the burning thread has a river");
  const r = l.rivers[0]!;
  const card = l.cards.find((c) => c.thread.id === "t1")!;
  assert.ok(Math.abs(r.q3.y - card.candleMid) < 0.5, "the tail lands on the card row's mid");
  assert.equal(r.p0.x, TOKEN_FLOW.PX + TOKEN_FLOW.PW);
  assert.equal(r.p3.x, TOKEN_FLOW.JX);
  const zero = l.cards.find((c) => c.thread.id === "t0")!;
  assert.equal(zero.burn, false);
  assert.equal(zero.candleH, zero.h, "a zero row carries a full-slot grey bar");
});

test("A encoding: the band width is the per-interval burn profile", () => {
  const series = new Array<number>(FLOW_BUCKETS).fill(0);
  series[FLOW_BUCKETS - 1] = 100; // burning now
  const threads = [fThread({ id: "t1", usedTokens: 1000, series })];
  const l = tokenFlowLayout(threads);
  const r = l.rivers[0]!;
  const midX = (r.p0.x + r.q3.x) / 2;
  // At mid-span the profile is quiet (only the newest bucket burns); at the
  // tail it is at full bucket width.
  const quiet = riverWidthAt(r, midX, l.bucketScale, "A");
  const tail = riverProfileAt(r, r.q3.x, l.bucketScale);
  assert.ok(tail > quiet, `tail ${tail} > mid ${quiet}`);
  // B/C ignore the profile entirely: the totals width everywhere.
  assert.ok(Math.abs(riverWidthAt(r, midX, l.bucketScale, "B") - r.w) < 0.001);
  assert.ok(Math.abs(riverWidthAt(r, r.q3.x, l.bucketScale, "C") - r.w) < 0.001);
});

test("river paths are finite and the crest follows the encoding", () => {
  const series = Array.from({ length: FLOW_BUCKETS }, (_, i) => (i + 1) * 5);
  const threads = [fThread({ id: "t1", usedTokens: 2000, series })];
  const l = tokenFlowLayout(threads);
  const r = l.rivers[0]!;
  for (const enc of ["A", "B", "C"] as const) {
    const p = buildRiverPaths(r, l.bucketScale, enc);
    assert.ok(!p.bandD.includes("NaN") && !p.bandD.includes("undefined"));
    assert.ok(p.crestD === null || !p.crestD.includes("NaN"));
  }
  // A draws the profile edge; C draws the inner crest; B's band is flat.
  assert.ok(buildRiverPaths(r, l.bucketScale, "A").crestD !== null);
  assert.ok(buildRiverPaths(r, l.bucketScale, "C").crestD !== null);
  assert.equal(buildRiverPaths(r, l.bucketScale, "B").crestD, null);
  assert.ok(!riverCenterPath(r).includes("NaN"));
  assert.ok(Number.isFinite(riverYAt(r, (r.p0.x + r.q3.x) / 2)));
});

test("layout is deterministic across input order", () => {
  const threads = [
    fThread({ id: "t1", usedTokens: 900 }),
    fThread({ id: "t2", usedTokens: 300, model: "google/gemini", provider: "google" }),
  ];
  const a = JSON.stringify(tokenFlowLayout(threads));
  const b = JSON.stringify(tokenFlowLayout([...threads].reverse()));
  assert.equal(a, b);
});

test("layout: an all-idle roster keeps finite zero geometry", () => {
  const threads = Array.from({ length: 8 }, (_, i) => fThread({ id: `t${i}`, usedTokens: 0 }));
  const l = tokenFlowLayout(threads);
  assert.equal(l.rivers.length, 0);
  assert.ok(Number.isFinite(l.H) && l.H >= TOKEN_FLOW.H_MIN);
  for (const c of l.cards) {
    assert.ok(Number.isFinite(c.candleY) && Number.isFinite(c.candleH));
    assert.equal(c.burn, false);
    assert.equal(c.candleH, c.h);
  }
});
