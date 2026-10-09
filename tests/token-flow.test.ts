// Token flow (sankey) model tests: family grouping and layout invariants.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFamilies,
  providerOfModel,
  sankeyLayout,
  tokenFlowStatus,
  TOKEN_FLOW,
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
  assert.equal(fams[0]!.parentThreadId, "thr_gone");
  assert.equal(fams[0]!.threads[0]!.id, "thr_orphan");
});

test("tokenFlowStatus folds the seven shape statuses into five", () => {
  assert.equal(tokenFlowStatus("running"), "running");
  assert.equal(tokenFlowStatus("queued"), "waiting");
  assert.equal(tokenFlowStatus("interrupted"), "done");
  assert.equal(tokenFlowStatus("idle"), "idle");
});

test("layout: one shared scale — sums match across all three columns", () => {
  const threads = [
    fThread({ id: "t1", usedTokens: 1000 }),
    fThread({ id: "t2", usedTokens: 2000, model: "openai/gpt-5.2", provider: "openai" }),
    fThread({ id: "t3", usedTokens: 500, parentThreadId: "t1", model: "ollama/m", provider: "ollama" }),
  ];
  const l = sankeyLayout(threads);
  assert.ok(l.scale > 0);
  const provSum = l.providers.reduce((s, p) => s + p.slots.reduce((x, sl) => x + sl.h, 0), 0);
  const projSum = l.projects.reduce((s, p) => s + p.slots.reduce((x, sl) => x + sl.h, 0), 0);
  assert.equal(Math.round(provSum), Math.round(projSum));
  assert.equal(Math.round(provSum), Math.round(3500 * l.scale));
  // each thread has exactly two ribbon segments
  assert.equal(l.ribbons.length, threads.length * 2);
});

test("layout: provider slots ordered by family-member y (parallel rivers)", () => {
  const C = TOKEN_FLOW;
  const threads = [
    fThread({ id: "t_top", usedTokens: 4000 }),
    fThread({ id: "t_bottom", usedTokens: 1000, model: "openai/gpt", provider: "openai" }),
  ];
  const l = sankeyLayout(threads);
  for (const p of l.providers) {
    assert.ok(p.slots.every((s) => s.y >= C.TOP));
    for (let i = 1; i < p.slots.length; i++) {
      assert.ok(p.slots[i]!.y > p.slots[i - 1]!.y, "slots strictly stacked");
    }
  }
  // the wider thread takes the top slot in its provider face
  const wide = l.providers.find((p) => p.id === "anthropic");
  assert.equal(wide?.slots[0]?.threadId, "t_top");
});

test("layout: member rows keep the MIN_ROW floor; zones cover their members", () => {
  const C = TOKEN_FLOW;
  // Tiny scale forces every member row to its MIN_ROW floor.
  const threads = Array.from({ length: 30 }, (_, i) =>
    fThread({ id: `t${i}`, usedTokens: 1, title: `t${i}` }),
  );
  const l = sankeyLayout(threads);
  for (const fam of l.families) {
    for (const m of fam.members) assert.ok(m.h >= C.MIN_ROW - 0.001);
    const bottom = fam.zoneY + fam.zoneH;
    assert.ok(
      fam.members.every((m) => m.y >= fam.zoneY - 0.001 && m.y + m.h <= bottom + 0.001),
      "zone covers every member row",
    );
  }
});

test("layout: ribbons end on family faces; zero-token threads carry no ribbons", () => {
  const C = TOKEN_FLOW;
  const threads = [
    fThread({ id: "t1", usedTokens: 800 }),
    fThread({ id: "t0", usedTokens: 0 }),
  ];
  const l = sankeyLayout(threads);
  assert.equal(l.ribbons.length, 2); // only t1's two segments
  for (const r of l.ribbons) {
    assert.equal(r.x1, r.segment === 1 ? C.PX + C.FACE_PROV : C.JX + C.FACE_PROJ);
    assert.equal(r.x2, r.segment === 1 ? C.JX : C.FX);
    assert.ok(r.y1 > C.TOP && r.y1 < C.H - C.BOTTOM);
    assert.ok(r.y2 > C.TOP && r.y2 < C.H - C.BOTTOM);
    assert.ok(r.h > 0);
  }
});

test("layout is deterministic: same input, same output", () => {
  const threads = [
    fThread({ id: "t1", usedTokens: 900 }),
    fThread({ id: "t2", usedTokens: 300, model: "google/gemini", provider: "google" }),
  ];
  const a = JSON.stringify(sankeyLayout(threads));
  const b = JSON.stringify(sankeyLayout([...threads].reverse()));
  assert.equal(a, b);
});