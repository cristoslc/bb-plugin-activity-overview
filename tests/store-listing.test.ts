// Contract tests for the store listing (lib/store-listing.ts): the marketplace's
// overview markdown rules, the entry shape, the screenshot budget, and the
// repo's real entry + overview. The real screenshots are validated by
// `npm run store:check` (which reads the committed PNGs); these tests stay
// hermetic by driving the budget logic with synthetic reports.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  OVERVIEW_MAX_CHARS,
  expectedPluginId,
  pngDimensions,
  validateEntryShape,
  validateListing,
  validateOverview,
  type ScreenshotReport,
  type StoreEntry,
} from "../lib/store-listing.ts";

const repo = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

test("expectedPluginId strips the bb-plugin- prefix", () => {
  assert.equal(expectedPluginId("bb-plugin-activity-overview"), "activity-overview");
  assert.equal(expectedPluginId("some-plugin"), "some-plugin");
});

test("validateOverview accepts the repo's own overview", async () => {
  const text = await readFile(`${repo}/PLUGIN_OVERVIEW.md`, "utf8");
  assert.deepEqual(validateOverview(text), []);
});

test("validateOverview enforces the 4000-char cap", () => {
  const text = "a".repeat(OVERVIEW_MAX_CHARS + 1);
  assert.match(validateOverview(text).join("; "), /over the 4000 cap/);
  assert.deepEqual(validateOverview("a".repeat(OVERVIEW_MAX_CHARS)), []);
});

test("validateOverview rejects each forbidden construct", () => {
  const cases: Array<[string, RegExp]> = [
    ["text with <div>raw html</div>", /raw HTML/],
    ["an image ![alt](./x.png)", /contains an image/],
    ["| a | b |\n| - | - |", /contains a table/],
    ["a footnote[^1]", /contains a footnote/],
    ["- [ ] a task", /contains a task list/],
    ["a link [x](http://example.com)", /not absolute https/],
    ["a bare link http://example.com", /not https/],
  ];
  for (const [text, pattern] of cases) {
    assert.match(validateOverview(text).join("; "), pattern, `expected "${text}" to be rejected`);
  }
});

test("validateOverview does not mistake an autolink for HTML", () => {
  assert.deepEqual(validateOverview("See <https://example.com> for more."), []);
});

test("validateOverview accepts the allowed subset", () => {
  const ok = [
    "# Title",
    "A paragraph with **strong**, *emphasis*, ~~strike~~, and `code`.",
    "- a list item",
    "[a link](https://example.com)",
    "> a blockquote",
    "```",
    "code block",
    "```",
    "---",
  ].join("\n\n");
  assert.deepEqual(validateOverview(ok), []);
});

test("validateEntryShape flags missing or wrongly-typed fields", () => {
  const problems = validateEntryShape({ id: "x" });
  assert.ok(problems.some((p) => p.includes("displayName")));
  assert.ok(problems.some((p) => p.includes("source.git.url")));
  assert.ok(problems.some((p) => p.includes("author.name")));
});

test("pngDimensions reads the IHDR width and height", () => {
  // A minimal 1200x900 PNG header: signature + IHDR chunk.
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1200);
  view.setUint32(20, 900);
  assert.deepEqual(pngDimensions(bytes), { width: 1200, height: 900 });
  assert.equal(pngDimensions(new Uint8Array([1, 2, 3])), null);
});

/** A listing whose every screenshot resolves to a valid 2400px PNG. */
function goodListing(over: Partial<StoreEntry> = {}): { entry: StoreEntry; reports: ScreenshotReport[] } {
  const entry: StoreEntry = {
    id: "activity-overview",
    displayName: "Activity Overview",
    description: "d",
    icon: "Activity",
    tags: ["t"],
    author: { name: "Cristos L-C" },
    category: "thread-management",
    source: { git: { url: "https://github.com/cristoslc/bb-plugin-activity-overview.git", range: "^0.4.0" } },
    screenshots: ["./screenshots/activity-overview/board-dark.png"],
    overview: "./overview/activity-overview.md",
    ...over,
  };
  const reports = entry.screenshots.map((path): ScreenshotReport => ({ path, found: true, bytes: 500_000, width: 2400 }));
  return { entry, reports };
}

const ctx = (entry: StoreEntry, reports: ScreenshotReport[]) => ({
  packageName: "bb-plugin-activity-overview",
  sourceUrl: "https://github.com/cristoslc/bb-plugin-activity-overview",
  overviewText: "ok",
  screenshots: reports,
});

test("validateListing accepts a well-formed listing", () => {
  const { entry, reports } = goodListing();
  assert.deepEqual(validateListing(entry, ctx(entry, reports)), []);
});

test("validateListing catches an id that drifts from the package name", () => {
  const { entry, reports } = goodListing({ id: "wrong" });
  assert.match(validateListing(entry, ctx(entry, reports)).join("; "), /must be the package id/);
});

test("validateListing catches a missing screenshot file", () => {
  const { entry, reports } = goodListing();
  reports[0] = { ...reports[0], found: false, bytes: null, width: null };
  assert.match(validateListing(entry, ctx(entry, reports)).join("; "), /no local file/);
});

test("validateListing catches an undersized or oversized screenshot", () => {
  const narrow = goodListing();
  narrow.reports[0] = { ...narrow.reports[0], width: 800 };
  assert.match(validateListing(narrow.entry, ctx(narrow.entry, narrow.reports)).join("; "), /under the 1200px floor/);

  const heavy = goodListing();
  heavy.reports[0] = { ...heavy.reports[0], bytes: 3 * 1024 * 1024 };
  assert.match(validateListing(heavy.entry, ctx(heavy.entry, heavy.reports)).join("; "), /over the 2 MiB cap/);
});

test("validateListing caps the screenshot count at six", () => {
  const { entry } = goodListing();
  entry.screenshots = Array.from({ length: 7 }, (_, i) => `./screenshots/activity-overview/s${i}.png`);
  const reports = entry.screenshots.map((path): ScreenshotReport => ({ path, found: true, bytes: 1000, width: 2400 }));
  assert.match(validateListing(entry, ctx(entry, reports)).join("; "), /over the 6 cap/);
});

test("the repo's real entry and overview validate", async () => {
  const raw = await readFile(`${repo}/store/entry.json`, "utf8");
  const entry = JSON.parse(raw) as StoreEntry;
  const overviewText = await readFile(`${repo}/PLUGIN_OVERVIEW.md`, "utf8");
  // Shape is real; screenshot bytes are synthesized so the test does not need
  // the committed PNGs (store:check reads them).
  const reports = entry.screenshots.map((path): ScreenshotReport => ({ path, found: true, bytes: 500_000, width: 2400 }));
  const real = { ...ctx(entry, reports), overviewText };
  assert.deepEqual(validateEntryShape(entry), []);
  assert.deepEqual(validateListing(entry, real), []);
});
