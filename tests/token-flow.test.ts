// Token flow (swimlane) model tests: the four-lane fold, the contained
// subtree (parent → child → grandchild, hard-capped), the project stack, and
// the layout invariants the approved swimlane mockup settled.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FLOW_BUCKETS,
  FLOW_INTERVALS,
  FLOW_WINDOW_MS,
  SWIMLANE,
  SWIMLANES,
  TIER_BOX,
  agentLabel,
  bandW,
  boxHeight,
  buildForest,
  cardHeight,
  cardPaintOrder,
  laneOf,
  modelParts,
  providerOfModel,
  readsQuiet,
  recentFlowTokMin,
  resampleWindow,
  riverBeadPath,
  riverEdgePath,
  riverOpacity,
  riverPaintOrder,
  riverPath,
  subtreeFlow,
  subtreeRate,
  subscriptionOf,
  swimlaneLayout,
  tierGroups,
  tierInnerLabel,
  tierOuterKey,
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
    agentProvider: over.agentProvider === undefined ? "acp-opencode" : over.agentProvider,
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

test("links: the Tier-1→project rivers are bands sized by each group's flow", () => {
  const threads = [
    fThread({ id: "a1", projectId: "pa", projectName: "Alpha", status: "running", usedTokens: 100_000, rate: 500, provider: "anthropic", agentProvider: "acp-opencode" }),
    fThread({ id: "a2", projectId: "pa", projectName: "Alpha", status: "running", usedTokens: 60_000, rate: 300, provider: "openai", agentProvider: "codex" }),
    fThread({ id: "b1", projectId: "pb", projectName: "Beta", status: "idle", usedTokens: 400, rate: 0, provider: "anthropic", agentProvider: "acp-opencode" }),
  ];
  const l = swimlaneLayout(threads, { width: 1860, mode: "provider" });
  assert.equal(l.links.length, 3, "one river per Tier-1 group per project");
  const opencodeAlpha = l.links.find((k) => k.id === "link:pa:acp-opencode")!;
  const codexAlpha = l.links.find((k) => k.id === "link:pa:codex")!;
  const beta = l.links.find((k) => k.id === "link:pb:acp-opencode")!;
  // The band carries that group's flow in that project, same rule as a card
  // river — so the group segment and the card segment read as one river.
  assert.equal(opencodeAlpha.flow, 100_000);
  assert.equal(codexAlpha.flow, 60_000);
  assert.equal(opencodeAlpha.w, bandW(100_000, 100_000));
  assert.ok(opencodeAlpha.w > 10, `the busiest group river is a band (${opencodeAlpha.w})`);
  assert.ok(opencodeAlpha.w > codexAlpha.w, "a bigger flow is a wider band");
  assert.ok(opencodeAlpha.w > beta.w, "the hot project's river beats the quiet one");
  // Both ends of the segment are the Tier-1 column's edge and the row's left edge.
  assert.equal(opencodeAlpha.x1, SWIMLANE.SPINE_X + SWIMLANE.SPINE_W);
  assert.equal(opencodeAlpha.x2, SWIMLANE.ROW_X + 4);
  // Live groups carry activity for the beads; a quiet one stays dim.
  assert.ok(opencodeAlpha.rate > 0 && codexAlpha.rate > 0);
  assert.equal(beta.rate, 0);
  assert.ok(beta.opacity < opencodeAlpha.opacity, "a quiet project's river is dimmer");
  for (const k of l.links) {
    assert.ok(k.opacity >= 0.3 - 1e-9 && k.opacity <= 0.8 + 1e-9, `link opacity ${k.opacity}`);
  }
});

// ---------- layout invariants ----------

/** A roster with three projects, a nested chain, and every lane populated. */
function roster(): FlowThread[] {
  return [
    fThread({ id: "act-parent", projectId: "pa", projectName: "activity", title: "sankey diagram for PRs", status: "running", usedTokens: 24600, rate: 264, provider: "anthropic", agentProvider: "acp-opencode", model: "synthetic/hf:zai-org/GLM-5.3-Flash" }),
    fThread({ id: "act-child", projectId: "pa", projectName: "activity", title: "layout regression sweep", status: "running", usedTokens: 11400, rate: 172, parentThreadId: "act-parent", createdAt: 2000, provider: "anthropic", agentProvider: "acp-opencode", model: "synthetic/hf:zai-org/GLM-5.3-Flash" }),
    fThread({ id: "act-grand", projectId: "pa", projectName: "activity", title: "pixel snapshot pass", status: "running", usedTokens: 5200, rate: 60, parentThreadId: "act-child", createdAt: 3000, provider: "google", agentProvider: "acp-opencode", model: "ollama-cloud/glm-5.3-flash" }),
    fThread({ id: "act-error", projectId: "pa", projectName: "activity", title: "visual-check driver", status: "error", usedTokens: 31500, provider: "google", agentProvider: "acp-opencode", model: "ollama-cloud/glm-5.3-flash" }),
    fThread({ id: "act-done", projectId: "pa", projectName: "activity", title: "treemap label layer", status: "done", usedTokens: 12400, provider: "anthropic", agentProvider: "acp-opencode", model: "cove/text:standard" }),
    fThread({ id: "act-idle", projectId: "pa", projectName: "activity", title: "legend chips", status: "idle", usedTokens: 3100, provider: "openai", agentProvider: "acp-opencode", model: "cove/vision:heavy" }),
    fThread({ id: "foc-run", projectId: "pf", projectName: "focus-board", title: "parent-thread view", status: "running", usedTokens: 38200, rate: 150, provider: "openai", agentProvider: "codex", model: "gpt-6-luna" }),
    fThread({ id: "foc-wait", projectId: "pf", projectName: "focus-board", title: "card tween", status: "waiting", usedTokens: 9600, provider: "anthropic", agentProvider: "codex", model: "gpt-6-sol" }),
    fThread({ id: "cov-idle", projectId: "pc", projectName: "cove", title: "vault rotation cron", status: "idle", usedTokens: 5100, provider: "google", agentProvider: "claude-code", model: "claude-sonnet-5.5" }),
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

test("tier 1: the nested boxes stack on the left; links run the column → row", () => {
  const l = swimlaneLayout(roster(), { width: 1860, openProjects: new Set(["pa"]), mode: "provider" });
  // One outer box per ACP provider (the toggle's mode), not per model family.
  assert.deepEqual(
    l.spine.map((s) => s.id).sort(),
    ["acp-opencode", "claude-code", "codex"],
    "one outer box per ACP provider",
  );
  for (const b of l.spine) {
    assert.ok(b.inner.length >= 1, `${b.id} nests at least one Tier-2 box`);
    assert.ok(b.label.length > 0, `${b.id} carries a label`);
    for (let i = 1; i < b.inner.length; i++) {
      assert.ok(b.inner[i]!.y >= b.inner[i - 1]!.y + b.inner[i - 1]!.h - 1e-6, "Tier-2 boxes stack");
    }
  }
  for (let i = 1; i < l.spine.length; i++) {
    assert.ok(l.spine[i]!.y >= l.spine[i - 1]!.y + l.spine[i - 1]!.h, "outer boxes stack");
  }
  assert.ok(l.links.length > 0);
  for (const k of l.links) {
    assert.equal(k.x1, SWIMLANE.SPINE_X + SWIMLANE.SPINE_W);
    assert.equal(k.x2, SWIMLANE.ROW_X + 4);
    assert.ok(l.spine.some((b) => b.id === k.tier1), "the river leaves a real outer box");
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

// ---------- two-tier provider/model boxes (thr_h3id3kyfaf) ----------

/** A series whose newest 10 buckets each carry `tokPerInterval` tokens. */
function flowSeries(tokPerInterval: number): number[] {
  const s = new Array<number>(FLOW_BUCKETS).fill(0);
  for (let i = FLOW_BUCKETS - FLOW_INTERVALS; i < FLOW_BUCKETS; i++) s[i] = tokPerInterval;
  return s;
}

test("modelParts splits the subscription prefix from the model id", () => {
  assert.deepEqual(modelParts("synthetic/hf:zai-org/GLM-5.3-Flash"), {
    subscription: "synthetic",
    model: "hf:zai-org/GLM-5.3-Flash",
  });
  assert.deepEqual(modelParts("ollama-cloud/glm-5.3-flash:cloud"), {
    subscription: "ollama-cloud",
    model: "glm-5.3-flash:cloud",
  });
  assert.deepEqual(modelParts("claude-sonnet-5.5"), { subscription: null, model: "claude-sonnet-5.5" });
  assert.deepEqual(modelParts(" auto "), { subscription: null, model: "auto" });
  assert.deepEqual(modelParts(null), { subscription: null, model: "unknown" });
  assert.deepEqual(modelParts(""), { subscription: null, model: "unknown" });
  assert.deepEqual(modelParts("trailing/"), { subscription: null, model: "trailing/" });
  assert.equal(subscriptionOf("cove/text:standard"), "cove");
  assert.equal(subscriptionOf("gpt-6-luna"), null);
});

test("agentLabel maps known provider ids and falls through unknown ones", () => {
  assert.equal(agentLabel("acp-opencode"), "opencode");
  assert.equal(agentLabel("codex"), "Codex");
  assert.equal(agentLabel("claude-code"), "Claude Code");
  assert.equal(agentLabel("pi"), "Pi");
  assert.equal(agentLabel("acp-something-new"), "acp-something-new");
  assert.equal(agentLabel(null), "Unknown");
  assert.equal(agentLabel(undefined), "Unknown");
  assert.equal(agentLabel("  "), "Unknown");
});

test("tierOuterKey / tierInnerLabel: provider mode groups the ACP agent, the pair inside", () => {
  const t = fThread({ agentProvider: "acp-opencode", model: "synthetic/hf:zai-org/GLM-5.3-Flash" });
  assert.equal(tierOuterKey(t, "provider"), "acp-opencode");
  assert.equal(tierInnerLabel(t.model, "provider"), "synthetic / hf:zai-org/GLM-5.3-Flash");
  assert.equal(tierOuterKey(t, "subscription"), "synthetic");
  assert.equal(tierInnerLabel(t.model, "subscription"), "hf:zai-org/GLM-5.3-Flash");
  // A bare model has no subscription: the ACP provider stands in for it.
  const bare = fThread({ agentProvider: "claude-code", model: "claude-sonnet-5.5" });
  assert.equal(tierOuterKey(bare, "subscription"), "Claude Code");
  assert.equal(tierInnerLabel(bare.model, "provider"), "claude-sonnet-5.5");
});

test("recentFlowTokMin: Σ of the newest intervals, in tokens per minute", () => {
  const series = new Array<number>(FLOW_BUCKETS).fill(0);
  for (let i = FLOW_BUCKETS - FLOW_INTERVALS; i < FLOW_BUCKETS; i++) series[i] = 100;
  // 20 three-minute buckets; the newest 10 carry 100 each → 1000 tok over 30 min.
  assert.equal(recentFlowTokMin(series, FLOW_WINDOW_MS, FLOW_BUCKETS), 1000 / 30);
  // Older buckets sit outside the last-10 window.
  const oldOnly = new Array<number>(FLOW_BUCKETS).fill(0);
  oldOnly[0] = 9_000;
  assert.equal(recentFlowTokMin(oldOnly, FLOW_WINDOW_MS, FLOW_BUCKETS), 0);
  // Empty / degenerate inputs are a measured zero, never NaN.
  assert.equal(recentFlowTokMin([], FLOW_WINDOW_MS, FLOW_BUCKETS), 0);
  assert.equal(recentFlowTokMin(series, 0, FLOW_BUCKETS), 0);
  assert.equal(recentFlowTokMin(series, FLOW_WINDOW_MS, 0), 0);
  // The interval count is a parameter: the full 20 buckets over the whole hour.
  assert.equal(recentFlowTokMin(series, FLOW_WINDOW_MS, FLOW_BUCKETS, 20), (10 * 100) / 60);
});

test("boxHeight: floored, capped, monotone, deterministic; NaN throws", () => {
  assert.equal(boxHeight(0, 100), TIER_BOX.MIN_H, "a zero flow draws at the floor");
  assert.equal(boxHeight(100, 100), TIER_BOX.MAX_H, "the hottest box clamps at the ceiling");
  assert.equal(boxHeight(50, 100), boxHeight(50, 100), "deterministic for the same input");
  assert.ok(boxHeight(50, 100) > boxHeight(25, 100), "taller = more tokens/min");
  assert.ok(boxHeight(25, 100) >= TIER_BOX.MIN_H && boxHeight(25, 100) <= TIER_BOX.MAX_H);
  // A zero max (an all-quiet roster) still lands on the floor, never NaN.
  assert.equal(boxHeight(0, 0), TIER_BOX.MIN_H);
  assert.equal(boxHeight(999, 0), TIER_BOX.MIN_H, "with no max there is no scale; the floor holds");
  assert.throws(() => boxHeight(Number.NaN, 100), RangeError);
});

test("tierGroups: provider mode nests subscription+model inside each ACP provider", () => {
  const threads = [
    fThread({ id: "a", agentProvider: "acp-opencode", model: "synthetic/hf:zai-org/GLM-5.3-Flash", series: flowSeries(90), usedTokens: 1000, rate: 5 }),
    fThread({ id: "b", agentProvider: "acp-opencode", model: "ollama-cloud/glm-5.3-flash", series: flowSeries(30), usedTokens: 500, rate: 2 }),
    fThread({ id: "c", agentProvider: "codex", model: "gpt-6-luna", series: flowSeries(0), usedTokens: 100, rate: 0 }),
  ];
  const groups = tierGroups(threads, "provider");
  assert.deepEqual(groups.map((g) => g.id), ["acp-opencode", "codex"], "the hottest ACP provider leads");
  const oc = groups.find((g) => g.id === "acp-opencode")!;
  assert.equal(oc.label, "opencode");
  assert.deepEqual(
    oc.inner.map((i) => i.id),
    ["synthetic / hf:zai-org/GLM-5.3-Flash", "ollama-cloud / glm-5.3-flash"],
    "Tier-2 boxes sort hottest-first",
  );
  const [hot, warm] = oc.inner;
  assert.ok(hot!.h > warm!.h, "the hotter subscription+model box is taller");
  assert.ok(warm!.h >= TIER_BOX.MIN_H, "the quieter box never falls below the legibility floor");
  assert.ok(
    oc.h >= TIER_BOX.HDR_H + 2 * TIER_BOX.PAD + hot!.h + TIER_BOX.GAP + warm!.h - 1e-6,
    "the outer box wraps its Tier-2 boxes",
  );
  assert.ok(groups[1]!.y >= oc.y + oc.h, "outer boxes stack without overlap");
  assert.equal(groups[1]!.inner[0]!.id, "gpt-6-luna");
});

test("tierGroups: subscription mode swaps Tier 1 to the subscription and Tier 2 to the model", () => {
  const threads = [
    fThread({ id: "a", agentProvider: "acp-opencode", model: "synthetic/hf:zai-org/GLM-5.3-Flash", series: flowSeries(60) }),
    fThread({ id: "b", agentProvider: "codex", model: "synthetic/syn:small:vision", series: flowSeries(20) }),
    fThread({ id: "c", agentProvider: "claude-code", model: "claude-sonnet-5.5", series: flowSeries(10) }),
  ];
  const groups = tierGroups(threads, "subscription");
  assert.deepEqual(
    groups.map((g) => g.id).sort(),
    ["Claude Code", "synthetic"],
    "subscriptions are the outer boxes; a bare model falls back to its ACP provider",
  );
  const syn = groups.find((g) => g.id === "synthetic")!;
  assert.deepEqual(syn.inner.map((i) => i.id).sort(), ["hf:zai-org/GLM-5.3-Flash", "syn:small:vision"]);
  assert.equal(syn.threads, 2);
});

test("tierGroups: a missing ACP provider groups under Unknown, never dropped", () => {
  const groups = tierGroups([fThread({ id: "x", agentProvider: null, model: "mystery-model", series: flowSeries(10) })], "provider");
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.id, "unknown");
  assert.equal(groups[0]!.label, "Unknown");
  assert.equal(groups[0]!.inner[0]!.id, "mystery-model");
});

test("tierGroups is deterministic across input order", () => {
  const threads = [
    fThread({ id: "a", agentProvider: "acp-opencode", model: "synthetic/x", series: flowSeries(50) }),
    fThread({ id: "b", agentProvider: "codex", model: "gpt-6-luna", series: flowSeries(50) }),
  ];
  assert.equal(
    JSON.stringify(tierGroups(threads, "provider")),
    JSON.stringify(tierGroups([...threads].reverse(), "provider")),
  );
});

test("swimlaneLayout: the mode flows through to the Tier-1 grouping", () => {
  const threads = [
    fThread({ id: "a", agentProvider: "acp-opencode", model: "synthetic/x", series: flowSeries(60) }),
    fThread({ id: "b", agentProvider: "codex", model: "gpt-6-luna", series: flowSeries(20) }),
  ];
  const byProvider = swimlaneLayout(threads, { width: 1860, mode: "provider" });
  assert.equal(byProvider.mode, "provider");
  assert.deepEqual(byProvider.spine.map((s) => s.id).sort(), ["acp-opencode", "codex"]);
  const bySub = swimlaneLayout(threads, { width: 1860, mode: "subscription" });
  assert.equal(bySub.mode, "subscription");
  assert.deepEqual(bySub.spine.map((s) => s.id).sort(), ["Codex", "synthetic"]);
});

test("swimlaneLayout: with no mode passed, Tier 1 defaults to the subscription axis", () => {
  const threads = [
    fThread({ id: "a", agentProvider: "acp-opencode", model: "synthetic/x", series: flowSeries(60) }),
    fThread({ id: "b", agentProvider: "codex", model: "gpt-6-luna", series: flowSeries(20) }),
  ];
  const l = swimlaneLayout(threads, { width: 1860 });
  assert.equal(l.mode, "subscription", "the absent mode means the subscription axis, the operator's default");
  assert.deepEqual(l.spine.map((s) => s.id).sort(), ["Codex", "synthetic"], "the outer boxes are subscriptions, not ACP providers");
});

test("a rate too small to show as whole tok/min reads as quiet, never \"0 tok/min\"", () => {
  assert.equal(readsQuiet(0), true, "no measured burn is quiet");
  assert.equal(readsQuiet(0.004), true, "0.24 tok/min would round to the misleading 0");
  assert.equal(readsQuiet(0.0083), true, "just under half a tok/min is still quiet");
  assert.equal(readsQuiet(0.5), false, "30 tok/min is a real rate");
  assert.equal(readsQuiet(30), false);
  // The layout carries the flag: a barely-burning group head is quiet, and a
  // genuinely burning one is not.
  const slow = swimlaneLayout(
    [
      fThread({ id: "trickle", status: "running", usedTokens: 2400, rate: 0.004 }),
      fThread({ id: "trickle-sub", parentThreadId: "trickle", status: "running", usedTokens: 900, rate: 0, createdAt: 2000 }),
    ],
    { width: 1860, openProjects: new Set(["proj_1"]) },
  );
  const head = slow.rows[0]!.lanes.find((ln) => ln.id === "working")!.cards.find((c) => c.id === "trickle")!;
  assert.equal(head.hasGroup, true);
  assert.equal(head.quiet, true, "the bare trickle is reported as quiet");
  assert.ok(head.shownRate > 0, "it is not zero — the reading is real, just tiny");

  const fast = swimlaneLayout([fThread({ id: "hot", status: "running", usedTokens: 5000, rate: 40 })], {
    width: 1860,
    openProjects: new Set(["proj_1"]),
  });
  const hot = fast.rows[0]!.lanes.find((ln) => ln.id === "working")!.cards.find((c) => c.id === "hot")!;
  assert.equal(hot.quiet, false, "a real burn is not quiet");
});
