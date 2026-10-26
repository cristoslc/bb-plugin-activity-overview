/**
 * Per-run harness identity, ported from the Focus Board plugin's
 * `scripts/uat/harness.mjs` (its issue #116). The shared starter hands its
 * vite a random token and only accepts the port once the harness echoes that
 * token back, so a stray server from another checkout (or a crashed earlier
 * session, or a sibling thread's run) can never be driven or photographed as
 * this run's evidence. Without the handshake, "a fetch answered" is true even
 * when the answering server belongs to a different tree.
 *
 * Kept pure and dependency-free so it unit-tests without booting vite: the
 * vite config imports `identityPayload` for its middleware, and the starter
 * (`scripts/uat/harness.mjs`) imports `probeIdentity` for its handshake.
 */

/** Where the harness serves its identity token (a path no app route owns). */
export const IDENTITY_PATH = "/__activity-overview-harness/identity";

/** The env var the starter sets and the harness reads back. */
export const IDENTITY_ENV = "ACTIVITY_OVERVIEW_HARNESS_TOKEN";

/**
 * What the identity endpoint answers for a request path. Returns null when the
 * path is not the identity endpoint (the request falls through to vite); the
 * body always names the token this process holds, or null when none was set
 * (a plain `npx vite` run), which the prober reads as a foreign server.
 */
export function identityPayload(
  pathname: string,
  token: string | undefined,
): { status: number; body: { token: string | null } } | null {
  if (pathname !== IDENTITY_PATH) return null;
  return { status: 200, body: { token: token ?? null } };
}

export interface ProbeResult {
  ok: boolean;
  /** Why a foreign server was rejected, or null when the handshake succeeded. */
  claim: string | null;
}

/**
 * Poll `<base>/__…/identity` until the server echoes `token`, or give up.
 * Distinguishes "not up yet" from "answered by a foreign server": the latter
 * returns a `claim` naming it, and the caller must fail loudly rather than
 * accept it. Injected `fetchImpl`/`sleep` keep it unit-testable.
 */
export async function probeIdentity(
  base: string,
  token: string,
  opts: {
    fetchImpl?: typeof fetch;
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ProbeResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? 100;
  const delayMs = opts.delayMs ?? 200;
  const wait = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${base.replace(/\/$/, "")}${IDENTITY_PATH}`;
  let claim: string | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await doFetch(url);
      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as { token?: unknown } | null;
        if (payload !== null && payload.token === token) return { ok: true, claim: null };
        claim =
          payload === null
            ? "the port answers, but not this run's identity probe"
            : "the port answers with another harness's identity token";
      }
    } catch {
      // Server not up yet.
    }
    await wait(delayMs);
  }
  return { ok: false, claim };
}
