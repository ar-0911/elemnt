import type { ElementContent } from "hast";
import type { BlockContent, DefinitionContent, PhrasingContent, Root, RootContent } from "mdast";
import type { ContainerDirective, LeafDirective, TextDirective } from "mdast-util-directive";
import type { z } from "zod";

export type DirectiveNode = ContainerDirective | LeafDirective | TextDirective;
export type DirectiveKind = DirectiveNode["type"];

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** Component name, when the diagnostic belongs to a directive. */
  component?: string;
  /** 1-based source position of the offending node. */
  line?: number;
  column?: number;
}

export interface Frontmatter {
  title?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface ParsedDocument {
  tree: Root;
  frontmatter: Frontmatter;
  diagnostics: Diagnostic[];
}

/** Helpers a component gets while rendering HTML for people. */
export interface HtmlContext {
  /** The directive's content rendered to hast, label excluded. */
  children(node: DirectiveNode): ElementContent[];
  /** The `[label]` rendered to hast, or an empty array. */
  label(node: DirectiveNode): ElementContent[];
  /** The `[label]` as plain text, or undefined. */
  labelText(node: DirectiveNode): string | undefined;
}

export type MarkdownContent = RootContent | BlockContent | DefinitionContent | PhrasingContent;

/** Helpers a component gets while projecting itself to Markdown for agents. */
export interface MarkdownContext {
  /** The directive's content, already projected, label excluded. */
  children(node: DirectiveNode): MarkdownContent[];
  /** The `[label]` as phrasing content, already projected. */
  label(node: DirectiveNode): PhrasingContent[];
  labelText(node: DirectiveNode): string | undefined;
  /** Depth for a heading that sits one level below the surrounding section (2–6). */
  headingDepth(node: DirectiveNode): 2 | 3 | 4 | 5 | 6;
  /** The directive this one is nested in, if any. */
  parent(node: DirectiveNode): DirectiveNode | undefined;
}

export interface ValidationContext {
  parent: DirectiveNode | undefined;
  /** Content children, label excluded. */
  children: RootContent[];
}

/**
 * The contract every Elemnt component implements, built-in or user-defined.
 * `render` produces HTML for people; `toMarkdown` is required so agents never
 * see an empty hole where a component was.
 */
export interface ElemntComponent<P = Record<string, unknown>> {
  name: string;
  /** Which directive forms are allowed: `:::name` container, `::name` leaf, `:name` text. */
  kinds: readonly DirectiveKind[];
  /** Validates and coerces directive attributes, e.g. `{type=warn}`. */
  props: z.ZodType<P>;
  /** Structural checks beyond props. Return messages; each becomes an error diagnostic. */
  validate?(node: DirectiveNode, props: P, ctx: ValidationContext): string[];
  render(node: DirectiveNode, props: P, ctx: HtmlContext): ElementContent | ElementContent[];
  toMarkdown(node: DirectiveNode, props: P, ctx: MarkdownContext): MarkdownContent[];
  authoring: {
    /** Short description for the `/` menu and the MCP authoring guide. */
    doc: string;
    /** A complete, valid example. */
    snippet: string;
  };
}

/** Erases the props type so heterogeneous components can share one registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponent = ElemntComponent<any>;
