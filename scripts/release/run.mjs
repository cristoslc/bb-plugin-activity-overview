#!/usr/bin/env node
/**
 * The release driver: one entry for shipping a version of this plugin, at
 * the rigor of the Focus Board plugin's release discipline
 * (`.agents/agents-md-detail/release.md`, ported from proj_p4562js7v2).
 *
 *   npm run release                  # the real thing: gates, then mutations
 *   npm run release -- --dry-run     # every gate, every step printed, no mutation
 *   npm run release -- --allow-empty # permit releasing an empty [Unreleased] group
 *
 * Order of operations:
 *
 *   1. Preconditions (refusals abort a real run before any gate): clean
 *      tree, on dev, in sync with gh/dev, tag vX.Y.Z absent locally and on
 *      gh, version is X.Y.Z-dev, [Unreleased] non-empty (or --allow-empty),
 *      every UAT suite in tests/manual discovered (mandatory), tag signing
 *      configured, main promotable fast-forward-only.
 *   2. The blocking gate stack, in order: `npm test`, `npx tsc --noEmit`,
 *      `npm run build`, the FULL UAT sweep (every suite in tests/manual, via
 *      the runner's own discovery), `npm run store:check`, `npm run
 *      release-shots`. The first failure aborts — named through
 *      scripts/release-notify.mjs — before any mutation. After the gates,
 *      the tree may carry changes only under the gate-artifact dirs
 *      (docs/uat/, docs/release-safety/); anything else aborts.
 *   3. The finalize: rename [Unreleased] → [X.Y.Z] - <today>, add a fresh
 *      empty group, strip -dev from package.json, package-lock.json (2
 *      sites) and APP_VERSION in lib/whats-new.ts, regenerate the feeds, one
 *      commit (`Release X.Y.Z: <lead summary>`) — nothing else rides in it.
 *   4. Rebuild at the released version, tag vX.Y.Z annotated (signed via the
 *      repo's ssh signing config, then `git tag -v` verified), fast-forward
 *      main (its own checkout when one exists, else a temp worktree), push
 *      gh dev + main + tag, assemble the store drop (`npm run store:build`).
 *
 * A dry-run executes every gate (step 2 for real) and PRINTS steps 1, 3, 4 —
 * including the exact diffs the finalize would write — while mutating
 * nothing: no file write, no commit, no tag, no worktree, no push, no store
 * build. Previewed refusals do not stop a dry-run's gates, so gate evidence
 * can ship from a branch that cannot itself release; the dry-run still exits
 * non-zero when a real run would abort.
 *
 * Fail loud throughout: a failure prints the step, the state reached, and
 * the remediation, and exits non-zero. A failure after the finalize commit
 * is a half-applied release by nature; the failure output names exactly what
 * landed so it can be reconciled by hand (a re-run refuses: the version no
 * longer carries -dev).
 *
 * Staying manual after the script (release.md §6, §7, §4a): the prep commit
 * bumping dev to the next -dev, `bb plugin reload activity-overview`, and
 * the marketplace submission from dist/store/.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  finalizeChangelog,
  releaseVersionFromDev,
  stripDevFromPackageJson,
  stripDevFromPackageLock,
  stripDevFromWhatsNewTs,
} from "./finalize.mjs";
import { buildReleasePlan, discoverSuites } from "./plan.mjs";
import { runStages } from "./stages.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const GATE_ARTIFACT_DIRS = ["docs/uat/", "docs/release-safety/"];
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const dryRun = process.argv.includes("--dry-run");
const allowEmpty = process.argv.includes("--allow-empty");
const label = dryRun ? "release(dry-run)" : "release";

/** git with output captured; non-zero exits throw with stderr in the message. */
function git(args, cwd = repo) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${result.status ?? "signal"}): ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

/** git with the raw result, for callers that branch on the exit code. */
function gitRaw(args, cwd = repo) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function npmRun(script) {
  const result = spawnSync(NPM, ["run", script], { cwd: repo, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`npm run ${script} exited with ${result.status ?? "signal"}`);
  }
}

function todayStamp(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** The worktree holding refs/heads/main, with its health, or null. */
function findMainWorktree() {
  const listing = git(["worktree", "list", "--porcelain"]);
  for (const entry of listing.split("\n\n")) {
    const lines = entry.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    const branch = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
    if (path && branch === "refs/heads/main") {
      // Health check for the fast-forward: only tracked-file modifications
      // endanger it (git itself refuses an ff that would clobber untracked
      // paths). Untracked scaffolding is expected here by convention — this
      // repo's dev worktree lives in the main checkout's .worktrees/ — and
      // main's checkout can sit at an old commit whose .gitignore predates
      // the convention, so untracked entries must not block a release.
      const dirty = git(["status", "--porcelain", "--untracked-files=no"], path) !== "";
      const midMerge = gitRaw(["rev-parse", "-q", "--verify", "MERGE_HEAD"], path).status === 0;
      return { path, clean: !dirty, midMerge };
    }
  }
  return null;
}

function gatherState() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = git(["status", "--porcelain"]) !== "";
  // In-sync means fresh: fetch first, then compare. Offline aborts here.
  git(["fetch", "gh", "dev"]);
  const headInSyncWithGhDev =
    git(["rev-parse", "HEAD"]) === git(["rev-parse", "gh/dev"]);
  const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
  const changelog = readFileSync(join(repo, "CHANGELOG.md"), "utf8");
  const suites = discoverSuites(readdirSync(join(repo, "tests", "manual")));
  const signingConfigured =
    git(["config", "--get", "user.signingkey"]) !== "" &&
    git(["config", "--get", "gpg.ssh.allowedSignersFile"]) !== "";
  const mainWorktree = findMainWorktree();
  const mainCanFastForward = gitRaw(["merge-base", "--is-ancestor", "main", "HEAD"]).status === 0;

  // Tag checks need the release number; a version that is not X.Y.Z-dev is
  // the plan's refusal, and the tag checks simply do not apply yet.
  let tagLocalExists = false;
  let tagRemoteExists = false;
  try {
    const releaseVersion = releaseVersionFromDev(version);
    tagLocalExists = gitRaw(["rev-parse", "-q", "--verify", `refs/tags/v${releaseVersion}`]).status === 0;
    tagRemoteExists = git(["ls-remote", "--tags", "gh", `refs/tags/v${releaseVersion}`]) !== "";
  } catch {
    // Plan reports the version refusal; no tag to check.
  }

  return {
    branch,
    dirty,
    headInSyncWithGhDev,
    version,
    tagLocalExists,
    tagRemoteExists,
    changelog,
    suites,
    signingConfigured,
    mainWorktree,
    mainCanFastForward,
  };
}

function printPlan(plan, log) {
  log(`${label}: version ${plan.version}, mode ${plan.mode}`);
  log(
    `${label}: ${plan.suites.length} UAT suites discovered in tests/manual (mandatory):`,
  );
  for (const suite of plan.suites) log(`  - ${suite}`);
  if (plan.refusals.length > 0) {
    for (const refusal of plan.refusals) {
      log(`REFUSAL${dryRun ? " (preview — a real run aborts before any gate)" : ""}: ${refusal}`);
    }
  }
  log(`${label}: gates (blocking, in order): ${plan.gateStages.map((s) => s.name).join(" → ")}`);
  log(`${label}: mutations (only after every gate is green):`);
  for (const step of plan.mutationSteps) log(`  - ${step.name}: ${step.detail}`);
}

/**
 * Unified diff of one finalize transform, for the dry-run evidence. Uses the
 * system `diff -u` over temp files so the output is a real patch; diff's
 * exit code 1 means "differ" and is expected.
 */
function diffPreview(name, before, after) {
  const dir = mkdtempSync(join(tmpdir(), "release-dry-run-"));
  try {
    const a = join(dir, "a");
    const b = join(dir, "b");
    writeFileSync(a, before);
    writeFileSync(b, after);
    const result = spawnSync("diff", ["-u", "--label", `a/${name}`, "--label", `b/${name}`, a, b], {
      encoding: "utf8",
    });
    return (result.stdout ?? "").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Porcelain lines outside the gate-artifact dirs — anything else aborts. */
function foreignTreeChanges() {
  const status = git(["status", "--porcelain"]);
  return status
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => !GATE_ARTIFACT_DIRS.some((dir) => line.includes(dir)));
}

function fail(step, message, state = {}) {
  console.error(`\n${label}: FAILED at ${step}: ${message}`);
  const landed = Object.entries(state)
    .filter(([, v]) => v)
    .map(([k, v]) => `  - ${k}: ${v}`);
  if (landed.length > 0) {
    console.error(`${label}: state reached:`);
    for (const line of landed) console.error(line);
  }
  if (state.tagged && !state.pushed) {
    console.error(`${label}: the local tag is unpushed; delete it with git tag -d once reconciled`);
  }
  if (state.committed && !state.pushed) {
    console.error(
      `${label}: the finalize commit is on local dev only; a re-run refuses (the version no longer carries -dev) — reconcile by hand (release.md §3)`,
    );
  }
  process.exit(1);
}

async function main() {
  const log = console.log;

  // ── 1. Preconditions ────────────────────────────────────────────────────
  log(`==> ${label}: preconditions`);
  const state = gatherState();
  const plan = buildReleasePlan(state, { allowEmpty, dryRun });
  printPlan(plan, log);

  if (plan.refusals.length > 0 && !dryRun) {
    log(`\n${label}: ${plan.refusals.length} precondition refusal(s); nothing ran, nothing mutated`);
    process.exit(1);
  }

  // ── 2. The blocking gate stack ─────────────────────────────────────────
  const { failed, status } = await runStages({
    stages: plan.gateStages,
    label,
    log,
    warn: console.warn,
  });
  if (failed) {
    // The stage notification (if any topic is configured) already went out
    // through runStages; nothing has been mutated at this point.
    fail(
      `gate:${failed.name}`,
      `stage exited with code ${status}${dryRun ? " (dry-run: gates ran for evidence)" : ""}`,
    );
  }

  // The gates may dirty only the gate-artifact dirs; anything else means the
  // finalize would commit unknown state. Fail loud either way; a dry-run
  // records it as a previewed refusal and exits non-zero below.
  const foreign = foreignTreeChanges();
  let previewedRefusals = 0;
  if (foreign.length > 0) {
    const message = `gates left changes outside the gate-artifact dirs (${GATE_ARTIFACT_DIRS.join(", ")}):\n${foreign.join("\n")}`;
    if (dryRun) {
      previewedRefusals += 1;
      log(`REFUSAL (preview — a real run aborts here): ${message}`);
    } else {
      fail("post-gate tree check", message);
    }
  }

  // Re-check the cheap racy facts (branch, local + remote tag) before
  // mutating: gates take minutes, the world moves.
  if (!dryRun) {
    const stillDev = git(["rev-parse", "--abbrev-ref", "HEAD"]) === "dev";
    if (!stillDev) fail("post-gate recheck", "HEAD is no longer on dev");
    const releaseVersion = plan.version;
    if (gitRaw(["rev-parse", "-q", "--verify", `refs/tags/v${releaseVersion}`]).status === 0) {
      fail("post-gate recheck", `tag v${releaseVersion} appeared during the gate run`);
    }
    if (git(["ls-remote", "--tags", "gh", `refs/tags/v${releaseVersion}`]) !== "") {
      fail("post-gate recheck", `tag v${releaseVersion} appeared on gh during the gate run`);
    }
  }

  // ── 3 + 4. The finalize and the ship (mutations from here) ─────────────
  if (dryRun) {
    log(`\n==> ${label}: finalize preview (nothing is written)`);
    const date = todayStamp();
    log(diffPreview("CHANGELOG.md", state.changelog, finalizeChangelog(state.changelog, plan.version, date)));
    log(diffPreview("package.json", readFileSync(join(repo, "package.json"), "utf8"), stripDevFromPackageJson(readFileSync(join(repo, "package.json"), "utf8"), plan.version)));
    log(diffPreview("package-lock.json", readFileSync(join(repo, "package-lock.json"), "utf8"), stripDevFromPackageLock(readFileSync(join(repo, "package-lock.json"), "utf8"), plan.version)));
    log(diffPreview("lib/whats-new.ts", readFileSync(join(repo, "lib", "whats-new.ts"), "utf8"), stripDevFromWhatsNewTs(readFileSync(join(repo, "lib", "whats-new.ts"), "utf8"), plan.version)));
    log(`\n${label}: would commit: ${plan.subject}`);
    log(`${label}: would tag (signed, then git tag -v verified): git tag -a v${plan.version} -m "${plan.subject}" <finalize sha>`);
    log(`${label}: would promote main: ${plan.mutationSteps.find((s) => s.name === "promote-main").detail}`);
    log(`${label}: would push: git push gh dev main v${plan.version}`);
    log(`${label}: would assemble the store drop: npm run store:build (dist/store/)`);
    const exitCode = plan.refusals.length + previewedRefusals > 0 ? 1 : 0;
    log(
      `\n${label}: dry-run complete — every gate green, ${plan.refusals.length + previewedRefusals} previewed refusal(s), nothing mutated${exitCode !== 0 ? "; a real run would have aborted" : ""}`,
    );
    process.exit(exitCode);
  }

  const ship = { committed: false, tagged: false, promoted: false, pushed: false };
  try {
    log(`\n==> ${label}: finalize-files`);
    const date = todayStamp();
    writeFileSync(join(repo, "CHANGELOG.md"), finalizeChangelog(state.changelog, plan.version, date));
    writeFileSync(
      join(repo, "package.json"),
      stripDevFromPackageJson(readFileSync(join(repo, "package.json"), "utf8"), plan.version),
    );
    writeFileSync(
      join(repo, "package-lock.json"),
      stripDevFromPackageLock(readFileSync(join(repo, "package-lock.json"), "utf8"), plan.version),
    );
    writeFileSync(
      join(repo, "lib", "whats-new.ts"),
      stripDevFromWhatsNewTs(readFileSync(join(repo, "lib", "whats-new.ts"), "utf8"), plan.version),
    );

    log(`==> ${label}: regenerate-feeds`);
    for (const script of ["scripts/generate-unreleased.mjs", "scripts/generate-whats-new.mjs"]) {
      const result = spawnSync(process.execPath, [join(repo, script)], { cwd: repo, stdio: "inherit" });
      if (result.status !== 0) throw new Error(`${script} exited with ${result.status ?? "signal"}`);
    }

    log(`==> ${label}: commit`);
    const finalizeShaBefore = git(["rev-parse", "HEAD"]);
    git([
      "add",
      "CHANGELOG.md",
      "package.json",
      "package-lock.json",
      "lib/whats-new.ts",
      "lib/whats-new.generated.ts",
      "lib/unreleased-changelog.generated.ts",
    ]);
    const body = [
      `Finalize commit for ${plan.version}: renames [Unreleased] to [${plan.version}] - ${date} and adds a fresh empty group; strips -dev from package.json, package-lock.json, and APP_VERSION (lib/whats-new.ts). Nothing else rides in it.`,
      `Gate stack green: test, typecheck, build, UAT (${plan.suites.length} suites: ${plan.suites.join(", ")}), store:check, release-shots.`,
    ].join("\n\n");
    git(["commit", "-m", plan.subject, "-m", body]);
    ship.committed = true;
    const finalizeSha = git(["rev-parse", "HEAD"]);
    if (finalizeSha === finalizeShaBefore) {
      throw new Error("the finalize commit did not land (HEAD unchanged)");
    }

    log(`==> ${label}: rebuild`);
    npmRun("build");

    log(`==> ${label}: tag`);
    git(["tag", "-a", `v${plan.version}`, "-m", plan.subject, finalizeSha]);
    ship.tagged = true;

    log(`==> ${label}: verify-tag`);
    const verify = gitRaw(["tag", "-v", `v${plan.version}`]);
    const verifyText = `${verify.stdout ?? ""}\n${verify.stderr ?? ""}`;
    if (verify.status !== 0 || !/Good "(gpg|rsa)" signature/.test(verifyText)) {
      throw new Error(
        `git tag -v v${plan.version} did not verify against the allowed-signers file — the tag must never ship unverified`,
      );
    }
    const goodLine = verifyText.split("\n").find((line) => line.includes("Good "));
    if (goodLine) log(`${label}: ${goodLine.trim()}`);

    log(`==> ${label}: promote-main`);
    if (state.mainWorktree) {
      git(["merge", "--ff-only", finalizeSha], state.mainWorktree.path);
    } else {
      const tmp = mkdtempSync(join(tmpdir(), "release-main-"));
      let added = false;
      let merged = false;
      try {
        git(["worktree", "add", tmp, "main"]);
        added = true;
        git(["merge", "--ff-only", finalizeSha], tmp);
        merged = true;
      } finally {
        // The temp worktree is scaffolding: remove it when it exists,
        // whether the merge landed or not. A merge failure still aborts the
        // release below (a fast-forward either moves main or refuses and
        // touches nothing, so plain removal suffices).
        if (added) git(["worktree", "remove", tmp, ...(merged ? [] : ["--force"])]);
      }
    }
    ship.promoted = true;

    log(`==> ${label}: push`);
    git(["push", "gh", "dev", "main", `v${plan.version}`]);
    ship.pushed = true;

    log(`==> ${label}: store-build`);
    npmRun("store:build");
  } catch (error) {
    fail("ship", error.message, ship);
  }

  log(`\n${label}: released ${plan.version} — finalize ${git(["rev-parse", "--short", "HEAD"])}, tag v${plan.version} pushed to gh`);
  log(`${label}: manual follow-ups (release.md):`);
  log(`  - §6 prep commit: bump package.json, package-lock.json, APP_VERSION to the next candidate + "-dev" and land it on dev`);
  log(`  - §7 reload: npm run build in the checkout bb serves, then bb plugin reload activity-overview; the gift button pulses`);
  log(`  - §4a marketplace: copy dist/store/ entries + overview + screenshots into get-bb/marketplace; raise source.git.range when the version leaves it`);
  log(`  - store media: docs/screenshots/ is regenerated per landing (npm run shots, npm run gif) — the drop above carries what is committed`);
  process.exit(0);
}

main();
