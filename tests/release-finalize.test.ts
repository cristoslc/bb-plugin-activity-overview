// Contract tests for the release finalize transforms (scripts/release/finalize.mjs):
// the [Unreleased] → [X.Y.Z] rename with its fresh empty group, and the -dev
// strip across the three version carriers (package.json, package-lock.json,
// APP_VERSION in lib/whats-new.ts). Pure functions over strings — hermetic
// fixtures, no filesystem, no git.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finalizeChangelog,
  releaseVersionFromDev,
  stripDevFromPackageJson,
  stripDevFromPackageLock,
  stripDevFromWhatsNewTs,
} from "../scripts/release/finalize.mjs";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- **New thing.** It works.",
  "",
  "### Fixed",
  "",
  "- **Old bug.** Fixed now.",
  "",
  "## [0.3.0] - 2026-10-18",
  "",
  "### Added",
  "",
  "- **Earlier thing.** Shipped.",
  "",
].join("\n");

test("releaseVersionFromDev strips the -dev suffix", () => {
  assert.equal(releaseVersionFromDev("0.4.0-dev"), "0.4.0");
  assert.equal(releaseVersionFromDev("1.0.0-dev"), "1.0.0");
});

test("releaseVersionFromDev refuses anything that is not X.Y.Z-dev", () => {
  assert.throws(() => releaseVersionFromDev("0.4.0"), /-dev/);
  assert.throws(() => releaseVersionFromDev("0.4.0-dev.2"), /-dev/);
  assert.throws(() => releaseVersionFromDev("v0.4.0-dev"), /-dev/);
  assert.throws(() => releaseVersionFromDev(""), /-dev/);
  assert.throws(() => releaseVersionFromDev(undefined as never), /-dev/);
});

test("finalizeChangelog renames [Unreleased] and adds a fresh empty group above it", () => {
  const out = finalizeChangelog(CHANGELOG, "0.4.0", "2026-11-03");
  const lines = out.split("\n");
  const fresh = lines.indexOf("## [Unreleased]");
  const released = lines.indexOf("## [0.4.0] - 2026-11-03");
  const published = lines.indexOf("## [0.3.0] - 2026-10-18");
  assert.ok(fresh !== -1, "fresh [Unreleased] group exists");
  assert.ok(released !== -1, "renamed section exists with the date");
  assert.ok(published !== -1, "published section survives");
  assert.ok(fresh < released, "fresh group sits above the renamed section");
  assert.ok(released < published, "renamed section sits above the older published one");
  // The fresh group is empty: nothing but blank lines between it and the renamed heading.
  const between = lines.slice(fresh + 1, released);
  assert.deepEqual(between.filter((l) => l.trim() !== ""), []);
});

test("finalizeChangelog carries the bullets into the renamed section verbatim", () => {
  const out = finalizeChangelog(CHANGELOG, "0.4.0", "2026-11-03");
  assert.equal(out.split("- **New thing.** It works.").length, 2, "Added bullet present exactly once");
  assert.equal(out.split("- **Old bug.** Fixed now.").length, 2, "Fixed bullet present exactly once");
});

test("finalizeChangelog refuses a changelog with no [Unreleased] group", () => {
  const published = CHANGELOG.split("## [Unreleased]")[1] ?? "";
  const text = "# Changelog\n\n## [0.3.0] - 2026-10-18\n" + published;
  assert.throws(() => finalizeChangelog(text, "0.4.0", "2026-11-03"), /Unreleased/);
});

test("finalizeChangelog refuses a duplicated [Unreleased] group", () => {
  const text = CHANGELOG + "\n## [Unreleased]\n";
  assert.throws(() => finalizeChangelog(text, "0.4.0", "2026-11-03"), /more than one/);
});

test("finalizeChangelog refuses when the version section already exists", () => {
  const text = CHANGELOG.replace("## [0.3.0] - 2026-10-18", "## [0.4.0] - 2026-11-01");
  assert.throws(() => finalizeChangelog(text, "0.4.0", "2026-11-03"), /already has a \[0\.4\.0\]/);
});

test("finalizeChangelog renames an empty group (the --allow-empty path)", () => {
  const empty = "# Changelog\n\n## [Unreleased]\n\n## [0.3.0] - 2026-10-18\n\n- **Earlier.** Shipped.\n";
  const out = finalizeChangelog(empty, "0.5.0", "2026-11-03");
  const lines = out.split("\n");
  const fresh = lines.indexOf("## [Unreleased]");
  const released = lines.indexOf("## [0.5.0] - 2026-11-03");
  assert.ok(fresh !== -1 && released !== -1 && fresh < released);
  assert.deepEqual(lines.slice(fresh + 1, released).filter((l) => l.trim() !== ""), []);
  assert.ok(out.includes("- **Earlier.** Shipped."), "older bullets untouched");
});

test("stripDevFromPackageJson strips the root version in place", () => {
  const pkg = '{\n  "name": "bb-plugin-activity-overview",\n  "version": "0.4.0-dev",\n  "type": "module"\n}\n';
  const out = stripDevFromPackageJson(pkg, "0.4.0");
  assert.ok(out.includes('"version": "0.4.0"'));
  assert.ok(!out.includes("0.4.0-dev"));
  assert.equal(out, pkg.replace('"0.4.0-dev"', '"0.4.0"'), "only the version token moved");
});

test("stripDevFromPackageJson refuses a file without the -dev version", () => {
  assert.throws(() => stripDevFromPackageJson('{"version": "0.4.0"}', "0.4.0"), /exactly 1/);
  assert.throws(() => stripDevFromPackageJson('{"name": "x"}', "0.4.0"), /exactly 1/);
});

test("stripDevFromPackageLock strips exactly the two lockfile version sites", () => {
  const lock = [
    "{",
    '  "name": "bb-plugin-activity-overview",',
    '  "version": "0.4.0-dev",',
    '  "lockfileVersion": 3,',
    '  "packages": {',
    '    "": {',
    '      "name": "bb-plugin-activity-overview",',
    '      "version": "0.4.0-dev",',
    "    },",
    "  },",
    "}",
    "",
  ].join("\n");
  const out = stripDevFromPackageLock(lock, "0.4.0");
  assert.equal(out.split('"version": "0.4.0"').length - 1, 2, "both sites stripped");
  assert.ok(!out.includes("0.4.0-dev"));
});

test("stripDevFromPackageLock refuses when the two-site count does not hold", () => {
  assert.throws(() => stripDevFromPackageLock('{"version": "0.4.0-dev"}', "0.4.0"), /exactly 2/);
  assert.throws(
    () => stripDevFromPackageLock('{"version": "0.4.0"}', "0.4.0"),
    /exactly 2/,
  );
});

test("stripDevFromWhatsNewTs strips APP_VERSION in place", () => {
  const ts = 'export const APP_VERSION = "0.4.0-dev";\n';
  const out = stripDevFromWhatsNewTs(ts, "0.4.0");
  assert.equal(out, 'export const APP_VERSION = "0.4.0";\n');
});

test("stripDevFromWhatsNewTs refuses a mismatched or missing stamp", () => {
  assert.throws(() => stripDevFromWhatsNewTs('export const APP_VERSION = "0.3.0-dev";\n', "0.4.0"), /exactly 1/);
  assert.throws(() => stripDevFromWhatsNewTs("export const APP_VERSION = \"0.4.0\";\n", "0.4.0"), /exactly 1/);
});
