import { h } from "hastscript";
import { z } from "zod";
import { isDirective } from "../directive.js";
import type { ElemntComponent } from "../types.js";

const empty = z.object({});

/** Side by side: before and after, old API and new, wrong and right. */
export const compare: ElemntComponent<z.infer<typeof empty>> = {
  name: "compare",
  kinds: ["containerDirective"],
  props: empty,
  validate(_node, _props, { children }) {
    const sides = children.filter((c) => isDirective(c) && c.name === "side");
    return sides.length === 2 && sides.length === children.length ? [] : ["compare must contain exactly two :::side[Label] blocks; wrap with four colons"];
  },
  render(node, _props, ctx) {
    return h("div", { className: ["elemnt-compare"] }, ctx.children(node));
  },
  toMarkdown(node, _props, ctx) {
    return ctx.children(node);
  },
  authoring: {
    doc: "Two panels side by side. Contains exactly two :::side[Label] blocks.",
    snippet: "::::compare\n:::side[Before]\n```js\nfetch(url).then(r => r.json())\n```\n:::\n:::side[After]\n```js\nawait acme.get(url)\n```\n:::\n::::",
  },
};

export const side: ElemntComponent<z.infer<typeof empty>> = {
  name: "side",
  kinds: ["containerDirective"],
  props: empty,
  validate(node, _props, { parent }) {
    const problems: string[] = [];
    if (parent?.name !== "compare") problems.push("side must be inside ::::compare");
    if (!(node.children[0]?.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) problems.push("side needs a label, e.g. :::side[Before]");
    return problems;
  },
  render(node, _props, ctx) {
    return h("section", { className: ["elemnt-side"] }, [h("p", { className: ["elemnt-side-label"] }, ctx.label(node)), ...ctx.children(node)]);
  },
  toMarkdown(node, _props, ctx) {
    return [{ type: "heading", depth: ctx.headingDepth(node), children: ctx.label(node) }, ...ctx.children(node)];
  },
  authoring: { doc: "One panel of ::::compare.", snippet: ":::side[Before]\n...\n:::" },
};
