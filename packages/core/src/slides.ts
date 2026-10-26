import type { Heading, Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import { toHtml } from "./html.js";
import type { AnyComponent, ParsedDocument } from "./types.js";

export interface Slide {
  /** Text of the slide's heading, or the page title for the title slide. */
  title: string | undefined;
  html: string;
  /** The title slide made from frontmatter. */
  cover?: boolean;
}

/**
 * Present mode: the same page as a deck. A new slide starts at every h1 or h2
 * (also one that opens a container such as `:::band`) and at every `---`.
 * Frontmatter title and summary become a title slide. Slides that are still
 * too long are split again in the browser, where they can be measured.
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
    if (leadHeading(node)) flush();
    current.push(node);
  }
  flush();

  const slides: Slide[] = [];
  const { title, summary } = doc.frontmatter;
  if (title) {
    const children: RootContent[] = [{ type: "heading", depth: 1, children: [{ type: "text", value: title }] }];
    if (summary) children.push({ type: "paragraph", children: [{ type: "text", value: summary }] });
    slides.push({ title, html: render(children), cover: true });
  }
  for (const group of groups) {
    const lead = group[0] && leadHeading(group[0]);
    const heading = lead ? toString(lead) : undefined;
    slides.push({ title: heading, html: render(group) });
  }
  return slides;

  function render(children: RootContent[]): string {
    const tree: Root = { type: "root", children };
    return toHtml({ ...doc, tree }, registry);
  }
}

/** The h1 or h2 a block starts with: the block itself, or the first child of a container directive. */
function leadHeading(node: RootContent): Heading | undefined {
  if (node.type === "heading") return node.depth <= 2 ? node : undefined;
  if (node.type !== "containerDirective") return undefined;
  const first = node.children.find((c) => !(c.type === "paragraph" && c.data?.directiveLabel));
  return first?.type === "heading" && first.depth <= 2 ? first : undefined;
}
