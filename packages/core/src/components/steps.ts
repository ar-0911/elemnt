import { h } from "hastscript";
import { z } from "zod";
import type { ElemntComponent } from "../types.js";

const props = z.object({});

/** A numbered walkthrough. Wraps one ordered list; each item is a step. */
export const steps: ElemntComponent<z.infer<typeof props>> = {
  name: "steps",
  kinds: ["containerDirective"],
  props,
  validate(_node, _props, { children }) {
    const only = children.length === 1 ? children[0] : undefined;
    return only?.type === "list" && only.ordered ? [] : ["steps must contain exactly one numbered list (1. 2. 3.)"];
  },
  render(node, _props, ctx) {
    return h("elemnt-steps", [h("div", { className: ["elemnt-steps"] }, ctx.children(node))]);
  },
  toMarkdown(node, _props, ctx) {
    return ctx.children(node);
  },
  authoring: {
    doc: "Numbered walkthrough with progress. Contains one numbered list; start each item with a bold step title.",
    snippet: ":::steps\n1. **Install** the CLI.\n2. **Log in** with `elemnt login`.\n3. **Push** your docs folder.\n:::",
  },
};
