import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

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
  server: {
    port: Number(process.env.HARNESS_PORT ?? 5173),
    strictPort: true,
    // The harness imports the plugin's compiled CSS from ../../dist/, which
    // sits outside this config root; without this allowance vite 403s it.
    fs: { allow: [repoRoot] },
  },
});