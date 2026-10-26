// Store-listing contract for the bb community marketplace, kept as one pure
// module so the build script (scripts/store/build-listing.ts) and its tests
// share exactly one definition of "a valid listing".
//
// The marketplace (github.com/get-bb/marketplace) takes one entry file per
// plugin plus an optional long-form `overview/<plugin-id>.md`. The entry's
// short description is the shelf copy; the overview is the detail-page copy and
// is written as a fixed set of capability pillars that do NOT churn with
// versions (the living README stays the version-chasing document). This module
// enforces the marketplace's own rules: the 4000-character overview cap, the
// markdown subset it accepts, and the screenshot budget (at most six files, PNG
// /JPEG/WebP, at most 2 MiB each, at least 1200 px wide).
//
// Nothing here is frontend code; it is deliberately dependency-free so it can
// be unit-tested under `node --test` and imported by a plain Node script.

export const OVERVIEW_MAX_CHARS = 4000;
export const SCREENSHOT_MAX_COUNT = 6;
export const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const SCREENSHOT_MIN_WIDTH = 1200;

export interface StoreAuthor {
  name: string;
  github?: string;
  url?: string;
}

export interface StoreEntry {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  tags: string[];
  author: StoreAuthor;
  category: string;
  source: { git: { url: string; range: string } };
  screenshots: string[];
  overview: string;
}

/** One referenced screenshot as resolved on disk (or not, when missing). */
export interface ScreenshotReport {
  /** The marketplace-relative path from the entry (`./screenshots/<id>/x.png`). */
  path: string;
  /** Whether a local source file was found for it. */
  found: boolean;
  bytes: number | null;
  width: number | null;
}

/** `bb-plugin-activity-overview` → `activity-overview`; other names pass through. */
export function expectedPluginId(packageName: string): string {
  const prefix = "bb-plugin-";
  return packageName.startsWith(prefix) ? packageName.slice(prefix.length) : packageName;
}

/** `…/repo.git` and `…/repo` compare equal. */
export function normalizeGitUrl(url: string): string {
  return url.trim().replace(/\.git$/, "").replace(/\/$/, "");
}

const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*?)?\/?>/g;
const IMAGE = /!\[[^\]]*\]\(/;
const TABLE_ROW = /^\s*\|/;
const FOOTNOTE = /\[\^[^\]]+\]/;
const TASK_ITEM = /^\s*[-*+]\s+\[[ xX]\]/;
const MARKDOWN_LINK = /\]\(([^)]+)\)/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * The overview's markdown rules, as a list of human-readable problems. Empty
 * means valid. Mirrors the marketplace README's accept/reject list.
 */
export function validateOverview(text: string): string[] {
  const problems: string[] = [];
  if (text.length > OVERVIEW_MAX_CHARS) {
    problems.push(`overview is ${text.length} chars, over the ${OVERVIEW_MAX_CHARS} cap`);
  }
  if (CONTROL_CHARS.test(text)) problems.push("overview contains control characters");

  const html = text.match(HTML_TAG);
  if (html !== null) problems.push(`overview contains raw HTML (${html[0]})`);
  if (IMAGE.test(text)) problems.push("overview contains an image");
  if (text.split("\n").some((line) => TABLE_ROW.test(line))) problems.push("overview contains a table");
  if (FOOTNOTE.test(text)) problems.push("overview contains a footnote");
  if (text.split("\n").some((line) => TASK_ITEM.test(line))) problems.push("overview contains a task list");

  // Every link must be an absolute https URL (the marketplace rejects others).
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const target = match[1].trim().split(/\s+/)[0];
    if (!target.startsWith("https://")) {
      problems.push(`overview link is not absolute https: ${target}`);
    }
  }
  for (const match of text.matchAll(/(?:^|[\s(])(https?:\/\/[^\s)]+)/g)) {
    if (!match[1].startsWith("https://")) problems.push(`overview bare link is not https: ${match[1]}`);
  }
  return problems;
}

/** Shape problems for a parsed entry (missing or wrongly-typed required fields). */
export function validateEntryShape(entry: unknown): string[] {
  const problems: string[] = [];
  if (typeof entry !== "object" || entry === null) return ["entry is not an object"];
  const e = entry as Record<string, unknown>;
  const str = (key: string) => (typeof e[key] === "string" && (e[key] as string).length > 0 ? null : `entry.${key} must be a non-empty string`);
  for (const key of ["id", "displayName", "description", "icon", "category", "overview"]) {
    const problem = str(key);
    if (problem !== null) problems.push(problem);
  }
  if (!Array.isArray(e.tags) || e.tags.some((t) => typeof t !== "string" || t.length === 0)) {
    problems.push("entry.tags must be a non-empty string array");
  }
  const author = e.author as Record<string, unknown> | undefined;
  if (typeof author?.name !== "string" || author.name.length === 0) problems.push("entry.author.name must be a non-empty string");
  const git = (e.source as { git?: Record<string, unknown> } | undefined)?.git;
  if (typeof git?.url !== "string" || git.url.length === 0) problems.push("entry.source.git.url must be a non-empty string");
  if (typeof git?.range !== "string" || git.range.length === 0) problems.push("entry.source.git.range must be a non-empty string");
  if (!Array.isArray(e.screenshots) || e.screenshots.some((s) => typeof s !== "string" || s.length === 0)) {
    problems.push("entry.screenshots must be a string array");
  }
  return problems;
}

/**
 * The PNG width/height from the IHDR chunk, or null when the bytes are not a
 * PNG. Only PNG is parsed here because the media runs emit PNG; the marketplace
 * also accepts JPEG/WebP, which a listing would validate by a different means.
 */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  for (let i = 0; i < signature.length; i += 1) if (bytes[i] !== signature[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Signature (8) + length (4) + "IHDR" (4) => width at 16, height at 20.
  const tag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (tag !== "IHDR") return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface ListingContext {
  /** The plugin package name (`bb-plugin-activity-overview`). */
  packageName: string;
  /** The git remote this entry distributes from. */
  sourceUrl: string;
  /** The overview markdown (PLUGIN_OVERVIEW.md). */
  overviewText: string;
  /** One report per referenced screenshot path. */
  screenshots: ScreenshotReport[];
}

/** Every problem with the entry, its overview, and its screenshot budget. */
export function validateListing(entry: StoreEntry, ctx: ListingContext): string[] {
  const problems = [...validateEntryShape(entry)];
  if (entry.id !== expectedPluginId(ctx.packageName)) {
    problems.push(`entry.id "${entry.id}" must be the package id "${expectedPluginId(ctx.packageName)}"`);
  }
  if (normalizeGitUrl(entry.source.git.url) !== normalizeGitUrl(ctx.sourceUrl)) {
    problems.push(`entry.source.git.url "${entry.source.git.url}" != repo remote "${ctx.sourceUrl}"`);
  }
  if (entry.overview !== `./overview/${entry.id}.md`) {
    problems.push(`entry.overview must be ./overview/${entry.id}.md`);
  }
  if (entry.screenshots.length > SCREENSHOT_MAX_COUNT) {
    problems.push(`${entry.screenshots.length} screenshots, over the ${SCREENSHOT_MAX_COUNT} cap`);
  }
  const byPath = new Map(ctx.screenshots.map((s) => [s.path, s]));
  for (const path of entry.screenshots) {
    const dir = `./screenshots/${entry.id}/`;
    if (!path.startsWith(dir)) problems.push(`screenshot "${path}" must live under ${dir}`);
    const report = byPath.get(path);
    if (report === undefined) {
      problems.push(`screenshot "${path}" is not in the resolved set`);
      continue;
    }
    if (!report.found) {
      problems.push(`screenshot "${path}" has no local file`);
      continue;
    }
    if (report.bytes !== null && report.bytes > SCREENSHOT_MAX_BYTES) {
      problems.push(`screenshot "${path}" is ${Math.round((report.bytes / 1024 / 1024) * 10) / 10} MiB, over the 2 MiB cap`);
    }
    if (report.width === null) {
      problems.push(`screenshot "${path}" is not a PNG, so its width could not be checked`);
    } else if (report.width < SCREENSHOT_MIN_WIDTH) {
      problems.push(`screenshot "${path}" is ${report.width}px wide, under the ${SCREENSHOT_MIN_WIDTH}px floor`);
    }
  }
  problems.push(...validateOverview(ctx.overviewText));
  return problems;
}
