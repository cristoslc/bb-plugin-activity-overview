/**
 * Build (and validate) the bb community marketplace drop for this plugin.
 *
 * The marketplace (github.com/get-bb/marketplace) is the store: one
 * `entries/<plugin-id>.json`, an optional `overview/<plugin-id>.md`, and up to
 * six `screenshots/<plugin-id>/…` files. This repo owns the sources — the
 * authored entry (`store/entry.json`), the evergreen overview
 * (`PLUGIN_OVERVIEW.md`), and the committed screenshots (`docs/screenshots/`,
 * produced by `scripts/screenshot/shoot.mjs`) — and this script validates them
 * against the marketplace's own rules and assembles a ready-to-copy drop under
 * `dist/store/` (a dedicated, gitignored output dir; nothing is written into a
 * served checkout's committed evidence).
 *
 * Usage:
 *   npm run store:build     # validate + assemble dist/store/
 *   npm run store:check     # validate only (no files written)
 *
 * Exits non-zero on any violation — a listing that fails here must never be
 * submitted.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pngDimensions,
  validateListing,
  type ScreenshotReport,
  type StoreEntry,
} from "../../lib/store-listing.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const STORE_SOURCE = path.join(repo, "store");
const SCREENSHOT_SOURCE_DIR = path.join(repo, "docs", "screenshots");
const OUT_DIR = path.join(repo, "dist", "store");
const write = process.argv.includes("--write");

const pkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")) as {
  name: string;
  bb?: { description?: string };
};
const entry = JSON.parse(await readFile(path.join(STORE_SOURCE, "entry.json"), "utf8")) as StoreEntry;
const overviewText = await readFile(path.join(repo, "PLUGIN_OVERVIEW.md"), "utf8");

let sourceUrl: string;
try {
  sourceUrl = execFileSync("git", ["remote", "get-url", "gh"], { cwd: repo, encoding: "utf8" }).trim();
} catch {
  sourceUrl = entry.source.git.url;
  console.warn(`store: could not read the "gh" remote; using the entry's source url (${sourceUrl})`);
}

// Resolve each referenced screenshot: marketplace path ./screenshots/<id>/<name>
// maps to the committed source docs/screenshots/<name>.
const reports: ScreenshotReport[] = [];
for (const ref of entry.screenshots) {
  const name = path.basename(ref);
  const source = path.join(SCREENSHOT_SOURCE_DIR, name);
  if (!existsSync(source)) {
    reports.push({ path: ref, found: false, bytes: null, width: null });
    continue;
  }
  const bytes = await readFile(source);
  const dims = pngDimensions(new Uint8Array(bytes));
  reports.push({ path: ref, found: true, bytes: bytes.byteLength, width: dims?.width ?? null });
}

const problems = validateListing(entry, {
  packageName: pkg.name,
  sourceUrl,
  overviewText,
  screenshots: reports,
});

if (problems.length > 0) {
  console.error(`store: ${problems.length} problem(s) — the listing is not submittable:`);
  for (const problem of problems) console.error(`  × ${problem}`);
  process.exit(1);
}

const overviewChars = overviewText.length;
console.log(`store: listing valid`);
console.log(`  id           ${entry.id}`);
console.log(`  displayName  ${entry.displayName}`);
console.log(`  source       ${entry.source.git.url} (${entry.source.git.range})`);
console.log(`  overview     ${overviewChars}/${4000} chars`);
for (const report of reports) {
  console.log(`  screenshot   ${report.path} — ${report.width}px, ${Math.round((report.bytes ?? 0) / 1024)} KiB`);
}

if (!write) {
  console.log("store: check only (pass --write or run `npm run store:build` to assemble dist/store/)");
  process.exit(0);
}

// Assemble the ready-to-copy marketplace drop. The copy is the submission;
// nothing under here is committed (dist/ is gitignored).
await mkdir(path.join(OUT_DIR, "entries"), { recursive: true });
await mkdir(path.join(OUT_DIR, "overview"), { recursive: true });
await mkdir(path.join(OUT_DIR, "screenshots", entry.id), { recursive: true });
await writeFile(path.join(OUT_DIR, "entries", `${entry.id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
await writeFile(path.join(OUT_DIR, "overview", `${entry.id}.md`), overviewText);
for (const ref of entry.screenshots) {
  await copyFile(path.join(SCREENSHOT_SOURCE_DIR, path.basename(ref)), path.join(OUT_DIR, "screenshots", entry.id, path.basename(ref)));
}
const files = await readdir(path.join(OUT_DIR, "screenshots", entry.id));
console.log(`store: assembled dist/store/ (entries/${entry.id}.json, overview/${entry.id}.md, screenshots/${entry.id}/${files.length} files)`);
