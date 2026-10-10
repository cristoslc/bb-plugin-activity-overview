// Removal contract: the agent lanes, activity flow, and token flow views are
// deleted. The model must carry no orphan pipeline exports for them, the theme
// must drop their tokens, and the tab bar must name only the three surviving
// aggregate views. Guards against a partially-removed view resurfacing as
// dead code or a dead token.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as model from "../views/model.ts";
import { THEME_CSS, THEME_TOKENS } from "../views/theme.ts";

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
  "PROVIDER_LABELS",
  "tokenFlowStatus",
  "buildFamilies",
  "sankeyLayout",
  "TOKEN_FLOW",
];

test("removed views: the model exports none of the lane/flow/token pipelines", () => {
  for (const name of REMOVED_EXPORTS) {
    assert.ok(!(name in model), `model still exports ${name}`);
  }
});

test("removed views: the theme declares no provider-ribbon or flow tokens", () => {
  const tokens = THEME_TOKENS as readonly string[];
  for (const name of tokens) {
    assert.ok(!name.startsWith("attn-prov"), `theme still declares provider token ${name}`);
    assert.ok(!name.includes("flow"), `theme still declares flow token ${name}`);
  }
  assert.ok(!THEME_CSS.includes("attn-prov"), "THEME_CSS still styles provider ribbons");
});

test("removed views: the tab bar carries only the three aggregate views", () => {
  const src = readText("views/Views.tsx");
  const tabs = tabsFrom(src);
  assert.deepEqual(tabs, ["board", "treemap", "tiles"]);
  for (const stale of ["graph", "flow", "tokenflow"]) {
    assert.ok(!tabs.includes(stale), `tab bar still carries ${stale}`);
  }
});

test("removed views: the flow backend helpers are gone and the backend is a stub", () => {
  for (const path of [
    "shared.ts",
    "views/TokenFlowView.tsx",
    "views/lineage.ts",
    "views/timeline.ts",
  ]) {
    assert.ok(!fileExists(path), `${path} still exists`);
  }
  // `bb plugin build` requires a server entry; the remaining one must be a
  // stub: it registers no RPCs, publishes nothing, and reads no timelines.
  const server = readText("server.ts");
  assert.ok(!server.includes("rpc"), "server.ts still declares RPC work");
  assert.ok(!server.includes("subscribe"), "server.ts still subscribes to events");
  assert.ok(!server.includes("timeline"), "server.ts still reads timelines");
  assert.ok(!fileExists("shared.ts") && !server.includes("SHAPE_CHANGED"), "realtime push contract still exists");
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