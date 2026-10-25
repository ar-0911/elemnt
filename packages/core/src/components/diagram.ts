import { h } from "hastscript";
import type { Code } from "mdast";
import { z } from "zod";
import type { ElemntComponent } from "../types.js";

const props = z.object({ caption: z.string().max(300).optional() });

const LANGS = new Set(["mermaid"]);

function codeOf(children: readonly { type: string }[]): Code | undefined {
  return children.length === 1 && children[0]?.type === "code" ? (children[0] as Code) : undefined;
}

/**
 * A diagram from text. People get a rendered, zoomable diagram; agents get the
 * Mermaid source, which models read better than any picture of it.
 */
export const diagram: ElemntComponent<z.infer<typeof props>> = {
  name: "diagram",
  kinds: ["containerDirective"],
  props,
  validate(_node, _props, { children }) {
    const code = codeOf(children);
    if (!code) return ["diagram must contain exactly one ```mermaid code block"];
    return code.lang && LANGS.has(code.lang) ? [] : [`diagram language "${code.lang ?? ""}" is not supported; use mermaid`];
  },
  render(node, { caption }, ctx) {
    const code = codeOf(node.children);
    const lang = code?.lang ?? "mermaid";
    return h("figure", { className: ["elemnt-diagram"] }, [
      h("elemnt-diagram", { dataLang: lang }, [h("pre", { className: [lang] }, code?.value ?? "")]),
      ...(caption ? [h("figcaption", caption)] : ctx.label(node).length ? [h("figcaption", ctx.label(node))] : []),
    ]);
  },
  toMarkdown(node, { caption }, ctx) {
    const text = caption ?? ctx.labelText(node);
    return [
      ...(text ? [{ type: "paragraph" as const, children: [{ type: "emphasis" as const, children: [{ type: "text" as const, value: `Diagram: ${text}` }] }] }] : []),
      ...ctx.children(node),
    ];
  },
  authoring: {
    doc: "Diagram from Mermaid source (flowchart, sequence, state, ER). Optional caption.",
    snippet: ':::diagram{caption="Request path"}\n```mermaid\nflowchart LR\n  Browser --> API --> Postgres\n```\n:::',
  },
};
