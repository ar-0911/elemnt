import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// One self-contained ES module the reader loads; only the expression evaluator comes from core.
export default defineConfig({
  resolve: { alias: { "@elemnt/core/expr": fileURLToPath(new URL("../core/src/expr.ts", import.meta.url)) } },
  build: {
    lib: { entry: fileURLToPath(new URL("src/index.ts", import.meta.url)), formats: ["es"], fileName: () => "elements.js" },
    target: "es2022",
    sourcemap: true,
  },
  test: { environment: "happy-dom" },
});
