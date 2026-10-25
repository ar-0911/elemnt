import { h } from "hastscript";
import { z } from "zod";
import type { ElemntComponent } from "../types.js";

const props = z.object({ caption: z.string().max(300).optional() });

/** A table people can sort and filter. Agents get the plain GFM table. */
export const datagrid: ElemntComponent<z.infer<typeof props>> = {
  name: "datagrid",
  kinds: ["containerDirective"],
  props,
  validate(_node, _props, { children }) {
    return children.length === 1 && children[0]!.type === "table" ? [] : ["datagrid must contain exactly one Markdown table"];
  },
  render(node, { caption }, ctx) {
    const text = caption ?? ctx.labelText(node);
    return h("figure", { className: ["elemnt-datagrid"] }, [h("elemnt-datagrid", ctx.children(node)), ...(text ? [h("figcaption", text)] : [])]);
  },
  toMarkdown(node, { caption }, ctx) {
    const text = caption ?? ctx.labelText(node);
    return [...(text ? [{ type: "paragraph" as const, children: [{ type: "emphasis" as const, children: [{ type: "text" as const, value: text }] }] }] : []), ...ctx.children(node)];
  },
  authoring: {
    doc: "A Markdown table readers can sort (click a header) and filter. Good for reference data: limits, flags, error codes.",
    snippet: ':::datagrid{caption="Rate limits by plan"}\n| Plan | Requests/min | Burst |\n| --- | --- | --- |\n| Free | 60 | 10 |\n| Team | 600 | 100 |\n:::',
  },
};
