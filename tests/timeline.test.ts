// Turn normalization tests for views/timeline.ts (copied from agent-graph)
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTurns } from "../views/timeline.ts";

const NOW = Date.parse("2026-10-04T19:00:00Z");

test("normalizeTurns: prompt-then-work-then-reply merges into one turn; flat live rows keep their turnId", () => {
  const rows = [
    { kind: "conversation", role: "user", text: "fix the bug", id: "p1", createdAt: NOW - 60000 },
    { kind: "turn", turnId: "t1", status: "completed", startedAt: NOW - 50000, completedAt: NOW - 1000, children: [
      { kind: "work", id: "w1", startedAt: NOW - 40000, completedAt: NOW - 2000 },
    ] },
    { kind: "conversation", role: "assistant", text: "done", turnId: "t1" },
  ];
  const turns = normalizeTurns(rows, false);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.turnId, "t1");
  assert.equal(turns[0]?.children.length, 3); // prompt + turn children + reply
  assert.equal(turns[0]?.children[0]?.text, "fix the bug");
});

test("normalizeTurns: trailing prompt becomes a pending turn only while the thread runs; older pending turns demote to completed", () => {
  const live = [
    { kind: "conversation", role: "user", text: "new prompt", id: "p2", createdAt: NOW },
  ];
  assert.equal(normalizeTurns(live, false).length, 0);
  const pending = normalizeTurns(live, true);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.status, "pending");

  const mixed = [
    { kind: "conversation", role: "user", text: "old", id: "p3" },
    { kind: "work", turnId: "t1", status: "pending", id: "w1" },
    { kind: "conversation", role: "user", text: "new", id: "p4" },
  ];
  const turns = normalizeTurns(mixed, true);
  assert.equal(turns[0]?.status, "completed"); // demoted: not the newest
  assert.equal(turns[1]?.status, "pending");
});

test("normalizeTurns: bookkeeping turns with no work or conversation children still arrive as empty containers", () => {
  const rows = [
    { kind: "turn", turnId: "t_empt", status: "completed" },
    { kind: "work", turnId: "t_real", id: "w1" },
  ];
  const turns = normalizeTurns(rows, false);
  assert.deepEqual(turns.map((t) => t.turnId), ["t_empt", "t_real"]);
  assert.deepEqual(turns[0]?.children, []);
});