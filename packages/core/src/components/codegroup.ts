import { h } from "hastscript";
import type { Code } from "mdast";
import { z } from "zod";
import type { ElemntComponent, MarkdownContent } from "../types.js";

const props = z.object({});

/** `title="curl"` in the fence meta, else the language. */
export function codeLabel(code: Code): string {
  return code.meta?.match(/title="([^"]+)"/)?.[1] ?? code.meta?.match(/title=(\S+)/)?.[1] ?? code.lang ?? "Code";
}

function codes(children: readonly { type: string }[]): Code[] {
  return children.filter((c): c is Code => c.type === "code");
}

/**
 * Alternative code blocks as tabs: one request in curl, TypeScript and Python.
 * Shares the tabs runtime; agents get each block under its label.
 */
export const codegroup: ElemntComponent<z.infer<typeof props>> = {
  name: "codegroup",
  kinds: ["containerDirective"],
  props,
  validate(_node, _props, { children }) {
    if (children.length < 2) return ["codegroup needs at least two code blocks"];
    return children.every((c) => c.type === "code") ? [] : ["codegroup may only contain code blocks"];
  },
  render(node) {
    return h("elemnt-tabs", [
      h(
        "div",
        { className: ["elemnt-tabs", "elemnt-codegroup"] },
        codes(node.children).map((c) =>
          h("section", { className: ["elemnt-tab"], dataLabel: codeLabel(c) }, [
            h("p", { className: ["elemnt-tab-label"] }, codeLabel(c)),
            h("pre", [h("code", { className: c.lang ? [`language-${c.lang}`] : [] }, c.value)]),
          ]),
        ),
      ),
    ]);
  },
  toMarkdown(node, _props, ctx) {
    return codes(node.children).flatMap((c): MarkdownContent[] => [
      { type: "heading", depth: ctx.headingDepth(node), children: [{ type: "text", value: codeLabel(c) }] },
      { type: "code", lang: c.lang ?? null, meta: null, value: c.value },
    ]);
  },
  authoring: {
    doc: 'The same thing in several languages, shown as tabs. Contains only code blocks; label each with title="…" or let the language name it.',
    snippet: ':::codegroup\n```sh title="curl"\ncurl -H "Authorization: Bearer $KEY" https://api.acme.dev/v1/users\n```\n```ts title="TypeScript"\nawait acme.users.list();\n```\n:::',
  },
};
