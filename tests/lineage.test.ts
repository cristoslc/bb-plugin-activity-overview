// Lineage helpers: cross-project spawn hints and delegation→child-thread
// links for the shape build. Pure records only, mirroring views/timeline.ts,
// so they unit test without any SDK import.
import assert from "node:assert/strict";
import { test } from "node:test";

import { delegationChildId, spawnHint, type LineageThread } from "../views/lineage.ts";

const parentThread: LineageThread = {
  id: "thr_parent",
  projectId: "proj_alpha",
  parentThreadId: null,
};
const byId = new Map<string, LineageThread>([["thr_parent", parentThread]]);

test("spawnHint: thread without a parent carries no hint", () => {
  const thread = { projectId: "proj_alpha", parentThreadId: null };
  assert.equal(spawnHint(thread, byId, () => "Alpha"), null);
});

test("spawnHint: same-project parent stays unwritten (delegation rows show it)", () => {
  const nameOf = new Map([["proj_alpha", "Alpha"]]);
  const thread = { projectId: "proj_alpha", parentThreadId: "thr_parent" };
  assert.equal(spawnHint(thread, byId, (p) => nameOf.get(p) ?? null), null);
});

test("spawnHint: cross-project parent resolves to the parent's project name", () => {
  const nameOf = new Map([["proj_alpha", "subsentinel project"]]);
  const child = { projectId: "proj_beta", parentThreadId: "thr_parent" };
  assert.equal(spawnHint(child, byId, (p) => nameOf.get(p) ?? null), "subsentinel project");
});

test("spawnHint: cross-project parent with no named project falls back to the id", () => {
  const child = { projectId: "proj_beta", parentThreadId: "thr_parent" };
  assert.equal(spawnHint(child, byId, () => null), "proj_alpha");
});

test("spawnHint: invisible parent (archived or hidden) says so plainly", () => {
  const child = { projectId: "proj_beta", parentThreadId: "thr_gone" };
  assert.equal(spawnHint(child, byId, () => "Alpha"), "archived or hidden thread");
});

test("delegationChildId: a resolvable childRef becomes the child thread id", () => {
  const ids = new Set(["thr_child"]);
  assert.equal(delegationChildId("thr_child", ids), "thr_child");
});

test("delegationChildId: non-string childRefs and unknown ids never link", () => {
  const ids = new Set(["thr_child"]);
  assert.equal(delegationChildId(null, ids), null);
  assert.equal(delegationChildId(42, ids), null);
  // A provider session id must not masquerade as a thread link.
  assert.equal(delegationChildId("ses_f2668fe4bffevJixz337cr82de", ids), null);
});