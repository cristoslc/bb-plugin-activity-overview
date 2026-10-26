// Contract tests for the per-run harness identity (scripts/uat/harness-identity.ts):
// the endpoint's payload, and the handshake that accepts this run's token but
// rejects a foreign server loudly. These are the properties that keep a
// release-gate run from photographing another tree's harness.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IDENTITY_PATH,
  probeIdentity,
  identityPayload,
} from "../scripts/uat/harness-identity.ts";

test("identityPayload ignores any path but the identity endpoint", () => {
  assert.equal(identityPayload("/", "tok"), null);
  assert.equal(identityPayload("/plugins/activity-overview/board", "tok"), null);
  assert.equal(identityPayload(`${IDENTITY_PATH}/extra`, "tok"), null);
});

test("identityPayload echoes the process token at the identity path", () => {
  assert.deepEqual(identityPayload(IDENTITY_PATH, "tok-123"), {
    status: 200,
    body: { token: "tok-123" },
  });
});

test("identityPayload reports a null token when none was set", () => {
  assert.deepEqual(identityPayload(IDENTITY_PATH, undefined), {
    status: 200,
    body: { token: null },
  });
});

/** A fetch stub that serves a JSON body, or throws while "not up yet". */
function stubFetch(bodies: Array<unknown | Error>): { impl: typeof fetch; calls: () => number } {
  let i = 0;
  const impl = (async () => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    if (body instanceof Error) throw body;
    return {
      ok: true,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls: () => i };
}

test("probeIdentity resolves ok once the harness echoes this run's token", async () => {
  const { impl } = stubFetch([{ token: "mine" }]);
  const result = await probeIdentity("http://localhost:5173/", "mine", {
    fetchImpl: impl,
    sleep: async () => {},
  });
  assert.deepEqual(result, { ok: true, claim: null });
});

test("probeIdentity retries through not-up-yet before succeeding", async () => {
  const { impl, calls } = stubFetch([new Error("ECONNREFUSED"), new Error("ECONNREFUSED"), { token: "mine" }]);
  const result = await probeIdentity("http://localhost:5173/", "mine", {
    fetchImpl: impl,
    sleep: async () => {},
  });
  assert.deepEqual(result, { ok: true, claim: null });
  assert.equal(calls(), 3);
});

test("probeIdentity rejects a foreign server holding another token", async () => {
  const { impl } = stubFetch([{ token: "someone-else" }]);
  const result = await probeIdentity("http://localhost:5173/", "mine", {
    fetchImpl: impl,
    attempts: 3,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.claim ?? "", /another harness's identity token/);
});

test("probeIdentity flags a server that answers but is not the probe", async () => {
  const { impl } = stubFetch([null]);
  const result = await probeIdentity("http://localhost:5173/", "mine", {
    fetchImpl: impl,
    attempts: 2,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.claim ?? "", /not this run's identity probe/);
});

test("probeIdentity gives up with no claim of a foreign server when nothing answers", async () => {
  const { impl, calls } = stubFetch([new Error("ECONNREFUSED")]);
  const result = await probeIdentity("http://localhost:5173/", "mine", {
    fetchImpl: impl,
    attempts: 4,
    sleep: async () => {},
  });
  assert.deepEqual(result, { ok: false, claim: null });
  assert.equal(calls(), 4);
});
