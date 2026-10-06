/**
 * "What's new" — the panel's in-plugin changelog surface.
 *
 * bb gives plugins no update notification to hook, so the panel self-reports:
 * the last-seen plugin version sits in localStorage; when the running build
 * is newer, the tab bar's gift button pulses and the modal lists what
 * changed. The button itself never disappears — dismissing only stops the
 * pulse, and the changelog stays reachable afterwards.
 *
 * On dev, APP_VERSION carries a provisional prerelease number (the next
 * release + "-dev", e.g. "0.3.0-dev"): dev builds describe themselves as
 * unreleased, lead the modal with CHANGELOG.md's [Unreleased] group, and
 * pulse whenever that group's content changes (its fingerprint, not the
 * version, is the "seen" state). The release finalize commit strips the
 * suffix; the published entry then exists already, derived from the renamed
 * section. No feed entry is hand-written: WHATS_NEW is scraped from
 * CHANGELOG.md (each bullet's opening sentence, with its sub-bullets as
 * children, at test/build time). A test pins APP_VERSION to package.json's
 * version so they cannot drift apart.
 *
 * Ported from the Focus Board plugin's discipline (proj_p4562js7v2); the
 * writing rules live in .agents/agents-md-detail/release.md.
 */

import { UNRELEASED_ITEMS } from "./unreleased-changelog.generated.ts";
import { DERIVED_WHATS_NEW } from "./whats-new.generated.ts";
import { leadFromBullet } from "./changelog-markdown.ts";

export const APP_VERSION = "0.3.0-dev";

export const LAST_SEEN_VERSION_KEY = "activity-overview:lastSeenVersion";
export const LAST_SEEN_UNRELEASED_KEY = "activity-overview:lastSeenUnreleased";

export interface WhatsNewItem {
  /** The condensed opening sentence shown at top level. */
  lead: string;
  /** The condensations of the bullet's sub-bullets, when it groups any. */
  children?: readonly string[];
}

export interface WhatsNewEntry {
  version: string;
  /** Marks the dev build's [Unreleased] group; the modal heads it without "Version ". */
  unreleased?: boolean;
  items: readonly WhatsNewItem[];
}

/**
 * The published feed: derived from CHANGELOG.md (H2 = version, H3 = change
 * kind, each bullet's opening sentence is the item) at test/build time by
 * scripts/generate-whats-new.mjs, newest first. Nothing is hand-written.
 */
export const WHATS_NEW: readonly WhatsNewEntry[] = [...DERIVED_WHATS_NEW].sort(
  (a, b) => compareVersions(b.version, a.version),
);

/** True when the version carries a prerelease suffix — e.g. dev's "0.3.0-dev". */
export function isPrereleaseVersion(version: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+-.+$/.test(version);
}

/** Negative when a < b, positive when a > b, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const order = compareVersionSegments(pa[i] ?? "", pb[i] ?? "");
    if (order !== 0) return order;
  }
  return 0;
}

/** One dot-separated segment: a numeric core plus an optional suffix (`0-beta`). */
function compareVersionSegments(a: string, b: string): number {
  const parse = (segment: string): { num: number; suffix: string } => {
    // A missing segment ("0.5" vs "0.5.0") is 0, not a string fallback.
    if (segment === "") return { num: 0, suffix: "" };
    const match = /^(\d+)(.*)$/.exec(segment);
    return match === null
      ? { num: NaN, suffix: segment }
      : { num: Number(match[1]), suffix: match[2] };
  };
  const va = parse(a);
  const vb = parse(b);
  // A segment that is not number-led at all (no digits) falls back to a
  // plain string comparison rather than pretending to be 0.
  if (Number.isNaN(va.num) || Number.isNaN(vb.num)) {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (va.num !== vb.num) return va.num < vb.num ? -1 : 1;
  // Same number: a suffix sorts BELOW the bare segment (semver pre-release
  // order — "0-beta" < "0"), and two suffixes compare as strings.
  if (va.suffix === vb.suffix) return 0;
  if (va.suffix === "") return 1;
  if (vb.suffix === "") return -1;
  return va.suffix < vb.suffix ? -1 : 1;
}

/** The stored last-seen version, or null when nothing was stored (fresh install). */
export function readLastSeenVersion(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_VERSION_KEY);
  } catch {
    // localStorage can throw in embedded contexts; a null means "fresh".
    return null;
  }
}

export function writeLastSeenVersion(version: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
  } catch {
    // Best effort only; the panel works without the persistence.
  }
}

/**
 * Entries strictly newer than `lastSeen`, newest first. A null `lastSeen` is
 * a fresh install — nothing counts as new, because everything does; the
 * first visit simply records the running version.
 */
export function entriesSince(lastSeen: string | null): readonly WhatsNewEntry[] {
  if (lastSeen === null) return [];
  return WHATS_NEW.filter((entry) => compareVersions(entry.version, lastSeen) > 0);
}

/**
 * The stored fingerprint of the [Unreleased] group the reader last had open,
 * or null when nothing was stored yet.
 */
export function readLastSeenUnreleased(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_UNRELEASED_KEY);
  } catch {
    // localStorage can throw in embedded contexts; a null means "fresh".
    return null;
  }
}

export function writeLastSeenUnreleased(fingerprint: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_UNRELEASED_KEY, fingerprint);
  } catch {
    // Best effort only; the panel works without the persistence.
  }
}

/** FNV-1a 32-bit over the joined texts: cheap, stable, no dependency. */
export function unreleasedFingerprint(texts: readonly string[]): string {
  let hash = 0x811c9dc5;
  const source = `\n${texts.join("\n")}\n`;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The [Unreleased] group's condensed items: one lead sentence per top-level
 * bullet, each of its sub-bullets condensed the same way as a child. The
 * single seam stays `leadFromBullet`, exactly like the published feed.
 */
function unreleasedWhatsNewItems(): readonly WhatsNewItem[] {
  return UNRELEASED_ITEMS.map((item) => ({
    lead: leadFromBullet(item.text),
    children: item.children.map(leadFromBullet).filter(Boolean),
  }));
}

/** Fingerprint of the unreleased group embedded in this build. */
export const CURRENT_UNRELEASED_FINGERPRINT = unreleasedFingerprint(
  UNRELEASED_ITEMS.flatMap((item) => [item.text, ...item.children]),
);

/** Fingerprint of a group with no bullets: dev builds holding one never pulse. */
export const EMPTY_UNRELEASED_FINGERPRINT = unreleasedFingerprint([]);

export interface WhatsNewUnseenState {
  runningVersion: string;
  lastSeenVersion: string | null;
  unreleasedFingerprint: string;
  lastSeenUnreleasedFingerprint: string | null;
}

/**
 * Whether the tab bar's gift button should pulse.
 *
 * Stable builds compare versions: running > last-seen pulses exactly once
 * per release. A prerelease build keys "seen" to the [Unreleased] group's
 * CONTENT instead: the pulse fires whenever the group is non-empty and its
 * fingerprint differs from the last-open snapshot — a null snapshot is
 * "never opened", not "seen empty", so the group standing in the build
 * always advertises itself until the reader opens the modal. Empty groups
 * never pulse: no bullets is nothing to read, whatever the snapshot says.
 */
export function hasUnseenWhatsNew(state: WhatsNewUnseenState): boolean {
  if (isPrereleaseVersion(state.runningVersion)) {
    return (
      state.unreleasedFingerprint !== EMPTY_UNRELEASED_FINGERPRINT &&
      state.unreleasedFingerprint !== state.lastSeenUnreleasedFingerprint
    );
  }
  return (
    state.lastSeenVersion !== null &&
    compareVersions(state.runningVersion, state.lastSeenVersion) > 0
  );
}

/**
 * The entries the modal shows.
 *
 * A prerelease build leads with its [Unreleased] group (the only thing that
 * is actually new to its reader) followed by the published feed; a stable
 * build shows the pending delta or the full recent feed.
 */
export function whatsNewEntriesFor(
  runningVersion: string,
  unseen: boolean,
  lastSeenVersion: string | null,
): readonly WhatsNewEntry[] {
  if (isPrereleaseVersion(runningVersion)) {
    const unreleased: WhatsNewEntry | null = UNRELEASED_ITEMS.length
      ? { version: runningVersion, unreleased: true, items: unreleasedWhatsNewItems() }
      : null;
    const published = unseen ? entriesSince(lastSeenVersion) : [...WHATS_NEW];
    return unreleased === null ? published : [unreleased, ...published];
  }
  return unseen ? entriesSince(lastSeenVersion) : [...WHATS_NEW];
}