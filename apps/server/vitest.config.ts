import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against core's source so a core change doesn't need a rebuild first.
    alias: { "@elemnt/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) },
  },
  test: { testTimeout: 20_000 },
});
