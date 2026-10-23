// Token flow (swimlane) model tests: the four-lane fold, the contained
// subtree (parent → child → grandchild, hard-capped), the project stack, and
// the layout invariants the approved swimlane mockup settled.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FLOW_BUCKETS,
  SWIMLANE,
  SWIMLANES,
  bandW,
  buildForest,
  cardHeight,
  cardPaintOrder,
  laneOf,
  providerOfModel,
  resampleWindow,
  riverBeadPath,
  riverEdgePath,
  riverOpacity,
  riverPaintOrder,
  riverPath,
  subtreeFlow,
  subtreeRate,
  swimlaneLayout,
  tokenFlowStatus,
  type FlowNode,
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

test("laneOf folds the statuses into the four lanes, Needs You absorbing error", () => {
  assert.equal(laneOf("running"), "working");
  for (const s of ["waiting", "queued", "error"]) {
    assert.equal(laneOf(s), "needs-you", `status=${s}`);
  }
  for (const s of ["done", "interrupted"]) assert.equal(laneOf(s), "unread", `status=${s}`);
  assert.equal(laneOf("idle"), "idle");
  assert.equal(laneOf("something-unknown"), "idle");
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

test("forest: children attach to their parent; a parentless thread stands alone", () => {
  const parent = fThread({ id: "p" });
  const child = fThread({ id: "c", parentThreadId: "p", createdAt: 2000 });
  const grand = fThread({ id: "g", parentThreadId: "c", createdAt: 3000 });
  const orphan = fThread({ id: "o", parentThreadId: "gone" });
  const forest = buildForest([grand, child, orphan, parent]);
  assert.equal(forest.length, 2, "parent and orphan are both roots");
  const p = forest.find((n) => n.thread.id === "p")!;
  assert.equal(p.kids.length, 1);
  assert.equal(p.kids[0]!.thread.id, "c");
  assert.equal(p.kids[0]!.kids[0]!.thread.id, "g");
  const o = forest.find((n) => n.thread.id === "o")!;
  assert.equal(o.kids.length, 0, "an orphan is a root, not a lost child");
});

test("subtree sums: flow and rate cover own + every descendant", () => {
  const forest = buildForest([
    fThread({ id: "p", usedTokens: 100, rate: 10 }),
    fThread({ id: "c", parentThreadId: "p", usedTokens: 50, rate: 4 }),
    fThread({ id: "g", parentThreadId: "c", usedTokens: 25, rate: 2 }),
  ]);
  const p = forest[0]!;
  assert.equal(subtreeFlow(p), 175);
  assert.equal(subtreeRate(p), 16);
});

test("cardHeight: grows with open children and hard-caps at the grandchild", () => {
  const chain = [
    fThread({ id: "p" }),
    fThread({ id: "c", parentThreadId: "p" }),
    fThread({ id: "g", parentThreadId: "c" }),
    fThread({ id: "gg", parentThreadId: "g" }),
  ];
  const p = buildForest(chain)[0]!;
  // Collapsed: a card is one header.
  assert.equal(cardHeight(p, new Set()), SWIMLANE.THREAD_H);
  // Fully open: p -> c -> g (gg is beyond the cap at depth 3).
  const open = new Set(["p", "c", "g", "gg"]);
  const want = SWIMLANE.THREAD_H * 3 + SWIMLANE.SUB_GAP * 2;
  assert.equal(cardHeight(p, open), want, "the great-grandchild is not rendered");
});

test("rarity-independent: bandW and riverOpacity stay in the approved ranges", () => {
  assert.ok(bandW(0, 1000) >= 2 && bandW(0, 1000) <= 3);
  assert.ok(bandW(1000, 1000) > bandW(10, 1000), "a hotter river is a wider band");
  assert.ok(bandW(1000, 1000) > 10, "the busiest river is a band, not a hairline cap");
  for (const [rate, max] of [[0, 0], [0, 100], [50, 100], [100, 100], [5000, 100]] as const) {
    const o = riverOpacity(rate, max);
    assert.ok(o >= 0.3 - 1e-9 && o <= 0.8 + 1e-9, `opacity ${o} for rate=${rate}/${max}`);
  }
});

test("links: the provider→project rivers are bands sized by each provider's flow", () => {
  const threads = [
    fThread({ id: "a1", projectId: "pa", projectName: "Alpha", status: "running", usedTokens: 100_000, rate: 500, provider: "anthropic" }),
    fThread({ id: "a2", projectId: "pa", projectName: "Alpha", status: "running", usedTokens: 60_000, rate: 300, provider: "openai" }),
    fThread({ id: "b1", projectId: "pb", projectName: "Beta", status: "idle", usedTokens: 400, rate: 0, provider: "anthropic" }),
  ];
  const l = swimlaneLayout(threads, { width: 1860 });
  assert.equal(l.links.length, 3, "one river per provider per project");
  const anthropicAlpha = l.links.find((k) => k.id === "link:pa:anthropic")!;
  const openaiAlpha = l.links.find((k) => k.id === "link:pa:openai")!;
  const beta = l.links.find((k) => k.id === "link:pb:anthropic")!;
  // The band carries that provider's flow in that project, same rule as a card
  // river — so the provider segment and the card segment read as one river.
  assert.equal(anthropicAlpha.flow, 100_000);
  assert.equal(openaiAlpha.flow, 60_000);
  assert.equal(anthropicAlpha.w, bandW(100_000, 100_000));
  assert.ok(anthropicAlpha.w > 10, `the busiest provider river is a band (${anthropicAlpha.w})`);
  assert.ok(anthropicAlpha.w > openaiAlpha.w, "a bigger flow is a wider band");
  assert.ok(anthropicAlpha.w > beta.w, "the hot project's river beats the quiet one");
  // Both ends of the segment are the spine's edge and the row's left edge.
  assert.equal(anthropicAlpha.x1, SWIMLANE.SPINE_X + SWIMLANE.SPINE_W);
  assert.equal(anthropicAlpha.x2, SWIMLANE.ROW_X + 4);
  // Live providers carry activity for the beads; a quiet one stays dim.
  assert.ok(anthropicAlpha.rate > 0 && openaiAlpha.rate > 0);
  assert.equal(beta.rate, 0);
  assert.ok(beta.opacity < anthropicAlpha.opacity, "a quiet project's river is dimmer");
  for (const k of l.links) {
    assert.ok(k.opacity >= 0.3 - 1e-9 && k.opacity <= 0.8 + 1e-9, `link opacity ${k.opacity}`);
  }
});

// ---------- layout invariants ----------

/** A roster with three projects, a nested chain, and every lane populated. */
function roster(): FlowThread[] {
  return [
    fThread({ id: "act-parent", projectId: "pa", projectName: "activity", title: "sankey diagram for PRs", status: "running", usedTokens: 24600, rate: 264, provider: "anthropic" }),
    fThread({ id: "act-child", projectId: "pa", projectName: "activity", title: "layout regression sweep", status: "running", usedTokens: 11400, rate: 172, parentThreadId: "act-parent", createdAt: 2000, provider: "anthropic" }),
    fThread({ id: "act-grand", projectId: "pa", projectName: "activity", title: "pixel snapshot pass", status: "running", usedTokens: 5200, rate: 60, parentThreadId: "act-child", createdAt: 3000, provider: "google" }),
    fThread({ id: "act-error", projectId: "pa", projectName: "activity", title: "visual-check driver", status: "error", usedTokens: 31500, provider: "google" }),
    fThread({ id: "act-done", projectId: "pa", projectName: "activity", title: "treemap label layer", status: "done", usedTokens: 12400, provider: "anthropic" }),
    fThread({ id: "act-idle", projectId: "pa", projectName: "activity", title: "legend chips", status: "idle", usedTokens: 3100, provider: "openai" }),
    fThread({ id: "foc-run", projectId: "pf", projectName: "focus-board", title: "parent-thread view", status: "running", usedTokens: 38200, rate: 150, provider: "openai" }),
    fThread({ id: "foc-wait", projectId: "pf", projectName: "focus-board", title: "card tween", status: "waiting", usedTokens: 9600, provider: "anthropic" }),
    fThread({ id: "cov-idle", projectId: "pc", projectName: "cove", title: "vault rotation cron", status: "idle", usedTokens: 5100, provider: "google" }),
  ];
}

test("stack: projects pile vertically, one full-width row each, never tiled", () => {
  const l = swimlaneLayout(roster(), { width: 1860 });
  assert.equal(l.rows.length, 3, "one row per project");
  // Rows descend and never overlap; every row spans the same full width.
  for (let i = 1; i < l.rows.length; i++) {
    const prev = l.rows[i - 1]!;
    const cur = l.rows[i]!;
    assert.ok(cur.y >= prev.y + prev.h, "rows stack without overlap");
  }
  for (const r of l.rows) {
    assert.equal(r.w, 1860 - SWIMLANE.ROW_X - SWIMLANE.ROW_R, "a row is the wide landscape width");
  }
  assert.ok(l.H >= l.rows[l.rows.length - 1]!.y + l.rows[l.rows.length - 1]!.h);
  // The hottest project (activity: 38200+... vs focus-board) leads the stack.
  assert.equal(l.rows[0]!.name, "activity");
});

test("tiers tile: an expanded row carries four lanes left-to-right with a gutter", () => {
  const l = swimlaneLayout(roster(), { width: 1860, openProjects: new Set(["pa"]) });
  const row = l.rows.find((r) => r.id === "pa")!;
  assert.equal(row.expanded, true);
  assert.deepEqual(row.lanes.map((ln) => ln.id), ["working", "needs-you", "unread", "idle"]);
  for (let i = 0; i < row.lanes.length; i++) {
    const ln = row.lanes[i]!;
    assert.ok(ln.x >= SWIMLANE.ROW_X, "a lane sits inside the row");
    assert.ok(ln.x + ln.w <= 1860 - SWIMLANE.ROW_R + 1e-6, "a lane never spills past the row");
    assert.equal(ln.y + ln.h, row.y + SWIMLANE.EXP_HDR + 12 + SWIMLANE.LANE_H, "lanes share the row's lane band");
    if (i) {
      const prev = row.lanes[i - 1]!;
      assert.ok(Math.abs(ln.x - (prev.x + prev.w + SWIMLANE.LANE_GAP)) < 1e-6, "a gutter separates the lanes");
    }
  }
  // Collapsed rows carry no lanes at all.
  for (const r of l.rows.filter((r) => r.id !== "pa")) assert.equal(r.lanes.length, 0);
});

test("rivers: only the Working lane has them, all from the one project mouth", () => {
  const l = swimlaneLayout(roster(), { width: 1860, openProjects: new Set(["pa"]) });
  const row = l.rows.find((r) => r.id === "pa")!;
  const working = row.lanes.find((ln) => ln.id === "working")!;
  assert.ok(working.mouth !== null, "the working lane has one mouth");
  assert.ok(working.rivers.length > 0);
  for (const ln of row.lanes.filter((ln) => ln.id !== "working")) {
    assert.equal(ln.mouth, null, `${ln.id} has no mouth`);
    assert.equal(ln.rivers.length, 0, `${ln.id} carries no rivers`);
  }
  // Every river — parent, child, grandchild alike — leaves the same one dot.
  for (const rv of working.rivers) {
    assert.equal(rv.mouthX, working.mouth!.x);
    assert.equal(rv.mouthY, working.mouth!.y);
  }
  // Each river lands on its own card, 16px below the card top.
  const byId = new Map(working.cards.map((c) => [c.id, c] as const));
  for (const rv of working.rivers) {
    const card = byId.get(rv.cardId)!;
    assert.equal(rv.cardX, card.x);
    assert.equal(rv.cardY, card.y + 16);
    assert.ok(rv.opacity >= 0.3 - 1e-9 && rv.opacity <= 0.8 + 1e-9, "river opacity stays 0.3..0.8");
  }
});

test("collapse vs expand: a group head shows the subtree sum, then its own flow", () => {
  const collapsed = swimlaneLayout(roster(), { width: 1860, openProjects: new Set(["pa"]) });
  const rowC = collapsed.rows.find((r) => r.id === "pa")!;
  const cardC = rowC.lanes.find((ln) => ln.id === "working")!.cards.find((c) => c.id === "act-parent")!;
  // act-parent + child (11400+172) + grand (5200+60): the collapse carries Σ.
  assert.equal(cardC.flow, 24600 + 11400 + 5200, "the bar/total always show the subtree sum");
  assert.equal(cardC.shownRate, 264 + 172 + 60, "collapsed: the river carries the subtree rate");
  assert.equal(cardC.hasGroup, true);
  assert.equal(cardC.open, false);

  const expanded = swimlaneLayout(roster(), {
    width: 1860,
    openProjects: new Set(["pa"]),
    openThreads: new Set(["act-parent"]),
  });
  const cardE = expanded.rows
    .find((r) => r.id === "pa")!
    .lanes.find((ln) => ln.id === "working")!
    .cards.find((c) => c.id === "act-parent")!;
  assert.equal(cardE.open, true);
  assert.equal(cardE.shownRate, 264, "expanded: the river drops to its own flow");
  assert.equal(cardE.flow, 24600 + 11400 + 5200, "the total stays the subtree sum");
});

test("nesting: a grandchild is placed, a great-grandchild is not (hard cap)", () => {
  const l = swimlaneLayout(roster(), {
    width: 1860,
    openProjects: new Set(["pa"]),
    openThreads: new Set(["act-parent", "act-child"]),
  });
  const cards = l.rows.find((r) => r.id === "pa")!.lanes.find((ln) => ln.id === "working")!.cards;
  const byId = new Map(cards.map((c) => [c.id, c] as const));
  assert.equal(byId.get("act-child")!.depth, 1);
  assert.equal(byId.get("act-grand")!.depth, 2);
  const grand = byId.get("act-grand")!;
  assert.equal(grand.canOpen, false, "a grandchild never opens its own children");
  // A contained child is indented inside its parent's card.
  assert.ok(byId.get("act-child")!.x > byId.get("act-parent")!.x, "the child is indented");
});

test("nesting: a contained child sits below its parent and stays inside its box", () => {
  // A deliberately narrow world, so the adaptive indent is exercised too.
  const l = swimlaneLayout(roster(), {
    width: 1280,
    openProjects: new Set(["pa"]),
    openThreads: new Set(["act-parent", "act-child"]),
  });
  const byId = new Map(
    l.rows
      .find((r) => r.id === "pa")!
      .lanes.find((ln) => ln.id === "working")!
      .cards.map((c) => [c.id, c] as const),
  );
  const parent = byId.get("act-parent")!;
  const child = byId.get("act-child")!;
  const grand = byId.get("act-grand")!;
  assert.ok(child.y >= parent.y + SWIMLANE.THREAD_H - 0.001, "the child starts below the parent's header");
  assert.ok(parent.y + parent.h >= child.y + child.h - 0.001, "the child fits inside the parent's block");
  assert.ok(child.x > parent.x && child.x + child.w <= parent.x + parent.w + 0.001, "the child is indented inside the parent's width");
  assert.ok(grand.y >= child.y + SWIMLANE.THREAD_H - 0.001, "the grandchild starts below the child's header");
  assert.ok(child.y + child.h >= grand.y + grand.h - 0.001, "the grandchild fits inside the child's block");
});

test("promotion: a running child under a non-working parent shows up in the Working lane", () => {
  const threads = [
    fThread({ id: "p", status: "done", usedTokens: 1000 }),
    fThread({ id: "c", status: "running", usedTokens: 5000, rate: 30, parentThreadId: "p", createdAt: 2000 }),
  ];
  const l = swimlaneLayout(threads, { width: 1860, openProjects: new Set(["proj_1"]) });
  const row = l.rows[0]!;
  assert.equal(row.working, 1, "the collapsed-row count sees the running child");
  const working = row.lanes.find((ln) => ln.id === "working")!;
  assert.equal(working.count, 1, "the lane header count matches the row count");
  const top = working.cards.filter((c) => c.depth === 0);
  assert.equal(top.length, 1, "the running child is a top-level card in Working");
  assert.equal(top[0]!.id, "c");
  assert.equal(top[0]!.lane, "working");
  assert.ok(
    working.rivers.some((r) => r.cardId === "c" && r.rate > 0),
    "and it draws a river that can animate",
  );
  // The non-running parent must not claim it: one thread is one card.
  const parentCard = row.lanes.find((ln) => ln.id === "unread")!.cards.find((c) => c.id === "p")!;
  assert.equal(parentCard.kidCount, 0, "the parent does not contain the promoted child");
  assert.equal(parentCard.canOpen, false);
});

test("promotion: a same-lane child still stays nested inside its parent", () => {
  const threads = [
    fThread({ id: "p", status: "running", usedTokens: 1000, rate: 10 }),
    fThread({ id: "c", status: "running", usedTokens: 5000, rate: 30, parentThreadId: "p", createdAt: 2000 }),
  ];
  const l = swimlaneLayout(threads, { width: 1860, openProjects: new Set(["proj_1"]) });
  const working = l.rows[0]!.lanes.find((ln) => ln.id === "working")!;
  assert.equal(working.cards.filter((c) => c.depth === 0).length, 1, "one top-level card");
  assert.equal(working.cards[0]!.id, "p");
  assert.equal(working.cards[0]!.kidCount, 1, "the child is contained, not promoted");
  assert.equal(working.cards[0]!.flow, 6000, "the parent's total covers its contained child");
  // Open the parent: the child is drawn nested, at depth 1, with its own river.
  const opened = swimlaneLayout(threads, {
    width: 1860,
    openProjects: new Set(["proj_1"]),
    openThreads: new Set(["p"]),
  });
  const w2 = opened.rows[0]!.lanes.find((ln) => ln.id === "working")!;
  assert.equal(w2.cards.find((c) => c.id === "c")!.depth, 1);
  assert.equal(w2.rivers.filter((r) => r.cardId === "c").length, 1);
});

test("invariant: every running thread is drawn in the Working lane, each with a river", () => {
  // The real-world shape that broke it: a workstation orchestrator that is
  // waiting on the operator, with several running threads beneath it.
  const threads = [
    fThread({ id: "orchestrator", status: "waiting", usedTokens: 900 }),
    fThread({ id: "w1", status: "running", usedTokens: 4000, rate: 50, parentThreadId: "orchestrator", createdAt: 1 }),
    fThread({ id: "w2", status: "running", usedTokens: 3000, rate: 40, parentThreadId: "orchestrator", createdAt: 2 }),
    fThread({ id: "w3", status: "running", usedTokens: 2000, rate: 30, parentThreadId: "w1", createdAt: 3 }),
    fThread({ id: "idle1", status: "idle", usedTokens: 100 }),
  ];
  const l = swimlaneLayout(threads, {
    width: 1860,
    openProjects: new Set(["proj_1"]),
    openThreads: new Set(["orchestrator", "w1"]),
  });
  const row = l.rows[0]!;
  const working = row.lanes.find((ln) => ln.id === "working")!;
  const drawn = new Set(working.cards.map((c) => c.id));
  for (const id of ["w1", "w2", "w3"]) assert.ok(drawn.has(id), `${id} must be drawn in Working`);
  assert.equal(working.count, 3, "the lane reports three threads");
  assert.equal(row.working, 3, "the row agrees with the lane — no phantom count");
  const riveted = working.rivers.filter((r) => drawn.has(r.cardId) && r.rate > 0);
  assert.equal(riveted.length, 3, "each running thread has an animating river");
  // The waiting orchestrator holds nothing: its children were promoted.
  const orchestrator = row.lanes.find((ln) => ln.id === "needs-you")!.cards.find((c) => c.id === "orchestrator")!;
  assert.equal(orchestrator.kidCount, 0);
  assert.equal(orchestrator.shownRate, 0, "and it carries no subtree rate");
});

test("lane order: the highest-consuming thread leads its lane", () => {
  const l = swimlaneLayout(roster(), { width: 1860, openProjects: new Set(["pa"]) });
  const working = l.rows.find((r) => r.id === "pa")!.lanes.find((ln) => ln.id === "working")!;
  const top = working.cards.filter((c) => c.depth === 0);
  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1]!.flow >= top[i]!.flow, "a lane sorts by subtree flow, highest first");
  }
  assert.equal(top[0]!.id, "act-parent", "the runaway thread is the first row");
});

test("paint order: cards parent-first; rivers in front, deepest furthest back", () => {
  const l = swimlaneLayout(roster(), {
    width: 1860,
    openProjects: new Set(["pa"]),
    openThreads: new Set(["act-parent", "act-child"]),
  });
  const working = l.rows.find((r) => r.id === "pa")!.lanes.find((ln) => ln.id === "working")!;
  const cards = cardPaintOrder(working.cards);
  for (let i = 1; i < cards.length; i++) {
    assert.ok(cards[i - 1]!.depth <= cards[i]!.depth, "cards paint parent-first");
  }
  const rivers = riverPaintOrder(working.rivers);
  assert.equal(rivers[0]!.depth, 2, "the grandchild's river is furthest back");
  for (let i = 1; i < rivers.length; i++) {
    assert.ok(rivers[i - 1]!.depth >= rivers[i]!.depth, "rivers paint deepest-first");
  }
});

test("spine + links: providers stack on the left; links run spine → row", () => {
  const l = swimlaneLayout(roster(), { width: 1860, openProjects: new Set(["pa"]) });
  assert.deepEqual(l.spine.map((s) => s.id), ["anthropic", "openai", "google"], "spine in provider order");
  for (let i = 1; i < l.spine.length; i++) {
    assert.ok(l.spine[i]!.y >= l.spine[i - 1]!.y + l.spine[i - 1]!.h, "spine blocks stack");
  }
  assert.ok(l.links.length > 0);
  for (const k of l.links) {
    assert.equal(k.x1, SWIMLANE.SPINE_X + SWIMLANE.SPINE_W);
    assert.equal(k.x2, SWIMLANE.ROW_X + 4);
  }
});

test("overflow: a lane whose cards exceed the band reports overflow", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    fThread({ id: `t${i}`, projectId: "pa", projectName: "activity", status: "running", usedTokens: 1000, rate: 10 }),
  );
  const l = swimlaneLayout(many, { width: 1860, openProjects: new Set(["pa"]) });
  const working = l.rows[0]!.lanes.find((ln) => ln.id === "working")!;
  assert.ok(working.contentH > working.visibleH);
  assert.equal(working.overflow, true);
});

test("river paths are finite and carry no undefined, at every depth", () => {
  const l = swimlaneLayout(roster(), {
    width: 1860,
    openProjects: new Set(["pa"]),
    openThreads: new Set(["act-parent", "act-child"]),
  });
  const rivers = l.rows.find((r) => r.id === "pa")!.lanes.find((ln) => ln.id === "working")!.rivers;
  assert.ok(rivers.length >= 3);
  for (const rv of rivers) {
    for (const d of [riverPath(rv), riverEdgePath(rv), riverBeadPath(rv)]) {
      assert.ok(!d.includes("NaN") && !d.includes("undefined"), d);
    }
  }
});

test("layout is deterministic across input order", () => {
  const a = JSON.stringify(swimlaneLayout(roster(), { width: 1860, openProjects: new Set(["pa"]) }));
  const b = JSON.stringify(swimlaneLayout([...roster()].reverse(), { width: 1860, openProjects: new Set(["pa"]) }));
  assert.equal(a, b);
});

test("layout: an all-idle roster keeps finite zero geometry and no rivers", () => {
  const threads = Array.from({ length: 8 }, (_, i) =>
    fThread({ id: `t${i}`, projectId: "pz", projectName: "zeta", status: "idle", usedTokens: 0 }),
  );
  const l = swimlaneLayout(threads, { width: 1860, openProjects: new Set(["pz"]) });
  assert.ok(Number.isFinite(l.H) && l.H > 0);
  for (const row of l.rows) {
    for (const ln of row.lanes) {
      if (ln.id !== "working") continue;
      for (const rv of ln.rivers) assert.ok(Number.isFinite(rv.w) && rv.w > 0);
    }
  }
});
