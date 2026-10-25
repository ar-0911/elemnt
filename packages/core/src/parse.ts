import type { Root, RootContent, Text } from "mdast";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { isDirective, meaningfulChildren, splitDirective, type ElemntNodeData } from "./directive.js";
import type { AnyComponent, Diagnostic, DirectiveNode, Frontmatter, ParsedDocument } from "./types.js";

const frontmatterSchema = z
  .object({
    title: z.string().optional(),
    summary: z.string().optional(),
  })
  .passthrough();

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkDirective);

function at(node: { position?: { start: { line: number; column: number } } }) {
  return node.position ? { line: node.position.start.line, column: node.position.start.column } : {};
}

function readFrontmatter(tree: Root, diagnostics: Diagnostic[]): Frontmatter {
  const first = tree.children[0];
  if (first?.type !== "yaml") return {};
  tree.children.shift();
  let raw: unknown;
  try {
    raw = parseYaml(first.value) ?? {};
  } catch (err) {
    diagnostics.push({ severity: "error", message: `Frontmatter is not valid YAML: ${(err as Error).message}`, ...at(first) });
    return {};
  }
  const result = frontmatterSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      diagnostics.push({ severity: "error", message: `Frontmatter ${issue.path.join(".") || "root"}: ${issue.message}`, ...at(first) });
    }
    return {};
  }
  return result.data as Frontmatter;
}

/** Rebuilds the literal source of an unknown text directive, e.g. `10:30` or `ratio:high`. */
function textDirectiveAsText(node: DirectiveNode): Text {
  const label = node.children.length ? `[${node.children.map((c) => ("value" in c ? c.value : "")).join("")}]` : "";
  const attrs = Object.entries(node.attributes ?? {});
  const attrText = attrs.length ? `{${attrs.map(([k, v]) => (v ? `${k}="${v}"` : k)).join(" ")}}` : "";
  return { type: "text", value: `:${node.name}${label}${attrText}`, ...(node.position ? { position: node.position } : {}) };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

/**
 * Parses Elemnt source into an mdast tree, validates every directive against
 * the component registry, and attaches parsed props to recognised nodes.
 * Never throws on bad input: problems come back as diagnostics.
 */
export function parseDocument(source: string, registry: ReadonlyMap<string, AnyComponent>): ParsedDocument {
  const diagnostics: Diagnostic[] = [];
  const tree = processor.runSync(processor.parse(source)) as Root;
  const frontmatter = readFrontmatter(tree, diagnostics);

  visit(tree, (node, index, parent) => {
    if (!isDirective(node)) return;
    const component = registry.get(node.name);

    if (!component) {
      if (node.type === "textDirective" && parent && index !== undefined) {
        // `:name` inside prose is almost always literal text ("at 10:30"), not a component.
        parent.children.splice(index, 1, textDirectiveAsText(node) as RootContent as never);
        return [SKIP, index];
      }
      diagnostics.push({ severity: "error", message: `Unknown component "${node.name}"`, component: node.name, ...at(node) });
      return;
    }

    if (!component.kinds.includes(node.type)) {
      const forms = component.kinds.map((k) => ({ containerDirective: ":::", leafDirective: "::", textDirective: ":" })[k] + node.name).join(" or ");
      diagnostics.push({ severity: "error", message: `"${node.name}" must be written as ${forms}`, component: node.name, ...at(node) });
      return;
    }

    const parsed = component.props.safeParse(node.attributes ?? {});
    if (!parsed.success) {
      diagnostics.push({ severity: "error", message: `Invalid props: ${formatIssues(parsed.error)}`, component: node.name, ...at(node) });
      return;
    }

    const parentDirective = parent && isDirective(parent) ? parent : undefined;
    const problems =
      component.validate?.(node, parsed.data, { parent: parentDirective, children: meaningfulChildren(splitDirective(node).content) }) ?? [];
    for (const message of problems) {
      diagnostics.push({ severity: "error", message, component: node.name, ...at(node) });
    }

    const data: ElemntNodeData = { props: parsed.data };
    node.data = { ...node.data, elemnt: data } as unknown as typeof node.data;
  });

  return { tree, frontmatter, diagnostics };
}
