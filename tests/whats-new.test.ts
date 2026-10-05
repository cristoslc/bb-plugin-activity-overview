// What's-new discipline tests, ported from the Focus Board plugin's scheme:
// CHANGELOG.md is the single source of truth, the modal feed derives from it
// (each bullet's bold lead sentence), and the pulse keys to version (stable)
// or the [Unreleased] group's content fingerprint (dev builds).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APP_VERSION,
  EMPTY_UNRELEASED_FINGERPRINT,
  LAST_SEEN_UNRELEASED_KEY,
  LAST_SEEN_VERSION_KEY,
  WHATS_NEW,
  compareVersions,
  entriesSince,
  hasUnseenWhatsNew,
  isPrereleaseVersion,
  unreleasedFingerprint,
  whatsNewEntriesFor,
} from "../lib/whats-new.ts";
import { parseUnreleasedChangelog } from "../lib/unreleased-changelog.ts";
import {
  leadFromBullet,
  parsePublishedChangelog,
} from "../lib/changelog-markdown.ts";
import { UNRELEASED_ITEMS } from "../lib/unreleased-changelog.generated.ts";
import { DERIVED_WHATS_NEW } from "../lib/whats-new.generated.ts";

// ---------- lockstep pins ----------

test("APP_VERSION stays in lockstep with package.json's version", () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  );
  assert.equal(APP_VERSION, pkg.version);
});

test("plugin storage keys are namespaced to this plugin", () => {
  assert.equal(LAST_SEEN_VERSION_KEY, "activity-overview:lastSeenVersion");
  assert.equal(LAST_SEEN_UNRELEASED_KEY, "activity-overview:lastSeenUnreleased");
});

// ---------- changelog → feed derivation ----------

test("the shipped app is a prerelease build on dev: APP_VERSION carries -dev", () => {
  assert.equal(isPrereleaseVersion(APP_VERSION), true);
});

test("every published CHANGELOG section yields a derived entry, newest first", () => {
  const published = parsePublishedChangelog(
    readFileSync(fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)), "utf8"),
  );
  const versions = DERIVED_WHATS_NEW.map((entry) => entry.version);
  assert.equal(versions.length, published.length);
  const sorted = [...versions].sort(compareVersions).reverse();
  assert.deepEqual(versions, sorted);
});

test("WHATS_NEW merges published entries newest first", () => {
  const published = parsePublishedChangelog(
    readFileSync(fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)), "utf8"),
  );
  assert.equal(WHATS_NEW.length, published.length);
  const sorted = [...WHATS_NEW].sort((a, b) => compareVersions(b.version, a.version));
  assert.deepEqual(WHATS_NEW.map((entry) => entry.version), sorted.map((entry) => entry.version));
});

test("entries carry leads (bold-lead bullets derive one item each)", () => {
  for (const entry of WHATS_NEW) {
    assert.ok(entry.items.length > 0, `entry ${entry.version} has items`);
    for (const item of entry.items) {
      assert.ok(item.lead.length > 0, `item in ${entry.version} has a lead`);
    }
  }
});

test("a prerelease APP_VERSION never needs a published entry", () => {
  // The Focus Board regression this guards: a hand-maintained feed needed a
  // placeholder entry for the dev version. Derivation needs none.
  if (isPrereleaseVersion(APP_VERSION)) {
    assert.equal(
      WHATS_NEW.some((entry) => entry.version === APP_VERSION),
      false,
    );
  }
});

// ---------- [Unreleased] group ----------

test("the generated unreleased group matches a parse of the changelog", () => {
  const markdown = readFileSync(
    fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)),
    "utf8",
  );
  assert.deepEqual(UNRELEASED_ITEMS, parseUnreleasedChangelog(markdown).items);
});

test("parseUnreleasedChangelog reads bullets, continuations, sub-bullets, hard stops", () => {
  const parsed = parseUnreleasedChangelog(
    [
      "intro prose",
      "## [Unreleased]",
      "",
      "### Added",
      "- first bullet opening",
      "  continuation joins with a space",
      "  - sub-bullet one",
      "    sub continuation",
      "  - sub-bullet two",
      "",
      "- second bullet",
      "## [1.0.0] - 2026-10-05",
    ].join("\n"),
  );
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].text, "first bullet opening continuation joins with a space");
  assert.deepEqual(parsed.items[0].children, ["sub-bullet one sub continuation", "sub-bullet two"]);
  assert.equal(parsed.items[1].text, "second bullet");
  assert.deepEqual(parsed.items[1].children, []);
});

test("a changelog without an [Unreleased] group parses empty", () => {
  assert.deepEqual(parseUnreleasedChangelog("## [1.0.0] - 2026-10-05\n").items, []);
});

// ---------- fingerprint → dev pulse ----------

test("the fingerprint is stable and content-sensitive", () => {
  assert.equal(unreleasedFingerprint(["same"]), unreleasedFingerprint(["same"]));
  assert.notEqual(unreleasedFingerprint(["a"]), unreleasedFingerprint(["a", "b"]));
  assert.notEqual(unreleasedFingerprint(["a", "b"]), unreleasedFingerprint(["b", "a"]));
});

test("the empty group's fingerprint differs from any bullet group's", () => {
  assert.equal(EMPTY_UNRELEASED_FINGERPRINT, unreleasedFingerprint([]));
  assert.notEqual(EMPTY_UNRELEASED_FINGERPRINT, unreleasedFingerprint(["something"]));
});

test("a prerelease build pulses on content when a standing group was never opened", () => {
  assert.equal(
    hasUnseenWhatsNew({
      runningVersion: "0.3.0-dev",
      lastSeenVersion: null,
      unreleasedFingerprint: unreleasedFingerprint(["a bullet"]),
      lastSeenUnreleasedFingerprint: null,
    }),
    true,
  );
});

test("a prerelease build pulses when the group changes after being opened", () => {
  const seen = unreleasedFingerprint(["old"]);
  assert.equal(
    hasUnseenWhatsNew({
      runningVersion: "0.3.0-dev",
      lastSeenVersion: null,
      unreleasedFingerprint: unreleasedFingerprint(["new"]),
      lastSeenUnreleasedFingerprint: seen,
    }),
    true,
  );
});

test("an empty [Unreleased] group never pulses, whatever the snapshot says", () => {
  assert.equal(
    hasUnseenWhatsNew({
      runningVersion: "0.3.0-dev",
      lastSeenVersion: null,
      unreleasedFingerprint: EMPTY_UNRELEASED_FINGERPRINT,
      lastSeenUnreleasedFingerprint: null,
    }),
    false,
  );
});

test("an opened, unchanged group stays quiet", () => {
  const fp = unreleasedFingerprint(["same"]);
  assert.equal(
    hasUnseenWhatsNew({
      runningVersion: "0.3.0-dev",
      lastSeenVersion: null,
      unreleasedFingerprint: fp,
      lastSeenUnreleasedFingerprint: fp,
    }),
    false,
  );
});

// ---------- stable-build version pulse ----------

test("a stable build pulses exactly when running > last seen", () => {
  assert.equal(
    hasUnseenWhatsNew({
      runningVersion: "0.3.0",
      lastSeenVersion: "0.2.0",
      unreleasedFingerprint: EMPTY_UNRELEASED_FINGERPRINT,
      lastSeenUnreleasedFingerprint: null,
    }),
    true,
  );
  assert.equal(
    hasUnseenWhatsNew({
      runningVersion: "0.3.0",
      lastSeenVersion: "0.3.0",
      unreleasedFingerprint: EMPTY_UNRELEASED_FINGERPRINT,
      lastSeenUnreleasedFingerprint: null,
    }),
    false,
  );
  // A fresh install is stamped silently — everything is new, nothing counts.
  assert.equal(
    hasUnseenWhatsNew({
      runningVersion: "0.3.0",
      lastSeenVersion: null,
      unreleasedFingerprint: EMPTY_UNRELEASED_FINGERPRINT,
      lastSeenUnreleasedFingerprint: null,
    }),
    false,
  );
});

test("compareVersions is segment-numeric with semver prerelease order", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.ok(compareVersions("0.3.0", "0.3.0-dev") > 0); // suffix sorts below bare
  assert.ok(compareVersions("0.3.1-dev", "0.3.0-dev") > 0);
  assert.ok(compareVersions("0.3", "0.3.0") === 0);
  assert.ok(compareVersions("0.3.0", "0.2.9") > 0);
});

// ---------- entriesSince / whatsNewEntriesFor ----------

test("entriesSince returns entries strictly newer than lastSeen, newest first", () => {
  // WHATS_NEW is the real feed; entriesSince filters it.
  const since = entriesSince("0.2.0");
  assert.ok(since.every((entry) => compareVersions(entry.version, "0.2.0") > 0));
  for (let i = 1; i < since.length; i += 1) {
    assert.ok(compareVersions(since[i - 1].version, since[i].version) >= 0);
  }
  assert.deepEqual(entriesSince(null), []); // fresh install: nothing to show
});

test("a prerelease build leads the modal with its unreleased group", () => {
  const entries = whatsNewEntriesFor("0.3.0-dev", true, "0.2.0");
  assert.equal(entries[0].unreleased, true);
  assert.equal(entries[0].version, "0.3.0-dev");
  assert.ok(entries[0].items.length > 0);
  // Behind it, the published feed — nothing runs newer than the last stable
  // release yet, so the unreleased group stands alone here. The ordering
  // rule of the merged feed is pinned by the WHATS_NEW sort test.
  assert.deepEqual(entries.slice(1), []);
});

test("a stable build with a pending update shows only the delta", () => {
  const entries = whatsNewEntriesFor("0.3.0", true, "0.2.0");
  assert.deepEqual(
    entries.map((entry) => entry.version),
    WHATS_NEW.filter((entry) => compareVersions(entry.version, "0.2.0") > 0).map(
      (entry) => entry.version,
    ),
  );
});

test("a stable build without a pending update shows the full recent feed", () => {
  const entries = whatsNewEntriesFor("0.3.0", false, "0.3.0");
  assert.deepEqual(
    entries.map((entry) => entry.version),
    WHATS_NEW.map((entry) => entry.version),
  );
});

// ---------- leadFromBullet ----------

test("leadFromBullet takes a closing bold lead as the whole first sentence", () => {
  assert.equal(leadFromBullet("**Views reflow to width.** Detail about packing."), "Views reflow to width.");
});

test("leadFromBullet extends a run-through bold lead through its first sentence", () => {
  assert.equal(
    leadFromBullet("**Lanes nest, per depth** instead of per project."),
    "Lanes nest, per depth instead of per project.",
  );
});

test("leadFromBullet falls back to the first sentence without a bold lead", () => {
  assert.equal(leadFromBullet("Plain bullet. More prose."), "Plain bullet.");
});

test("leadFromBullet strips ticket refs and ensures terminal punctuation", () => {
  assert.equal(leadFromBullet("**The fix landed (#12)** in the flow view"), "The fix landed in the flow view.");
});