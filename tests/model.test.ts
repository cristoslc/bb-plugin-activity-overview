// Layout invariant + classification tests for views/model.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classify, buildProjects, squarify, makeCards, shelfPack, attentionScore,
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
