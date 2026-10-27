import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { IDENTITY_ENV, identityPayload } from "../uat/harness-identity.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: here,
  resolve: {
    alias: [
      // The harness renders the real app against a simulated SDK.
      {
        find: /^@get-bb\/plugin-sdk\/app$/,
        replacement: fileURLToPath(new URL("./mock-sdk.tsx", import.meta.url)),
      },
    ],
  },
  plugins: [
    // Per-run identity (scripts/uat/harness-identity.ts): the starter's handshake
    // reads this endpoint and refuses a port owned by another tree's run.
    {
      name: "activity-overview-harness-identity",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const payload = identityPayload((req.url ?? "").split("?")[0], process.env[IDENTITY_ENV]);
          if (payload === null) return next();
          res.statusCode = payload.status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(payload.body));
        });
      },
    },
  ],
  server: {
    port: Number(process.env.HARNESS_PORT ?? 5173),
    strictPort: true,
    // The harness imports the plugin's compiled CSS from ../../dist/, which
    // sits outside this config root; without this allowance vite 403s it.
    fs: { allow: [repoRoot] },
  },
});