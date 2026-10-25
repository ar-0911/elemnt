import { h } from "hastscript";
import type { PhrasingContent } from "mdast";
import { z } from "zod";
import type { ElemntComponent, MarkdownContent } from "../types.js";

const TYPES = { note: "Note", tip: "Tip", warn: "Warning", danger: "Danger" } as const;

const props = z.object({
  type: z.enum(["note", "tip", "warn", "danger"]).default("note"),
});

/** A highlighted aside. `:::callout[Optional title]{type=warn}` */
export const callout: ElemntComponent<z.infer<typeof props>> = {
  name: "callout",
  kinds: ["containerDirective"],
  props,
  render(node, { type }, ctx) {
    const label = ctx.label(node);
    return h("aside", { className: ["elemnt-callout"], dataType: type, role: "note" }, [
      h("p", { className: ["elemnt-callout-title"] }, label.length ? label : [TYPES[type]]),
      ...ctx.children(node),
    ]);
  },
  toMarkdown(node, { type }, ctx) {
    const label: PhrasingContent[] = ctx.label(node);
    const title: PhrasingContent = { type: "strong", children: label.length ? label : [{ type: "text", value: TYPES[type] }] };
    const prefix: PhrasingContent[] = [title, { type: "text", value: label.length ? ` (${TYPES[type].toLowerCase()}): ` : ": " }];
    const children = ctx.children(node);
    const [first, ...rest] = children;
    // Fold the label into the first paragraph so the callout reads as one quoted note.
    const body: MarkdownContent[] =
      first?.type === "paragraph"
        ? [{ ...first, children: [...prefix, ...first.children] }, ...rest]
        : [{ type: "paragraph", children: prefix.slice(0, 1) }, ...children];
    return [{ type: "blockquote", children: body as never }];
  },
  authoring: {
    doc: "Highlighted note, tip, warning or danger box. Optional [title].",
    snippet: ":::callout[Before you deploy]{type=warn}\nMigrations run automatically. Back up first.\n:::",
  },
};
