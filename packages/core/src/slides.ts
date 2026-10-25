import type { Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import { toHtml } from "./html.js";
import type { AnyComponent, ParsedDocument } from "./types.js";

export interface Slide {
  /** Text of the slide's heading, or the page title for the title slide. */
  title: string | undefined;
  html: string;
}

/**
 * Present mode: the same page as a deck. A new slide starts at every h1 or h2
 * and at every `---`. Frontmatter title and summary become a title slide.
 */
export function toSlides(doc: ParsedDocument, registry: ReadonlyMap<string, AnyComponent>): Slide[] {
  const groups: RootContent[][] = [];
  let current: RootContent[] = [];
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };

  for (const node of doc.tree.children) {
    if (node.type === "thematicBreak") {
      flush();
      continue;
    }
    if (node.type === "heading" && node.depth <= 2) flush();
    current.push(node);
  }
  flush();

  const slides: Slide[] = [];
  const { title, summary } = doc.frontmatter;
  if (title) {
    const children: RootContent[] = [{ type: "heading", depth: 1, children: [{ type: "text", value: title }] }];
    if (summary) children.push({ type: "paragraph", children: [{ type: "text", value: summary }] });
    slides.push({ title, html: render(children) });
  }
  for (const group of groups) {
    const heading = group[0]?.type === "heading" ? toString(group[0]) : undefined;
    slides.push({ title: heading, html: render(group) });
  }
  return slides;

  function render(children: RootContent[]): string {
    const tree: Root = { type: "root", children };
    return toHtml({ ...doc, tree }, registry);
  }
}
