/**
 * Pure finalize transforms for the release driver (scripts/release/run.mjs):
 * the [Unreleased] → [X.Y.Z] rename with its fresh empty group, and the -dev
 * strip across the three version carriers (package.json, package-lock.json,
 * APP_VERSION in lib/whats-new.ts).
 *
 * Every function is a string → string map (or a throw). No filesystem, no
 * git, no clock — run.mjs reads the files and passes today's date in, so the
 * transforms stay hermetic and the tests (tests/release-finalize.test.ts)
 * need no fixtures on disk. Refusals throw with the reason in the message;
 * the driver prints it and aborts before any write lands.
 */

const DEV_VERSION = /^(\d+\.\d+\.\d+)-dev$/;

/**
 * The release number hiding in a `-dev` prerelease version: the finalize
 * commit makes the guess real, so a version without the suffix is a state
 * confusion (already finalized, or dev not re-armed) — refuse rather than
 * guess.
 */
export function releaseVersionFromDev(version) {
  const match = DEV_VERSION.exec(version ?? "");
  if (!match) {
    throw new Error(
      `version ${JSON.stringify(version ?? "")} is not a -dev prerelease (expected X.Y.Z-dev); refusing to guess the release number`,
    );
  }
  return match[1];
}

/**
 * Rename the `[Unreleased]` group to `[X.Y.Z] - <date>` and add a fresh empty
 * `[Unreleased]` group above it, in one mechanical pass:
 *
 *     ## [Unreleased]
 *
 *     ## [X.Y.Z] - YYYY-MM-DD
 *     (the renamed section's bullets, verbatim)
 *
 * Refuses when the group is missing, duplicated, or a `[X.Y.Z]` section
 * already exists — published sections are never back-edited and versions are
 * never re-released.
 */
export function finalizeChangelog(markdown, version, date) {
  const heading = "## [Unreleased]";
  const lines = markdown.split("\n");
  const groupIndexes = lines.reduce(
    (acc, line, i) => (line === heading ? [...acc, i] : acc),
    [],
  );
  if (groupIndexes.length === 0) {
    throw new Error("CHANGELOG.md has no '## [Unreleased]' group; nothing to finalize");
  }
  if (groupIndexes.length > 1) {
    throw new Error(
      `CHANGELOG.md has more than one '## [Unreleased]' group (found ${groupIndexes.length}); regroup to one before releasing`,
    );
  }
  const versionNeedle = `## [${version}]`;
  if (lines.some((line) => line.startsWith(versionNeedle))) {
    throw new Error(
      `CHANGELOG.md already has a [${version}] section; versions are never re-released`,
    );
  }
  lines[groupIndexes[0]] = `${heading}\n\n${versionNeedle} - ${date}`;
  return lines.join("\n");
}

/**
 * Replace `needle` with `replace` exactly `expected` times. The count check
 * is the fail-loud guard: a silent zero-match (stale version stamp) or an
 * over-match (a dependency that happens to pin the same version string) must
 * abort, never half-apply.
 */
function replaceExact(text, needle, replace, expected, label) {
  const parts = text.split(needle);
  const found = parts.length - 1;
  if (found !== expected) {
    throw new Error(
      `${label}: expected exactly ${expected} occurrence of ${JSON.stringify(needle)}, found ${found}`,
    );
  }
  return parts.join(replace);
}

/** Strip `-dev` from package.json's root version (exactly one site). */
export function stripDevFromPackageJson(text, releaseVersion) {
  return replaceExact(
    text,
    `"version": "${releaseVersion}-dev"`,
    `"version": "${releaseVersion}"`,
    1,
    "package.json",
  );
}

/**
 * Strip `-dev` from package-lock.json's two version sites — the root record
 * and `packages[""]`. Exactly two; a third occurrence means a dependency
 * pins the same version string and the edit must not guess.
 */
export function stripDevFromPackageLock(text, releaseVersion) {
  return replaceExact(
    text,
    `"version": "${releaseVersion}-dev"`,
    `"version": "${releaseVersion}"`,
    2,
    "package-lock.json",
  );
}

/** Strip `-dev` from APP_VERSION in lib/whats-new.ts (exactly one line). */
export function stripDevFromWhatsNewTs(text, releaseVersion) {
  return replaceExact(
    text,
    `export const APP_VERSION = "${releaseVersion}-dev";`,
    `export const APP_VERSION = "${releaseVersion}";`,
    1,
    "lib/whats-new.ts",
  );
}
