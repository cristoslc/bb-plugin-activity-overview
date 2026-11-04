/**
 * The shared stage runner for the release gates: run named stages in order,
 * inherit stdio, stop at the first failure, and publish one notification
 * naming the failed stage (scripts/release-notify.mjs) before exiting with
 * that stage's own code.
 *
 * Extracted from the Focus Board plugin's release-safety runner so the
 * release driver (scripts/release/run.mjs) and the standalone
 * release-safety gate (scripts/release-safety.mjs) share one mechanism —
 * the old `a && b && c` chain exits with the first failing stage's code but
 * leaves no hook to say which stage it was; here every stage is named.
 *
 * The stages it spawns carry the delegation marker (release-notify.mjs's
 * DELEGATE_ENV), so a nested gate keeps quiet and the run sends exactly one
 * message.
 */
import { spawnSync } from "node:child_process";
import { DELEGATE_ENV, notifyGateFailure } from "../release-notify.mjs";

export const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

export function spawnStage(stage) {
  const result = spawnSync(stage.command, stage.args, {
    stdio: "inherit",
    env: { ...process.env, [DELEGATE_ENV]: "1" },
  });
  // A spawn-level failure (command missing, signal kill) has a null status;
  // treat anything that is not a clean 0 as a failure.
  return { status: result.status === 0 ? 0 : (result.status ?? 1) };
}

/**
 * Run the stages in order. Returns `{ failed, status }`: `failed` names the
 * first failing stage (null on a clean pass) and `status` is that stage's
 * own code, or 0.
 *
 * The notification is best effort by construction: `notify` is awaited inside
 * a try/catch, so a throwing or hanging implementation can never change the
 * code this returns.
 */
export async function runStages({
  stages,
  label = "release",
  notify = notifyGateFailure,
  log = console.log,
  warn = console.warn,
} = {}) {
  for (const stage of stages) {
    log(`\n==> ${label}: ${stage.name}`);
    const { status } = spawnStage(stage);
    if (status !== 0) {
      try {
        await notify({
          gate: `${label}:${stage.name}`,
          detail: `stage exited with code ${status}`,
        });
      } catch (error) {
        warn(`[WARN] release notification failed: ${error?.message ?? error}`);
      }
      return { failed: stage, status: status === 0 ? 1 : status };
    }
  }
  return { failed: null, status: 0 };
}
