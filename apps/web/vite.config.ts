import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Follows a dependency chain from @elemnt/core, for transitive packages pnpm doesn't hoist. */
function resolveFromCore(...chain: string[]): string {
  let from = fileURLToPath(new URL("../../packages/core/package.json", import.meta.url));
  for (const name of chain) from = createRequire(from).resolve(name);
  return from;
}

// The browser build of this entity decoder uses `document`, which the compile worker doesn't have.
const decodeEntity = resolveFromCore("remark-parse", "mdast-util-from-markdown", "micromark", "decode-named-character-reference");

export default defineConfig({
  base: "/app/",
  plugins: [react()],
  resolve: {
    alias: {
      "@elemnt/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "decode-named-character-reference": decodeEntity,
    },
  },
  worker: { format: "es" },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787", "/s": "http://localhost:8787", "/login": "http://localhost:8787", "/integrations": "http://localhost:8787" },
  },
});
