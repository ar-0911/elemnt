import { isDark } from "./theme.js";

interface Mermaid {
  initialize(config: Record<string, unknown>): void;
  run(options: { nodes: HTMLElement[] }): Promise<void>;
}
export type MermaidLoader = () => Promise<{ default: Mermaid }>;

const CDN = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
const fromCdn: MermaidLoader = () => import(/* @vite-ignore */ CDN);

export function enhanceMermaid(root: ParentNode, load: MermaidLoader = fromCdn): void {
  const nodes = [...root.querySelectorAll<HTMLElement>("pre.mermaid:not([data-processed])")];
  if (!nodes.length) return;
  void load()
    .then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark() ? "dark" : "default" });
      await mermaid.run({ nodes });
    })
    .catch(() => {
      // A diagram that fails to load or parse stays as readable source text.
    });
}
