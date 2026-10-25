import { h } from "hastscript";
import { z } from "zod";
import type { ElemntComponent } from "../types.js";

const props = z.object({ open: z.union([z.literal(""), z.literal("true"), z.literal("false")]).optional() });

/** A collapsible deep-dive for people. Agents always get the full text. */
export const details: ElemntComponent<z.infer<typeof props>> = {
  name: "details",
  kinds: ["containerDirective"],
  props,
  validate(node) {
    return node.children[0]?.data && "directiveLabel" in node.children[0].data ? [] : ["details needs a summary label, e.g. :::details[How it works]"];
  },
  render(node, { open }, ctx) {
    const isOpen = open === "" || open === "true";
    return h("details", { className: ["elemnt-details"], open: isOpen }, [h("summary", ctx.label(node)), ...ctx.children(node)]);
  },
  toMarkdown(node, _props, ctx) {
    return [{ type: "paragraph", children: [{ type: "strong", children: ctx.label(node) }] }, ...ctx.children(node)];
  },
  authoring: {
    doc: "Collapsible section for optional depth. Label is the visible summary; add {open} to start expanded.",
    snippet: ":::details[Why we use optimistic locking]\nTwo editors saving at once would otherwise...\n:::",
  },
};
