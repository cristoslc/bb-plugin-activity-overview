// Removal contract: the agent lanes and activity flow views stay deleted, but
// the token flow view has been revived as the swimlane flow-control view
// (approved mockup docs/user-experience/token-flow-swimlane-mockup.html). This
// guards against the lane/flow pipelines resurfacing as dead code or a dead
// token, while permitting the token flow's model, RPC, and provider-ribbon
// tokens.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as model from "../views/model.ts";

// Pipelines whose removal must stick (agent lanes + activity flow).
const REMOVED_EXPORTS = [
  "laneRows",
  "makeLaneCards",
  "indexShape",
  "flowDefaultOpen",
  "flowChildren",
  "flowAge",
  "flowLayout",
  "WORK_SHOWN",
  "NODE_W",
  "NODE_H",
  "COL_GAP",
  "ROW_GAP",
  "FLOW_COLORS",
];

test("removed views: the model exports none of the lane/activity-flow pipelines", () => {
  for (const name of REMOVED_EXPORTS) {
    assert.ok(!(name in model), `model still exports ${name}`);
  }
});

test("revived token flow: the model exports the swimlane pipeline", () => {
  for (const name of [
    "swimlaneLayout",
    "laneOf",
    "SWIMLANES",
    "buildForest",
    "subtreeFlow",
    "providerOfModel",
    "resampleWindow",
  ]) {
    assert.ok(name in model, `model is missing ${name}`);
  }
});

test("removed views: the tab bar carries the three aggregate views and token flow", () => {
  const src = readText("views/Views.tsx");
  const tabs = tabsFrom(src);
  assert.ok(tabs.includes("board") && tabs.includes("treemap") && tabs.includes("tiles"));
  assert.ok(tabs.includes("tokenflow"), "the token flow tab is restored");
  for (const stale of ["graph", "flow"]) {
    assert.ok(!tabs.includes(stale), `tab bar still carries ${stale}`);
  }
});

test("removed views: the activity flow backend helpers stay gone", () => {
  for (const path of ["views/lineage.ts"]) {
    assert.ok(!fileExists(path), `${path} still exists`);
  }
  const server = readText("server.ts");
  assert.ok(!server.includes("shape"), "server.ts still declares the activity-flow shape RPC");
});

// ---------- helpers ----------

import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);

function readText(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
}
function fileExists(rel: string): boolean {
  return existsSync(new URL(rel, ROOT));
}
function tabsFrom(src: string): string[] {
  const block = src.match(/const TABS = \[([\s\S]*?)\] as const/);
  assert.ok(block !== null, "no TABS list found in Views.tsx");
  return [...block[1]!.matchAll(/id: "([a-z0-9]+)"/g)].map((match) => match[1]!);
}
