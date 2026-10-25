import { h } from "hastscript";
import { z } from "zod";
import type { ElemntComponent } from "../types.js";

const props = z.object({ def: z.string().min(3).max(400) });

/** A glossary term: a hover/focus card for people, an inline definition for agents. */
export const term: ElemntComponent<z.infer<typeof props>> = {
  name: "term",
  kinds: ["textDirective"],
  props,
  validate(node) {
    return node.children.length ? [] : ["term needs the word as its label, e.g. :term[idempotent]{def=\"…\"}"];
  },
  render(node, { def }, ctx) {
    return h("dfn", { className: ["elemnt-term"], title: def, dataDef: def, tabIndex: 0 }, ctx.label(node));
  },
  toMarkdown(node, { def }, ctx) {
    return [...ctx.label(node), { type: "text", value: ` (${def})` }];
  },
  authoring: {
    doc: "Defines a term inline. Readers hover or focus it to see the definition.",
    snippet: 'Retries must be :term[idempotent]{def="Safe to repeat: doing it twice has the same effect as once."}.',
  },
};
