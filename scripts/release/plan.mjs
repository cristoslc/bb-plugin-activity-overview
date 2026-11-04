/**
 * Pure release planning for the release driver (scripts/release/run.mjs):
 * the precondition refusals, the blocking gate stages in their fixed order,
 * and the mutation steps in theirs. Nothing here touches git, the
 * filesystem, or the clock — run.mjs gathers the state (branch, tree, refs,
 * changelog text, suite names) and executes what this module plans, so the
 * ordering and refusal contracts are testable hermetically
 * (tests/release-plan.test.ts).
 *
 * Fail-loud shape: refusals ACCUMULATE (the operator sees every problem in
 * one pass), and a non-empty refusal list aborts a real run before any gate
 * or mutation. A dry-run keeps the refusals as previewed aborts and still
 * executes the gates, so the gate evidence can ship from a branch that
 * cannot itself release.
 */
import { leadFromBullet, parsePublishedChangelog } from "../../lib/changelog-markdown.ts";
import { parseUnreleasedChangelog } from "../../lib/unreleased-changelog.ts";
import { releaseVersionFromDev } from "./finalize.mjs";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * Every UAT suite in tests/manual is mandatory: the release sweep passes no
 * suite args to `npm run uat`, whose own discovery reads the directory — the
 * count here is the contract that the sweep cannot silently shrink. A
 * directory with zero suites refuses the release outright.
 */
export function discoverSuites(entries) {
  return entries.filter((name) => name.endsWith(".yaml")).sort();
}

/** The blocking gate stack, in order. Each stage is a named, spawnable step. */
export function gateStages() {
  return [
    { name: "test", command: NPM, args: ["test"] },
    { name: "typecheck", command: "npx", args: ["tsc", "--noEmit"] },
    { name: "build", command: NPM, args: ["run", "build"] },
    // No suite args: the UAT runner discovers every suite in tests/manual.
    { name: "uat", command: NPM, args: ["run", "uat"] },
    { name: "store:check", command: NPM, args: ["run", "store:check"] },
    { name: "release-shots", command: NPM, args: ["run", "release-shots"] },
  ];
}

/**
 * The mutation steps, in order, after every gate is green. `mainWorktree` is
 * main's existing checkout when one exists (this repo's does), else null —
 * the promote step fast-forwards main in that checkout, or in a temporary
 * worktree when main has no checkout (the Focus Board shape).
 */
export function mutationSteps({ version, subject, suites, mainWorktree }) {
  const promote = mainWorktree
    ? `git -C ${mainWorktree.path} merge --ff-only <finalize sha> (main's own checkout)`
    : "git worktree add <tmp> main && git merge --ff-only <finalize sha> (temp worktree, removed after)";
  return [
    {
      name: "finalize-files",
      detail:
        "rewrite CHANGELOG.md (rename [Unreleased] → [" +
        version +
        "] - <today>, fresh empty group above it), strip -dev from package.json (1 site), package-lock.json (2 sites), APP_VERSION in lib/whats-new.ts (1 site)",
    },
    { name: "regenerate-feeds", detail: "node scripts/generate-unreleased.mjs && node scripts/generate-whats-new.mjs" },
    {
      name: "commit",
      detail: `git add CHANGELOG.md package.json package-lock.json lib/whats-new.ts lib/whats-new.generated.ts lib/unreleased-changelog.generated.ts && git commit "${subject}" (${suites.length} UAT suites green)`,
    },
    { name: "rebuild", detail: "npm run build (dist/ at the released version)" },
    { name: "tag", detail: `git tag -a v${version} -m "${subject}" <finalize sha> (signed via the repo's ssh signing config)` },
    { name: "verify-tag", detail: `git tag -v v${version} (must verify against scripts/release-signing.allowed)` },
    { name: "promote-main", detail: promote },
    { name: "push", detail: `git push gh dev main v${version}` },
    { name: "store-build", detail: "npm run store:build (assemble dist/store/)" },
  ];
}

/**
 * Build the release plan from gathered state. Options:
 * - `allowEmpty`: permit an empty [Unreleased] group (a release whose section
 *   still exists but carries no bullets).
 * - `dryRun`: plan for evidence — refusals become previewed aborts and the
 *   caller decides to keep executing the gates.
 *
 * The changelog is parsed here (pure) for the bullet count, the published
 * version check, and the commit subject's lead summary, so run.mjs never
 * re-implements the rules.
 */
export function buildReleasePlan(state, { allowEmpty = false, dryRun = false } = {}) {
  const refusals = [];

  let version = null;
  try {
    version = releaseVersionFromDev(state.version);
  } catch (error) {
    refusals.push(error.message);
  }

  const unreleased = parseUnreleasedChangelog(state.changelog ?? "");
  const published = parsePublishedChangelog(state.changelog ?? "");

  if (state.branch !== "dev") {
    refusals.push(
      `branch is ${JSON.stringify(state.branch ?? "")}, not dev — releases run on a clean dev checkout`,
    );
  }
  if (state.dirty) {
    refusals.push("working tree is dirty — commit or stash before releasing");
  }
  if (state.headInSyncWithGhDev === false) {
    refusals.push("HEAD is not in sync with gh/dev — fetch and fast-forward dev, then release");
  }
  if (version !== null) {
    if (state.tagLocalExists) {
      refusals.push(`tag v${version} already exists locally — a tagged version is never re-released`);
    }
    if (state.tagRemoteExists) {
      refusals.push(`tag v${version} already exists on gh — a pushed tag is never moved`);
    }
    if (published.some((section) => section.version === version)) {
      refusals.push(`CHANGELOG.md already has a [${version}] section; versions are never re-released`);
    }
    if (unreleased.items.length === 0 && !allowEmpty) {
      refusals.push(
        "the [Unreleased] group has no bullets — pass --allow-empty to release an empty group on purpose",
      );
    }
  }
  if (!state.suites || state.suites.length === 0) {
    refusals.push(
      "no UAT suites discovered in tests/manual — the sweep is mandatory; refusing to release with zero suites",
    );
  }
  if (!state.signingConfigured) {
    refusals.push(
      "tag signing is not configured (repo-local user.signingkey / gpg.ssh.allowedSignersFile) — refusing to create an unsigned release tag",
    );
  }
  if (state.mainWorktree) {
    if (!state.mainWorktree.clean) {
      refusals.push(
        `main's checkout (${state.mainWorktree.path}) is dirty — clean it before releasing; the promote step fast-forwards it`,
      );
    }
    if (state.mainWorktree.midMerge) {
      refusals.push(
        `main's checkout (${state.mainWorktree.path}) has a merge in flight — resolve it before releasing`,
      );
    }
  }
  if (state.mainCanFastForward === false) {
    refusals.push(
      "main cannot fast-forward to HEAD (diverged) — reconcile by hand; the script never merge-commits main",
    );
  }

  const leadSummary = leadSummaryFromChangelog(state.changelog ?? "");
  const subject = commitSubject(version, leadSummary);

  return {
    mode: dryRun ? "dry-run" : "release",
    allowEmpty,
    version,
    subject,
    refusals,
    suites: state.suites ?? [],
    gateStages: gateStages(),
    mutationSteps: mutationSteps({
      version,
      subject,
      suites: state.suites ?? [],
      mainWorktree: state.mainWorktree ?? null,
    }),
  };
}

/**
 * The finalize commit's subject: `Release X.Y.Z: <summary>` where the summary
 * condenses the changelog's lead bullet (same wording rules as the What's-new
 * item). An empty group (the --allow-empty path) releases without a summary.
 */
export function commitSubject(version, summary) {
  return summary ? `Release ${version}: ${summary}` : `Release ${version}`;
}

/**
 * The lead bullet's bold lead sentence, terminal punctuation stripped — the
 * commit-subject condensation of the group. Null for an empty group.
 */
export function leadSummaryFromChangelog(markdown) {
  const { items } = parseUnreleasedChangelog(markdown);
  if (items.length === 0) return null;
  const lead = leadFromBullet(items[0].text).trim();
  const stripped = lead.replace(/\.$/, "").trim();
  return stripped === "" ? null : stripped;
}
