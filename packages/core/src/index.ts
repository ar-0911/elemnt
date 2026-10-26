import { builtinComponents } from "./components/index.js";
import { toHtml, toHtmlTree, type HtmlOptions } from "./html.js";
import { toAgentMarkdown, toAgentMarkdownTree, type AgentMarkdownOptions } from "./markdown.js";
import { parseDocument } from "./parse.js";
import { toSlides, type Slide } from "./slides.js";
import type { AnyComponent, Diagnostic, DirectiveNode, Frontmatter, ParsedDocument } from "./types.js";
import { visit } from "unist-util-visit";
import { elemntData } from "./directive.js";
import { widgetCode, widgetHash, type WidgetCode } from "./components/widget.js";
import { collectRunbooks, type Runbook } from "./runbooks.js";

function collectWidgets(doc: ParsedDocument): CompileResult["widgets"] {
  const out: CompileResult["widgets"] = [];
  visit(doc.tree, "containerDirective", (node) => {
    const d = node as DirectiveNode;
    const data = elemntData(d);
    if (d.name !== "widget" || !data) return;
    const code = widgetCode(d);
    out.push({ hash: widgetHash(code), code, summary: (data.props as { summary: string }).summary });
  });
  return out;
}

export * from "./types.js";
export * from "./components/index.js";
export { elemntSanitizeSchema, slugify } from "./html.js";
export { contentCss, themeTokensCss } from "./theme.js";
export { evaluate, exprVariables, formatNumber, parseExpr, ExprError } from "./expr.js";
export { sha256Hex } from "./sha256.js";
export type { AgentMarkdownOptions, HtmlOptions, Slide };
export type { Runbook, RunbookStep } from "./runbooks.js";

export interface CompileResult {
  /** HTML fragment for people. Interactive parts are custom elements that hydrate on the client. */
  html: string;
  /** Plain Markdown for agents, served at `page.md` and through MCP. */
  markdown: string;
  frontmatter: Frontmatter;
  diagnostics: Diagnostic[];
  /** True when there are no error diagnostics. Saving is blocked otherwise. */
  ok: boolean;
  /** Every valid `:::widget` on the page, by content hash, for the sandbox to serve. */
  widgets: { hash: string; code: WidgetCode; summary: string }[];
}

export interface Elemnt {
  readonly components: ReadonlyMap<string, AnyComponent>;
  parse(source: string): ParsedDocument;
  toHtml(doc: ParsedDocument, options?: HtmlOptions): string;
  toHtmlTree(doc: ParsedDocument, options?: HtmlOptions): ReturnType<typeof toHtmlTree>;
  toAgentMarkdown(doc: ParsedDocument, options?: AgentMarkdownOptions): string;
  toAgentMarkdownTree(doc: ParsedDocument, options?: AgentMarkdownOptions): ReturnType<typeof toAgentMarkdownTree>;
  /** Present mode: the page split into slides at h1/h2 and `---`. */
  toSlides(doc: ParsedDocument): Slide[];
  /** Parse once, produce both projections. */
  compile(source: string): CompileResult;
  /** Runbooks on the page, structured for an agent to run (MCP `get_runbook`). */
  runbooks(source: string): Runbook[];
  /** Markdown guide to every registered component, for the `/` menu and MCP `get_authoring_guide`. */
  authoringGuide(): string;
}

export interface ElemntOptions {
  /** Defaults to the built-in set. Pass `[...builtinComponents, mine]` to extend. */
  components?: readonly AnyComponent[];
}

export function createElemnt(options: ElemntOptions = {}): Elemnt {
  const registry = new Map<string, AnyComponent>();
  for (const c of options.components ?? builtinComponents) {
    if (registry.has(c.name)) throw new Error(`Duplicate component name "${c.name}"`);
    registry.set(c.name, c);
  }

  return {
    components: registry,
    parse: (source) => parseDocument(source, registry),
    toHtml: (doc, o) => toHtml(doc, registry, o),
    toHtmlTree: (doc, o) => toHtmlTree(doc, registry, o),
    toAgentMarkdown: (doc, o) => toAgentMarkdown(doc, registry, o),
    toAgentMarkdownTree: (doc, o) => toAgentMarkdownTree(doc, registry, o),
    toSlides: (doc) => toSlides(doc, registry),
    compile(source) {
      const doc = parseDocument(source, registry);
      return {
        html: toHtml(doc, registry),
        markdown: toAgentMarkdown(doc, registry),
        frontmatter: doc.frontmatter,
        diagnostics: doc.diagnostics,
        ok: !doc.diagnostics.some((d) => d.severity === "error"),
        widgets: collectWidgets(doc),
      };
    },
    runbooks: (source) => collectRunbooks(parseDocument(source, registry)),
    authoringGuide() {
      const sections = [...registry.values()].map(
        (c) => `## ${c.name}\n\n${c.authoring.doc}\n\n~~~~md\n${c.authoring.snippet}\n~~~~`,
      );
      return [
        "# Elemnt authoring guide",
        "Pages are CommonMark + GFM. Components use directive syntax: `:::name[label]{key=value}` ... `:::`. Nest by adding a colon to the outer fence.",
        ...sections,
      ].join("\n\n") + "\n";
    },
  };
}
