// Layout invariant + classification tests for views/model.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classify, buildProjects, buildAgentTree,
  squarify, makeCards, shelfPack, attentionScore,
  familyTints, FAMILY_TINTS, zoomToRect, clampPan, clampPanEdges,
  treemapMarkMode, tileForSlot, tileGutter, TILE_GUTTER, ZOOMED_IN_SCALE,
  type AttnThread, type AttnProject,
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
  const fam = buildAgentTree(threads);
  assert.equal(fam.visible.length, 2);
  assert.deepEqual(fam.roots.map((t) => t.id).sort(), ["a", "b"]);
  assert.equal(fam.childrenOf.size, 0);
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

test("clampPanEdges keeps the top margin clear while honoring the bottom margin", () => {
  assert.equal(clampPanEdges(0, 800, 900, 60, 16), 60);
  assert.equal(clampPanEdges(500, 800, 900, 60, 16), 84); // bottom extreme
  assert.equal(clampPanEdges(0, 360, 900, 60, 16), 60);
  assert.equal(clampPanEdges(700, 360, 900, 60, 16), 524);
  assert.equal(clampPanEdges(-99, 2000, 1000, 16, 16), -99); // inside the band stays put
  assert.equal(clampPanEdges(-5000, 2000, 1000, 16, 16), -1016);
});

// ---------- treemap mark mode: full-fill tiles at fit, dots zoomed in ----------

test("treemapMarkMode: tiles at and below the zoomed-in threshold, dots past it", () => {
  assert.equal(treemapMarkMode(0.2), "tile"); // the zoom-out floor
  assert.equal(treemapMarkMode(1), "tile"); // the fitted view
  assert.equal(treemapMarkMode(1.19), "tile");
  assert.equal(treemapMarkMode(ZOOMED_IN_SCALE), "tile"); // boundary: strictly greater
  assert.equal(treemapMarkMode(1.2 + 1e-9), "dot");
  assert.equal(treemapMarkMode(5), "dot"); // the zoom-in ceiling
});

test("treemapMarkMode honours a custom threshold", () => {
  assert.equal(treemapMarkMode(1.5, 2), "tile");
  assert.equal(treemapMarkMode(2, 2), "tile"); // exactly at the threshold: not zoomed in
  assert.equal(treemapMarkMode(2.5, 2), "dot");
});

test("tileGutter scales with the pitch and clamps to its band", () => {
  approx(tileGutter(100), 100 * TILE_GUTTER.fraction); // mid-band: proportional
  assert.equal(tileGutter(10), TILE_GUTTER.min); // floor keeps one tile = one thread
  assert.equal(tileGutter(500), TILE_GUTTER.max); // ceiling keeps the void thin
  assert.throws(() => tileGutter(0)); // fail loud: a junk pitch must not paint NaN tiles
  assert.throws(() => tileGutter(Number.NaN));
});

test("tileForSlot fills the slot minus the gutter, centered", () => {
  const g = tileGutter(100);
  const t = tileForSlot(100, 100, 100);
  approx(t.w, 100 - g);
  approx(t.h, 100 - g);
  approx(t.dx, g / 2);
  approx(t.dy, g / 2);
  // a non-square slot fills each axis independently and stays centered
  const r = tileForSlot(300, 80, 100);
  approx(r.w, 300 - g);
  approx(r.h, 80 - g);
  approx(r.dx, g / 2);
  approx(r.dy, g / 2);
});

test("adjacent slots keep exactly one gutter of void between their tiles", () => {
  const cw = 90, ch = 60, pitch = 70;
  const a = tileForSlot(cw, ch, pitch);
  const b = tileForSlot(cw, ch, pitch); // b's slot starts where a's ends
  approx(cw + b.dx - (a.dx + a.w), tileGutter(pitch));
  approx(ch + b.dy - (a.dy + a.h), tileGutter(pitch));
});

test("a slot smaller than the gutter degenerates to a zero-size tile", () => {
  const t = tileForSlot(1, 1, 100);
  assert.equal(t.w, 0);
  assert.equal(t.h, 0);
});
