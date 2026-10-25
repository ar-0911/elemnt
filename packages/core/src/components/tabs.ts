import { h } from "hastscript";
import { z } from "zod";
import { isDirective } from "../directive.js";
import type { ElemntComponent } from "../types.js";

const tabsProps = z.object({});
const tabProps = z.object({});

/**
 * Switchable panels. Server HTML is every panel in order with its heading, so
 * the page reads fine before JavaScript; `<elemnt-tabs>` turns it into a tablist.
 */
export const tabs: ElemntComponent<z.infer<typeof tabsProps>> = {
  name: "tabs",
  kinds: ["containerDirective"],
  props: tabsProps,
  validate(_node, _props, { children }) {
    if (children.length === 0) return ["tabs needs at least one :::tab"];
    const stray = children.filter((c) => !(isDirective(c) && c.name === "tab"));
    return stray.length ? ["tabs may only contain :::tab blocks"] : [];
  },
  render(node, _props, ctx) {
    return h("elemnt-tabs", [h("div", { className: ["elemnt-tabs"] }, ctx.children(node))]);
  },
  toMarkdown(node, _props, ctx) {
    return ctx.children(node);
  },
  authoring: {
    doc: "Switchable panels, e.g. one per language or platform. Contains only :::tab[Label] blocks; wrap with four colons.",
    snippet: "::::tabs\n:::tab[npm]\n```sh\nnpm i @acme/sdk\n```\n:::\n:::tab[pnpm]\n```sh\npnpm add @acme/sdk\n```\n:::\n::::",
  },
};

export const tab: ElemntComponent<z.infer<typeof tabProps>> = {
  name: "tab",
  kinds: ["containerDirective"],
  props: tabProps,
  validate(node, _props, { parent }) {
    const problems: string[] = [];
    if (parent?.name !== "tabs") problems.push("tab must be inside ::::tabs");
    if (!node.children[0]?.data || !("directiveLabel" in (node.children[0].data ?? {}))) problems.push("tab needs a label, e.g. :::tab[curl]");
    return problems;
  },
  render(node, _props, ctx) {
    const label = ctx.labelText(node) ?? "";
    return h("section", { className: ["elemnt-tab"], dataLabel: label }, [
      h("p", { className: ["elemnt-tab-label"] }, ctx.label(node)),
      ...ctx.children(node),
    ]);
  },
  toMarkdown(node, _props, ctx) {
    return [{ type: "heading", depth: ctx.headingDepth(node), children: ctx.label(node) }, ...ctx.children(node)];
  },
  authoring: { doc: "One panel inside ::::tabs. Label goes in brackets.", snippet: ":::tab[curl]\n...\n:::" },
};
