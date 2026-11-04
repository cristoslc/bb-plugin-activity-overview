// Contract tests for the release plan (scripts/release/plan.mjs): the
// precondition refusals, the mandatory UAT-suite discovery, the blocking gate
// order, and the mutation-step order. Pure functions — every test feeds a
// synthetic state object, no git, no filesystem beyond the repo parsers.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReleasePlan,
  commitSubject,
  discoverSuites,
  gateStages,
  leadSummaryFromChangelog,
} from "../scripts/release/plan.mjs";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- **New thing exists now.** It works.",
  "",
  "## [0.3.0] - 2026-10-18",
  "",
  "- **Earlier.** Shipped.",
  "",
].join("\n");

const OK_STATE = {
  branch: "dev",
  dirty: false,
  headInSyncWithGhDev: true,
  version: "0.4.0-dev",
  tagLocalExists: false,
  tagRemoteExists: false,
  changelog: CHANGELOG,
  suites: ["uat-a.yaml", "uat-b.yaml"],
  signingConfigured: true,
  mainWorktree: { path: "/repo", clean: true, midMerge: false },
  mainCanFastForward: true,
};

const plan = (over = {}, opts = {}) => buildReleasePlan({ ...OK_STATE, ...over }, opts);

test("a clean dev state produces a plan with no refusals", () => {
  const p = plan();
  assert.deepEqual(p.refusals, []);
  assert.equal(p.version, "0.4.0");
});

test("gate stages run in the fixed order and the UAT stage passes no suite args", () => {
  assert.deepEqual(
    plan().gateStages.map((s) => s.name),
    ["test", "typecheck", "build", "uat", "store:check", "release-shots"],
  );
  const uat = plan().gateStages.find((s) => s.name === "uat");
  assert.deepEqual(uat.args, ["run", "uat"], "no suite args — the runner discovers every suite");
  // The build must precede the UAT sweep (the harness serves dist/) and the shots.
  const names = plan().gateStages.map((s) => s.name);
  assert.ok(names.indexOf("build") < names.indexOf("uat"));
  assert.ok(names.indexOf("build") < names.indexOf("release-shots"));
  assert.ok(names.indexOf("store:check") < names.indexOf("release-shots"));
});

test("gateStages() is exported standalone with the same order", () => {
  assert.deepEqual(gateStages().map((s) => s.name), [
    "test",
    "typecheck",
    "build",
    "uat",
    "store:check",
    "release-shots",
  ]);
});

test("mutation steps run finalize → feeds → commit → rebuild → tag → verify → promote → push → store", () => {
  const names = plan().mutationSteps.map((s) => s.name);
  assert.deepEqual(names, [
    "finalize-files",
    "regenerate-feeds",
    "commit",
    "rebuild",
    "tag",
    "verify-tag",
    "promote-main",
    "push",
    "store-build",
  ]);
});

test("the promote step targets main's own checkout when one exists", () => {
  const step = plan().mutationSteps.find((s) => s.name === "promote-main");
  assert.match(step.detail, /\/repo/);
  assert.match(step.detail, /--ff-only/);
});

test("refusal: dirty working tree", () => {
  assert.match(plan({ dirty: true }).refusals.join("; "), /dirty/);
});

test("refusal: not on dev", () => {
  assert.match(plan({ branch: "bb/some-thread" }).refusals.join("; "), /dev/);
});

test("refusal: HEAD out of sync with gh/dev", () => {
  assert.match(plan({ headInSyncWithGhDev: false }).refusals.join("; "), /gh\/dev/);
});

test("refusal: version does not carry -dev", () => {
  assert.match(plan({ version: "0.4.0" }).refusals.join("; "), /-dev/);
});

test("refusal: tag already exists locally", () => {
  assert.match(plan({ tagLocalExists: true }).refusals.join("; "), /tag/);
});

test("refusal: tag already exists on the remote", () => {
  assert.match(plan({ tagRemoteExists: true }).refusals.join("; "), /tag/);
});

test("refusal: CHANGELOG already has the version section", () => {
  const changelog = CHANGELOG.replace("## [0.3.0] - 2026-10-18", "## [0.4.0] - 2026-11-01");
  assert.match(plan({ changelog }).refusals.join("; "), /already has a \[0\.4\.0\]/);
});

test("refusal: empty [Unreleased] without --allow-empty, allowed with it", () => {
  const changelog = CHANGELOG.replace(
    "- **New thing exists now.** It works.\n",
    "",
  );
  const without = plan({ changelog });
  assert.match(without.refusals.join("; "), /--allow-empty/);
  const withFlag = plan({ changelog }, { allowEmpty: true });
  assert.deepEqual(withFlag.refusals, []);
  assert.equal(withFlag.version, "0.4.0");
});

test("refusal: zero discovered UAT suites — the sweep is mandatory", () => {
  assert.match(plan({ suites: [] }).refusals.join("; "), /no UAT suites/);
});

test("refusal: tag signing not configured", () => {
  assert.match(plan({ signingConfigured: false }).refusals.join("; "), /signing/);
});

test("refusal: main's checkout is dirty or mid-merge", () => {
  const dirty = plan({ mainWorktree: { path: "/repo", clean: false, midMerge: false } });
  assert.match(dirty.refusals.join("; "), /dirty/);
  const merging = plan({ mainWorktree: { path: "/repo", clean: true, midMerge: true } });
  assert.match(merging.refusals.join("; "), /merge in flight/);
});

test("refusal: main cannot fast-forward (diverged)", () => {
  assert.match(plan({ mainCanFastForward: false }).refusals.join("; "), /fast-forward/);
});

test("refusals accumulate — every problem is reported in one pass", () => {
  const p = plan({ dirty: true, branch: "bb/x", signingConfigured: false });
  assert.ok(p.refusals.length >= 3);
});

test("discoverSuites takes every .yaml in tests/manual, sorted", () => {
  const suites = discoverSuites([
    "uat-treemap-tiles.yaml",
    "README.md",
    "uat-dot-open-thread.yaml",
    "stray.txt",
    "uat-filters-cross-view.yaml",
  ]);
  assert.deepEqual(suites, ["uat-dot-open-thread.yaml", "uat-filters-cross-view.yaml", "uat-treemap-tiles.yaml"]);
});

test("commitSubject names the version and condenses the lead bullet", () => {
  assert.equal(
    commitSubject("0.4.0", "New thing exists now"),
    "Release 0.4.0: New thing exists now",
  );
});

test("leadSummaryFromChangelog extracts the first bullet's bold lead, period stripped", () => {
  assert.equal(leadSummaryFromChangelog(CHANGELOG), "New thing exists now");
});

test("leadSummaryFromChangelog returns null for an empty group", () => {
  const empty = CHANGELOG.replace("- **New thing exists now.** It works.\n", "");
  assert.equal(leadSummaryFromChangelog(empty), null);
});
