/**
 * The release-safety gate runner: the three stages of `npm run
 * release-safety` — the build, the UAT sweep, and the release screenshots —
 * with the release notification contract wired in
 * (`.agents/agents-md-detail/release.md` §2b).
 *
 * Ported from the Focus Board plugin's scripts/release-safety.mjs: the
 * package.json `&&` chain this replaces exits with the first failing stage's
 * code but leaves no hook to say which stage it was; here each stage runs on
 * its own and the first non-zero exit publishes one notification naming that
 * stage before the runner exits with the stage's own code.
 *
 * The full release driver — preconditions, typecheck, store:check, the
 * finalize, tag, promote, push — is scripts/release/run.mjs
 * (`npm run release`); this script stays the standalone gate.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { notifyGateFailure } from "./release-notify.mjs";
import { NPM, runStages } from "./release/stages.mjs";

export const RELEASE_SAFETY_STAGES = [
  { name: "build", command: NPM, args: ["run", "build"] },
  { name: "uat", command: NPM, args: ["run", "uat"] },
  { name: "release-shots", command: NPM, args: ["run", "release-shots"] },
];

/**
 * Run the stages in order and return the exit code for the whole gate.
 */
export async function runReleaseSafety({
  stages = RELEASE_SAFETY_STAGES,
  notify = notifyGateFailure,
  log = console.log,
  warn = console.warn,
} = {}) {
  const { status } = await runStages({ stages, label: "release-safety", notify, log, warn });
  return status;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(await runReleaseSafety());
}
