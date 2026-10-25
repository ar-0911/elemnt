import type { Heading, Parent, PhrasingContent, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { elemntData, isDirective, labelText, splitDirective } from "./directive.js";
import type { AnyComponent, DirectiveNode, MarkdownContent, MarkdownContext, ParsedDocument } from "./types.js";

const stringifier = unified().use(remarkGfm).use(remarkStringify, {
  bullet: "-",
  emphasis: "_",
  fences: true,
  rule: "-",
  listItemIndent: "one",
});

export interface AgentMarkdownOptions {
  /** Prepend `# title` and `> summary` from frontmatter when the body has no h1. Default true. */
  header?: boolean;
}

/** Depth of the closest heading before each directive, in document order. */
function sectionDepths(tree: Root): WeakMap<DirectiveNode, number> {
  const depths = new WeakMap<DirectiveNode, number>();
  let current = 1;
  visit(tree, (node) => {
    if (node.type === "heading") current = (node as Heading).depth;
    else if (isDirective(node)) depths.set(node, current);
  });
  return depths;
}

/**
 * Projects a validated document to plain Markdown for agents: every component
 * replaced by its `toMarkdown` output, nothing hidden, no custom syntax left.
 */
export function toAgentMarkdownTree(doc: ParsedDocument, registry: ReadonlyMap<string, AnyComponent>, options: AgentMarkdownOptions = {}): Root {
  const tree = structuredClone(doc.tree);
  const depths = sectionDepths(tree);

  const ctx: MarkdownContext = {
    children: (node) => project(splitDirective(node).content),
    label: (node) => project(splitDirective(node).label) as PhrasingContent[],
    labelText,
    headingDepth: (node) => Math.min(6, Math.max(2, (depths.get(node) ?? 1) + 1)) as 2 | 3 | 4 | 5 | 6,
  };

  function project(nodes: readonly MarkdownContent[]): MarkdownContent[] {
    const out: MarkdownContent[] = [];
    for (const node of nodes) {
      if (isDirective(node)) {
        const data = elemntData(node);
        const component = data && registry.get(node.name);
        // Invalid directives degrade to their content so agents still get the words.
        out.push(...(component ? component.toMarkdown(node, data.props, ctx) : ctx.children(node)));
      } else if ("children" in node) {
        (node as Parent).children = project((node as Parent).children) as Parent["children"];
        out.push(node);
      } else {
        out.push(node);
      }
    }
    return out;
  }

  tree.children = project(tree.children) as RootContent[];

  const { title, summary } = doc.frontmatter;
  const hasH1 = tree.children.some((n) => n.type === "heading" && n.depth === 1);
  if (options.header !== false && title && !hasH1) {
    const header: RootContent[] = [{ type: "heading", depth: 1, children: [{ type: "text", value: title }] }];
    if (summary) header.push({ type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: summary }] }] });
    tree.children.unshift(...header);
  }
  return tree;
}

export function toAgentMarkdown(doc: ParsedDocument, registry: ReadonlyMap<string, AnyComponent>, options: AgentMarkdownOptions = {}): string {
  return stringifier.stringify(toAgentMarkdownTree(doc, registry, options));
}
