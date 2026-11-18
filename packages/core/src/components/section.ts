import { h } from "hastscript";
import { z } from "zod";
import type { ElemntComponent } from "../types.js";

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** `use` picks the site partial; every other attribute is passed to it as a prop. */
const props = z.object({ use: z.string().regex(NAME, 'use must be a partial name like "hero" or "feature-grid"') }).catchall(z.string());

/**
 * A designed section inside Markdown. On a project website it is replaced by
 * the site's own `partials/<use>.liquid`, rendered with the attributes as
 * `props` and the content as `content`, so the design (free HTML, CSS, JS,
 * 3D) stays in the site while the words stay in Markdown. Everywhere else
 * (the reader, the editor preview, agents) only the content shows.
 */
export const section: ElemntComponent<z.infer<typeof props>> = {
  name: "section",
  kinds: ["containerDirective", "leafDirective"],
  props,
  render(node, { use, ...rest }, ctx) {
    return h("div", { className: ["elemnt-section"], dataUse: use, dataProps: JSON.stringify(rest) }, node.type === "containerDirective" ? ctx.children(node) : []);
  },
  toMarkdown(node, _props, ctx) {
    return node.type === "containerDirective" ? ctx.children(node) : [];
  },
  authoring: {
    doc: "Project websites only: drops the site's designed partial (partials/<use>.liquid) here, e.g. a 3D hero or a feature grid. Attributes become the partial's props; the content inside becomes its content. Outside a site only the content shows.",
    snippet: ':::section{use="hero" eyebrow="Docs that feel like a website"}\n# Elemnt\n\nMarkdown in, immersive pages out.\n:::',
  },
};
