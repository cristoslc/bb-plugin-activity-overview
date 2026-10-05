// Layout invariant + classification tests for views/model.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classify, buildProjects, buildAgentTree, laneRows, makeLaneCards,
  squarify, makeCards, shelfPack, attentionScore,
  familyTints, FAMILY_TINTS, zoomToRect, clampPan,
  indexShape, flowDefaultOpen, flowChildren, flowAge, flowLayout, WORK_SHOWN,
  NODE_W, NODE_H, COL_GAP, ROW_GAP,
  type AttnThread, type AttnProject, type FlowNode, type ShapeDto,
} from "../views/model.ts";

const NOW = Date.parse("2026-10-04T19:00:00Z");
const ISO_NOW = "2026-10-04T19:00:00.000Z";
function thread(over: Partial<AttnThread> = {}): AttnThread {
  return {
    id: over.id ?? "thr_x", projectId: over.projectId ?? "proj_a", title: over.title ?? "t",
    parentThreadId: over.parentThreadId ?? null, status: over.status ?? "idle",
    runtimeStatus: over.runtimeStatus ?? "idle", hasPendingInteraction: over.hasPendingInteraction ?? false,
    isUnread: over.isUnread ?? false, archivedAt: over.archivedAt ?? null,
    lastReadAt: over.lastReadAt ?? NOW, latestAttentionAt: over.latestAttentionAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW, createdAt: over.createdAt ?? NOW,
  };
}

test("classification precedence: needs-you beats error beats working beats unread beats idle", () => {
  const t = thread({ hasPendingInteraction: true, runtimeStatus: "error", status: "active", isUnread: true });
  assert.equal(classify(t), "needs-you");
  const e = thread({ runtimeStatus: "error", status: "active", isUnread: true });
  assert.equal(classify(e), "error");
  const w = thread({ runtimeStatus: "active", isUnread: true });
  assert.equal(classify(w), "working");
  const u = thread({ isUnread: true });
  assert.equal(classify(u), "unread");
  const i = thread();
  assert.equal(classify(i), "idle");
});

test("archived threads are excluded; project groups are hottest-first", () => {
  const threads = [
    thread({ id: "a", runtimeStatus: "error" }),
    thread({ id: "b", archivedAt: NOW }),
  ];
  const { projects, total } = buildProjects(threads, [{ id: "proj_a", name: "A" }], NOW);
  assert.equal(total, 1);
  assert.equal(projects.length, 1);
});

test("family grouping: children follow their visible parent", () => {
  const threads = [
    thread({ id: "child", parentThreadId: "parent", createdAt: NOW, latestAttentionAt: NOW }),
    thread({ id: "parent" }),
  ];
  const { projects } = buildProjects(threads, [{ id: "proj_a", name: "A" }], NOW);
  assert.equal(projects[0].cells[0].t.id, "parent");
  assert.equal(projects[0].cells[1].t.id, "child");
});

test("squarify: area is preserved and every rect is inside the canvas", () => {
  const rects = squarify(
    Array.from({ length: 10 }, (_, i) => ({ key: String(i), weight: (i % 3) + 1 })),
    100, 50,
  );
  const total = rects.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(Math.abs(total - 5000) < 1, `area ${total}`);
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= 0);
    assert.ok(r.w > 0 && r.h > 0);
    assert.ok(r.x + r.w <= 100.0001 && r.y + r.h <= 50.0001);
  }
});

test("shelf pack places every card without overlap row overflow", () => {
  const projects = Array.from({ length: 20 }, (_, i) => ({
    pid: `p${i}`, name: `p${i}`, cells: [], n: i + 1, best: i, hot: 0,
  }));
  const cards = makeCards(projects, 13, 13);
  const placed = shelfPack(cards, 1120, 14, 14);
  assert.equal(placed.placed.length, 20);
  for (const p of placed.placed) assert.ok(p.x + p.card.w <= 1121);
});

const projectOfN = (n: number, i: number) => ({
  pid: `p${i}`, name: `prowd-${i}`, cells: [], n, best: i, hot: 0,
});

test("makeCards honours minW by widening slot cols so the grid fills the card", () => {
  const projects = [projectOfN(1, 0), projectOfN(3, 1), projectOfN(30, 2)];
  const cards = makeCards(projects, 13, 13, 120);
  for (const c of cards) {
    assert.ok(c.w >= 120, `card width ${c.w} below minW`);
    assert.ok(c.cols * 13 + 16 >= 120, `cols ${c.cols} too narrow for minW`);
    assert.ok(c.rows >= 1 && c.rows * c.cols >= c.n, `grid ${c.cols}x${c.rows} cannot hold ${c.n} dots`);
  }
  // a 1-thread project widens to fill minW; a large project keeps its natural cols
  assert.ok(cards[0].cols > 2);
  assert.ok(cards[2].cols >= Math.ceil(Math.sqrt(30 * 1.35)));
});

test("shelf pack reflows to any target width (no fixed 1120 assumption)", () => {
  const projects = Array.from({ length: 12 }, (_, i) => projectOfN((i % 7) + 1, i));
  for (const W of [360, 600, 480, 1400]) {
    const cards = makeCards(projects, 13, 13, 120);
    const placed = shelfPack(cards, W, 14, 14);
    assert.equal(placed.placed.length, 12, `W=${W}`);
    for (const p of placed.placed) {
      assert.ok(p.x + p.card.w <= W + 0.5, `card overflows W=${W}: x=${p.x} w=${p.card.w}`);
      assert.ok(p.x >= 0);
    }
    // no two cards on the same shelf overlap
    const byShelf = new Map<number, Array<{ x0: number; x1: number }>>();
    for (const p of placed.placed) {
      const list = byShelf.get(p.y) ?? [];
      list.push({ x0: p.x, x1: p.x + p.card.w });
      byShelf.set(p.y, list);
    }
    for (const rows of byShelf.values()) {
      rows.sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i].x0 >= rows[i - 1].x1, `overlap at W=${W}`);
    }
  }
});

test("attention score orders error < needs-you < working < unread < idle", () => {
  const scores = [
    attentionScore(thread({ runtimeStatus: "error" }), NOW),
    attentionScore(thread({ hasPendingInteraction: true }), NOW),
    attentionScore(thread({ runtimeStatus: "active" }), NOW),
    attentionScore(thread({ isUnread: true }), NOW),
    attentionScore(thread(), NOW),
  ];
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1]);
});

// ---------- agent graph (lane tree) ----------

test("agent tree: orphans and self-parents promote to roots; children follow visible parents", () => {
  const threads = [
    thread({ id: "child", parentThreadId: "parent" }),
    thread({ id: "parent" }),
    thread({ id: "orphan", parentThreadId: "ghost" }),
    thread({ id: "self", parentThreadId: "self" }),
  ];
  const fam = buildAgentTree(threads);
  assert.deepEqual(fam.roots.map((t) => t.id).sort(), ["orphan", "parent", "self"]);
  assert.deepEqual(fam.childrenOf.get("parent")!.map((t) => t.id), ["child"]);
});

test("agent tree: parentThreadId cycles are severed into roots instead of hanging a walk", () => {
  const threads = [
    thread({ id: "a", parentThreadId: "b" }),
    thread({ id: "b", parentThreadId: "a" }),
  ];
  const { lanes, total } = laneRows(threads, [{ id: "proj_a", name: "A" }], NOW);
  assert.equal(total, 2);
  const rows = lanes[0].rows;
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.depth, 0);
});

test("agent lanes: children sort attention-ascending and depth tracks hierarchy", () => {
  const threads = [
    thread({ id: "parent" }),
    thread({ id: "calm", parentThreadId: "parent" }),
    thread({ id: "hot", parentThreadId: "parent", runtimeStatus: "error" }),
  ];
  const { lanes } = laneRows(threads, [{ id: "proj_a", name: "A" }], NOW);
  assert.deepEqual(
    lanes[0].rows.map((r) => [r.t.id, r.depth]),
    [["parent", 0], ["hot", 1], ["calm", 1]],
  );
});

test("agent lanes: deep chains carry depth 2+; family blocks stay contiguous", () => {
  const threads = [
    thread({ id: "r1" }),
    thread({ id: "c1", parentThreadId: "r1" }),
    thread({ id: "mid", parentThreadId: "c1" }),
    thread({ id: "r2" }),
  ];
  const { lanes } = laneRows(threads, [{ id: "proj_a", name: "A" }], NOW);
  const rows = lanes[0].rows;
  assert.deepEqual(
    rows.map((r) => [r.t.id, r.depth]),
    [["r1", 0], ["c1", 1], ["mid", 2], ["r2", 0]],
  );
});

test("agent lanes: archived threads excluded; hottest project first", () => {
  const threads = [
    thread({ id: "dead", projectId: "proj_a", archivedAt: NOW }),
    thread({ id: "p2t", projectId: "proj_b", runtimeStatus: "active" }),
    thread({ id: "p1t", projectId: "proj_a" }),
  ];
  const { lanes, total } = laneRows(threads, [
    { id: "proj_a", name: "A" }, { id: "proj_b", name: "B" },
  ], NOW);
  assert.equal(total, 2);
  assert.deepEqual(lanes.map((l) => l.pid), ["proj_b", "proj_a"]);
  assert.equal(lanes[0].hot, 1);
  assert.equal(lanes[0].rows.length, 1);
});

test("agent lanes: lane cards pack inside the canvas width with no overflow", () => {
  const threads = [
    thread({ id: "r" }),
    thread({ id: "c", parentThreadId: "r" }),
    thread({ id: "m", parentThreadId: "c" }),
    thread({ id: "leaf", parentThreadId: "m" }),
    thread({ id: "other" }),
  ];
  const { lanes } = laneRows(threads, [{ id: "proj_a", name: "A" }], NOW);
  const cards = makeLaneCards(lanes, 13);
  const placed = shelfPack(cards, 1120, 14, 14);
  assert.equal(placed.placed.length, lanes.length);
  for (const p of placed.placed) assert.ok(p.x + p.card.w <= 1121);
});

// ---------- activity flow: fold policy over the server shape ----------

let flowSeq = 0;
function fnode(over: Partial<FlowNode> = {}): FlowNode {
  flowSeq += 1;
  return {
    id: over.id ?? `n${flowSeq}`, parentId: over.parentId ?? "root",
    kind: over.kind ?? "work", label: over.label ?? "L", sublabel: over.sublabel ?? null,
    status: over.status ?? "done", threadId: over.threadId ?? null,
    startedAt: over.startedAt !== undefined ? over.startedAt : NOW,
    completedAt: over.completedAt !== undefined ? over.completedAt : NOW,
    input: over.input ?? null, output: over.output ?? null, meta: over.meta ?? {},
  };
}
function shapeFrom(nodes: FlowNode[]): ShapeDto {
  return { nodes, generatedAt: NOW, truncated: false };
}

test("activity flow: project cards list their threads in server order, with rollups indexed", () => {
  const shape = shapeFrom([
    fnode({ id: "root", parentId: null, kind: "root" }),
    fnode({ id: "project:a", parentId: "root", kind: "project", label: "Alpha" }),
    fnode({ id: "thr_1", parentId: "project:a", kind: "thread", threadId: "thr_1", status: "running" }),
    fnode({ id: "thr_2", parentId: "project:a", kind: "thread", threadId: "thr_2", status: "idle" }),
    fnode({ id: "project:b", parentId: "root", kind: "project", label: "Beta" }),
    fnode({ id: "thr_3", parentId: "project:b", kind: "thread", threadId: "thr_3", status: "waiting" }),
  ]);
  const index = indexShape(shape);
  assert.deepEqual([...(index.threadsOf.get("project:a") ?? [])].map((n) => n.id), ["thr_1", "thr_2"]);
  assert.equal(index.newestTurn.get("thr_1"), undefined);
});

test("activity flow: default fold opens projects and hot threads, closes idle threads and done turns", () => {
  const shape = shapeFrom([
    fnode({ id: "project:a", parentId: "root", kind: "project" }),
    fnode({ id: "thr_run", parentId: "project:a", kind: "thread", threadId: "thr_run", status: "running" }),
    fnode({ id: "thr_run:turn:t1", parentId: "thr_run", kind: "turn", threadId: "thr_run", status: "done", completedAt: NOW - 60000 }),
    fnode({ id: "thr_run:turn:t2", parentId: "thr_run", kind: "turn", threadId: "thr_run", status: "running", completedAt: null }),
    fnode({ id: "thr_idle", parentId: "project:a", kind: "thread", threadId: "thr_idle", status: "idle" }),
    fnode({ id: "thr_idle:turn:t9", parentId: "thr_idle", kind: "turn", threadId: "thr_idle" }),
  ]);
  const open = flowDefaultOpen(shape);
  assert.ok(open.has("project:a"));
  assert.ok(open.has("thr_run"));
  assert.ok(!open.has("thr_idle"));
  // Only the newest turn of a running thread expands by default.
  assert.ok(open.has("thr_run:turn:t2"));
  assert.ok(!open.has("thr_run:turn:t1"));
  assert.ok(!open.has("thr_idle:turn:t9"));
});

test("activity flow: expanded turns fold their work list to the newest rows behind a synthetic +N node, unfoldable on demand", () => {
  const work = (i: number, turnId: string): FlowNode =>
    fnode({ id: `${turnId}:w${i}`, parentId: turnId, kind: "work", threadId: "thr_run", startedAt: NOW - (20 - i) * 1000, completedAt: NOW });
  const turnId = "thr_run:turn:t2";
  const shape = shapeFrom([
    fnode({ id: turnId, parentId: "thr_run", kind: "turn", threadId: "thr_run" }),
    ...Array.from({ length: WORK_SHOWN + 3 }, (_, i) => work(i, turnId)),
  ]);
  const index = indexShape(shape);
  const folded = flowChildren(turnId, index, new Set([turnId]), { foldWork: true });
  assert.equal(folded.length, WORK_SHOWN + 1);
  assert.equal(folded[0]?.kind, "more");
  assert.equal(folded[0]?.label, "+3 earlier steps");
  // The newest rows keep their order after the fold marker.
  assert.equal(folded[1]?.id, `${turnId}:w3`);
  assert.equal(folded[folded.length - 1]?.id, `${turnId}:w${WORK_SHOWN + 2}`);
  // Unfolding reveals everything the server kept.
  const unfolded = flowChildren(turnId, index, new Set([turnId, `${turnId}::all`]), { foldWork: true });
  assert.equal(unfolded.length, WORK_SHOWN + 3);
  assert.ok(!unfolded.some((n) => n.kind === "more"));
  // A short turn is never folded.
  const tiny = flowChildren("nope-turn", index, new Set(), { foldWork: true });
  assert.deepEqual(tiny, []);
});

test("activity flow: hideIdle drops idle thread rows only", () => {
  const shape = shapeFrom([
    fnode({ id: "project:a", parentId: "root", kind: "project" }),
    fnode({ id: "thr_run", parentId: "project:a", kind: "thread", threadId: "thr_run", status: "running" }),
    fnode({ id: "thr_idle", parentId: "project:a", kind: "thread", threadId: "thr_idle", status: "idle" }),
    fnode({ id: "thr_wait", parentId: "project:a", kind: "thread", threadId: "thr_wait", status: "waiting" }),
    fnode({ id: "t0", parentId: "thr_idle", kind: "work", threadId: "thr_idle" }),
  ]);
  const index = indexShape(shape);
  const visible = flowChildren("project:a", index, new Set(), { hideIdleThreads: true });
  assert.deepEqual(visible.map((n) => n.id), ["thr_run", "thr_wait"]);
  const all = flowChildren("project:a", index, new Set(), { hideIdleThreads: false });
  assert.equal(all.length, 3);
});

test("activity flow: ages — threads age since meta.updated; running work shows running time; done work shows duration", () => {
  const threadNode = fnode({ id: "thr_x", kind: "thread", threadId: "thr_x", meta: { updated: String(NOW - 5 * 60000) } });
  assert.equal(flowAge(threadNode, NOW), "5m");
  const runningWork = fnode({ kind: "work", status: "running", startedAt: NOW - 93000, completedAt: null });
  assert.match(flowAge(runningWork, NOW), /running/);
  const doneWork = fnode({ kind: "work", status: "done", startedAt: NOW - 240000, completedAt: NOW - 20000 });
  assert.equal(flowAge(doneWork, NOW), "<1m");
});

test("activity flow: tidy tree — expanded threads put turns one column right; no two cards overlap", () => {
  const shape = shapeFrom([
    fnode({ id: "root", parentId: null, kind: "root" }),
    fnode({ id: "project:a", parentId: "root", kind: "project" }),
    fnode({ id: "thr_run", parentId: "project:a", kind: "thread", threadId: "thr_run", status: "running" }),
    fnode({ id: "thr_run:turn:t1", parentId: "thr_run", kind: "turn", threadId: "thr_run" }),
    fnode({ id: "t1:w1", parentId: "thr_run:turn:t1", kind: "work", threadId: "thr_run" }),
    fnode({ id: "t1:w2", parentId: "thr_run:turn:t1", kind: "work", threadId: "thr_run" }),
    fnode({ id: "thr_idle", parentId: "project:a", kind: "thread", threadId: "thr_idle", status: "idle" }),
  ]);
  const open = flowDefaultOpen(shape);
  // Top scope: depth gate keeps turns locked even though the default policy
  // folds the newest turn of the running thread open.
  const { placed } = flowLayout(shape, open);
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  assert.ok(byId.has("root"));
  assert.equal(byId.get("thr_run")?.x, NODE_W * 2 + COL_GAP * 2);
  assert.ok(!byId.has("thr_run:turn:t1")); // gated: no turns at top scope
  assert.ok(!byId.has("t1:w1") && !byId.has("t1:w2"));
  const idleRow = byId.get("thr_idle");
  assert.ok(idleRow !== undefined && idleRow.childCount === 0);
  // Pairwise overlap check on every placed card.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!, b = placed[j]!;
      const apart =
        a.x + NODE_W <= b.x + 0.001 || b.x + NODE_W <= a.x + 0.001 ||
        a.y + NODE_H <= b.y + 0.001 || b.y + NODE_H <= a.y + 0.001;
      assert.ok(apart, `cards ${a.node.id} and ${b.node.id} overlap at (${a.x},${a.y}) / (${b.x},${b.y})`);
    }
  }
  // Focused into the project, turns unlock and the default fold applies.
  const focused = flowLayout(shape, open, { scope: "project:a" });
  const fById = new Map(focused.placed.map((p) => [p.node.id, p]));
  assert.ok(fById.has("thr_idle")); // same project, filterless layout
  assert.equal(fById.get("thr_run:turn:t1")?.x, NODE_W * 3 + COL_GAP * 3);
  assert.ok(fById.has("t1:w1") && fById.has("t1:w2"));
});

test("activity flow: statusFilter drops excluded thread rows and projects left with none", () => {
  const shape = shapeFrom([
    fnode({ id: "root", parentId: null, kind: "root" }),
    fnode({ id: "project:a", parentId: "root", kind: "project" }),
    fnode({ id: "thr_hot", parentId: "project:a", kind: "thread", threadId: "thr_hot", status: "running" }),
    fnode({ id: "project:b", parentId: "root", kind: "project" }),
    fnode({ id: "thr_cold", parentId: "project:b", kind: "thread", threadId: "thr_cold", status: "idle" }),
  ]);
  const closed = new Set<string>();
  // The "Active only" preset in the view: every status but idle.
  const activeOnly = flowLayout(shape, closed, {
    statusFilter: new Set(["running", "waiting", "error", "queued"]),
  });
  const activeIds = activeOnly.placed.map((p) => p.node.id);
  assert.ok(activeIds.includes("project:a")); // keeps its hot thread visible when expanded
  assert.ok(!activeIds.includes("project:b")); // idle-only project disappears
  assert.ok(!activeIds.includes("thr_cold"));
  // Single-status chip: "error 4" keeps only error threads.
  const errorsOnly = flowLayout(shape, closed, { statusFilter: new Set(["error"]) });
  const errIds = errorsOnly.placed.map((p) => p.node.id);
  assert.ok(!errIds.includes("project:a"));
  assert.ok(!errIds.includes("thr_hot"));
});

test("activity flow: sibling subtree heights do not compound — deep-tree tops stay linear", () => {
  // Regression: walk() returned absolute bottoms as subtree heights, so each
  // later sibling accumulated the whole preceding bottom (live shape exploded
  // to ~4M px while tests with tiny tops passed).
  const nodes = [
    fnode({ id: "root", parentId: null, kind: "root", threadId: null }),
  ];
  for (let i = 0; i < 5; i++) {
    nodes.push(fnode({ id: `project:${i}`, parentId: "root", kind: "project", threadId: null }));
    nodes.push(fnode({ id: `thr_${i}`, parentId: `project:${i}`, kind: "thread", threadId: `thr_${i}` }));
  }
  const shape = shapeFrom(nodes);
  // Projects open; every thread closed: five one-thread chains.
  const open = new Set(["root", "project:0", "project:1", "project:2", "project:3", "project:4"]);
  const { placed, H } = flowLayout(shape, open, { activeOnly: false });
  const linearMax = (placed.length + 1) * (NODE_H + ROW_GAP);
  const maxTop = Math.max(...placed.map((p) => p.y));
  assert.ok(maxTop < linearMax, `top exploded: ${maxTop} ≥ ${linearMax}`);
  assert.ok(H < linearMax + NODE_H, `H exploded: ${H}`);
});

test("activity flow: collapsed nodes hide their whole subtree; W/H cover the placed extent", () => {
  const shape = shapeFrom([
    fnode({ id: "root", parentId: null, kind: "root" }),
    fnode({ id: "project:a", parentId: "root", kind: "project" }),
    fnode({ id: "thr_1", parentId: "project:a", kind: "thread", threadId: "thr_1" }),
    fnode({ id: "thr_1:turn:t1", parentId: "thr_1", kind: "turn", threadId: "thr_1" }),
    fnode({ id: "t1:w1", parentId: "thr_1:turn:t1", kind: "work", threadId: "thr_1" }),
  ]);
  const closed = flowLayout(shape, new Set(["root"]), {});
  // A closed node still gets a card (it's the thing you expand); only its
  // descendants are hidden.
  assert.deepEqual(closed.placed.map((p) => p.node.id), ["root", "project:a"]);
  assert.equal(closed.W, NODE_W * 2 + COL_GAP);
  assert.equal(closed.H, NODE_H);

  const partial = flowLayout(shape, new Set(["root", "project:a"]), {});
  const ids = partial.placed.map((p) => p.node.id);
  assert.deepEqual(ids, ["root", "project:a", "thr_1"]);
  assert.equal(partial.W, NODE_W * 3 + COL_GAP * 2);
  // Single visible child chain, so vertical span is just one card.
  assert.equal(partial.H, NODE_H);
});

test("activity flow: scope gate — turns never expand at top scope, even when folded open", () => {
  const shape = shapeFrom([
    fnode({ id: "root", parentId: null, kind: "root" }),
    fnode({ id: "project:a", parentId: "root", kind: "project" }),
    fnode({ id: "thr_1", parentId: "project:a", kind: "thread", threadId: "thr_1", status: "running" }),
    fnode({ id: "thr_1:turn:t1", parentId: "thr_1", kind: "turn", threadId: "thr_1" }),
    fnode({ id: "t1:w1", parentId: "thr_1:turn:t1", kind: "work", threadId: "thr_1" }),
  ]);
  // User expanded everything, but the scope is top-level: turns stay locked.
  const everything = new Set(["root", "project:a", "thr_1", "thr_1:turn:t1"]);
  const top = flowLayout(shape, everything, { scope: null });
  const topIds = top.placed.map((p) => p.node.id);
  assert.ok(topIds.includes("thr_1"));
  assert.ok(!topIds.includes("thr_1:turn:t1"));
  const threadCard = top.placed.find((p) => p.node.id === "thr_1");
  assert.ok(threadCard !== undefined && threadCard.childCount === 0);
});

test("activity flow: focusing a project unlocks turns and hides other branches", () => {
  const shape = shapeFrom([
    fnode({ id: "root", parentId: null, kind: "root" }),
    fnode({ id: "project:a", parentId: "root", kind: "project" }),
    fnode({ id: "thr_1", parentId: "project:a", kind: "thread", threadId: "thr_1", status: "running" }),
    fnode({ id: "thr_1:turn:t1", parentId: "thr_1", kind: "turn", threadId: "thr_1" }),
    fnode({ id: "t1:w1", parentId: "thr_1:turn:t1", kind: "work", threadId: "thr_1" }),
    fnode({ id: "project:b", parentId: "root", kind: "project" }),
    fnode({ id: "thr_2", parentId: "project:b", kind: "thread", threadId: "thr_2", status: "running" }),
    fnode({ id: "thr_2:turn:t2", parentId: "thr_2", kind: "turn", threadId: "thr_2" }),
  ]);
  const open = new Set(["thr_1", "thr_1:turn:t1"]);
  const { placed } = flowLayout(shape, open, { scope: "project:a" });
  const ids = placed.map((p) => p.node.id);
  // Scope chain stays visible: root → project:a → thread → turn → work.
  assert.deepEqual(ids, ["root", "project:a", "thr_1", "thr_1:turn:t1", "t1:w1"]);
  // The fold did not include project:a, but the scope path expands it.
  assert.equal(placed[1]!.childCount, 1);
});

test("activity flow: focusing a thread isolates it in its project and beats the status filter", () => {
  const shape = shapeFrom([
    fnode({ id: "root", parentId: null, kind: "root" }),
    fnode({ id: "project:a", parentId: "root", kind: "project" }),
    fnode({ id: "thr_hot", parentId: "project:a", kind: "thread", threadId: "thr_hot", status: "running" }),
    fnode({ id: "thr_hot:turn:t1", parentId: "thr_hot", kind: "turn", threadId: "thr_hot" }),
    fnode({ id: "thr_cold", parentId: "project:a", kind: "thread", threadId: "thr_cold", status: "idle" }),
    fnode({ id: "project:b", parentId: "root", kind: "project" }),
    fnode({ id: "thr_other", parentId: "project:b", kind: "thread", threadId: "thr_other", status: "running" }),
  ]);
  const { placed } = flowLayout(shape, new Set(), { scope: "thr_cold", statusFilter: new Set(["running"]) });
  const ids = placed.map((p) => p.node.id);
  // The scoped idle thread survives the idle filter; hot threads outside
  // the scope do not appear; only the scope chain is laid out.
  assert.deepEqual(ids, ["root", "project:a", "thr_cold"]);
});

// ---------- treemap: family tints + zoom-to-project ----------

test("family tints rely on contiguous family cells in buildProjects", () => {
  const threads = [
    thread({ id: "p1", projectId: "proj", runtimeStatus: "active" }),
    thread({ id: "p1-c", parentThreadId: "p1" }),
    thread({ id: "p2", projectId: "proj", runtimeStatus: "error" }),
    thread({ id: "p2-c", parentThreadId: "p2", isUnread: true }),
    thread({ id: "p3", projectId: "proj" }),
  ];
  const { projects } = buildProjects(threads, [{ id: "proj", name: "P" }], NOW);
  const fams = projects[0].cells.map((c) => c.fam);
  // each family's cells must be one contiguous run of `fam` ids
  const seen = new Set<string>();
  let prev: string | null = null;
  for (const fam of fams) {
    if (fam !== prev) {
      assert.ok(!seen.has(fam), `family ${fam} is not contiguous`);
      seen.add(fam);
      prev = fam;
    }
  }
});

test("familyTints: each contiguous family run gets one palette slot; adjacent runs differ", () => {
  assert.deepEqual(familyTints(["a", "a", "b", "c", "c", "c"]), [0, 0, 1, 2, 2, 2]);
  // palette wrap reuses slots only for non-adjacent runs
  assert.deepEqual(familyTints(Array.from({ length: 7 }, (_, i) => `f${i}`)), [0, 1, 2, 3, 4, 5, 0]);
  // every tint index lands inside the palette
  for (const idx of familyTints(Array.from({ length: 20 }, (_, i) => `f${i}`))) {
    assert.ok(idx >= 0 && idx < FAMILY_TINTS.length);
  }
});

function approx(actual: number, expected: number, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ≈ ${expected}, got ${actual}`);
}

test("zoomToRect fills the viewport with padding, centers the region, clamps scale", () => {
  // width bound (1000-48)/200 = 4.76 vs height bound (400-48)/80 = 4.4 → height bound wins
  const t = zoomToRect({ x: 100, y: 50, w: 200, h: 80 }, 1000, 400, { pad: 24 });
  approx(t.scale, 4.4);
  approx(t.tx, 500 - 4.4 * 200); // centers region x-mid (200)
  approx(t.ty, 200 - 4.4 * 90); // centers region y-mid (90)
  // regions larger than the viewport never zoom out below 1×
  const big = zoomToRect({ x: 0, y: 0, w: 1400, h: 700 }, 1000, 400, { pad: 24 });
  assert.equal(big.scale, 1);
  // tiny regions clamp to maxScale
  const tiny = zoomToRect({ x: 5, y: 5, w: 10, h: 10 }, 1000, 400, { maxScale: 5 });
  assert.equal(tiny.scale, 5);
});

test("clampPan keeps the scaled world inside the viewport on every axis", () => {
  const v = clampPan(-5000, -2000, 2, 1000, 400, 1000, 400);
  // world is 2000×800 at 2×: tx ∈ [-1000, 0], ty ∈ [-400, 0]
  approx(v.tx, -1000);
  approx(v.ty, -400);
  const fit = clampPan(0, 0, 1, 1000, 400, 1000, 400);
  approx(fit.tx, 0);
  approx(fit.ty, 0);
});
