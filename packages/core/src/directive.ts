import type { Paragraph, PhrasingContent, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import type { DirectiveNode } from "./types.js";

/**
 * Data the validator attaches to each recognised directive. Plain data only, so
 * trees stay structured-cloneable (worker postMessage, caching); components are
 * looked up by name in the registry at compile time.
 */
export interface ElemntNodeData {
  props: unknown;
}

const DIRECTIVE_TYPES = new Set(["containerDirective", "leafDirective", "textDirective"]);

export function isDirective(node: { type: string }): node is DirectiveNode {
  return DIRECTIVE_TYPES.has(node.type);
}

export function elemntData(node: DirectiveNode): ElemntNodeData | undefined {
  return (node.data as { elemnt?: ElemntNodeData } | undefined)?.elemnt;
}

function isLabelParagraph(node: RootContent): node is Paragraph {
  return node.type === "paragraph" && Boolean((node.data as { directiveLabel?: boolean } | undefined)?.directiveLabel);
}

/**
 * Splits a directive into its `[label]` and its content.
 * Container directives carry the label as a flagged first paragraph;
 * leaf and text directives carry it as their phrasing children.
 */
export function splitDirective(node: DirectiveNode): { label: PhrasingContent[]; content: RootContent[] } {
  if (node.type === "containerDirective") {
    const [first, ...rest] = node.children;
    if (first && isLabelParagraph(first)) return { label: first.children, content: rest };
    return { label: [], content: node.children };
  }
  return { label: node.children, content: [] };
}

export function labelText(node: DirectiveNode): string | undefined {
  const { label } = splitDirective(node);
  if (label.length === 0) return undefined;
  const text = toString({ type: "paragraph", children: label }).trim();
  return text || undefined;
}

/** Non-whitespace content children, for structural validation. */
export function meaningfulChildren(content: RootContent[]): RootContent[] {
  return content.filter((c) => !(c.type === "text" && c.value.trim() === ""));
}
