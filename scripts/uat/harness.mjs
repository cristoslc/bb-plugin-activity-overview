/**
 * Shared vite-harness startup for the release gates: the UAT runner
 * (`scripts/uat/run.mjs`) and the release-safety capture step
 * (`scripts/uat/release-shots.mjs`) both boot the screenshot harness and wait
 * for it the same way, so that behavior lives here once.
 *
 * Ported from the Focus Board plugin's `scripts/uat/harness.mjs`. The starter
 * hands its vite a per-run identity token and only accepts the port once the
 * harness echoes that token back (scripts/uat/harness-identity.ts): without the
 * handshake, a port held by another tree's run or a stray server from an
 * earlier session would be driven and photographed as this run's evidence.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { IDENTITY_ENV, probeIdentity } from "./harness-identity.ts";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const HARNESS_CONFIG = "scripts/screenshot/vite.config.ts";

/**
 * Start vite on `port` and resolve once the server answering the port is THIS
 * run's own harness (the identity handshake). Returns `{ child, base, stop }`.
 * Fails loudly — never falls through to a foreign server.
 */
export async function startHarness(port) {
  const token = randomUUID();
  // Spawn the local vite binary directly: going through npx leaves the
  // underlying vite process orphaned when the wrapper is killed.
  const child = spawn(
    process.execPath,
    [`${repo}node_modules/vite/bin/vite.js`, "--config", HARNESS_CONFIG, "--port", String(port), "--strictPort"],
    { cwd: repo, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, [IDENTITY_ENV]: token } },
  );
  let viteErrors = "";
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    viteErrors += text;
    if (/error/i.test(text)) process.stderr.write(`  vite: ${text}`);
  });
  let exited = null; // set by the exit listener; code, or signal name
  child.once("exit", (code, signal) => {
    exited = code ?? signal;
  });

  const base = `http://localhost:${port}/`;
  const probe = await probeIdentity(base, token, { attempts: 100, delayMs: 200 });
  if (!probe.ok) {
    child.kill();
    const tail = viteErrors.trim().split("\n").filter((line) => line.length > 0).slice(-3);
    const detail = tail.length > 0 ? ` vite: ${tail.join(" ⏎ ")}` : "";
    const foreign = probe.claim !== null ? ` A foreign server was checked against this run's identity and rejected: ${probe.claim}.` : "";
    const own = exited !== null ? ` This run's own vite exited (${exited}) rather than binding.` : "";
    throw new Error(
      `port ${base} is not held by this run's own harness — refusing to drive another tree's server. Kill the foreign server or free the port, then rerun.${foreign}${own}${detail}`,
    );
  }
  return { child, base, stop: () => child.kill() };
}
