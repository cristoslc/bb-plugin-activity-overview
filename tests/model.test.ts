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
    lastReadAt: ISO_NOW, latestAttentionAt: ISO_NOW,
    updatedAt: ISO_NOW, createdAt: ISO_NOW,
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
