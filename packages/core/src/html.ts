import type { Element, Root as HastRoot } from "hast";
import { defaultSchema, sanitize, type Schema } from "hast-util-sanitize";
import { toHtml as hastToHtml } from "hast-util-to-html";
import type { Code } from "mdast";
import { defaultHandlers, toHast, type Handler, type State } from "mdast-util-to-hast";
import { h } from "hastscript";
import { runtimeFor, wantsRun } from "./runnable.js";
import { elemntData, labelText, splitDirective } from "./directive.js";
import type { AnyComponent, DirectiveNode, HtmlContext, ParsedDocument } from "./types.js";
import { SVG_ATTRIBUTES, SVG_TAGS } from "./components/graphic.js";

/**
 * Allowlist for everything Elemnt emits. Raw HTML in source is dropped before
 * this point; sanitizing again guards against attribute values that came from
 * directive props. User JavaScript never appears here: widgets render in a
 * sandboxed iframe on a separate origin.
 */
/**
 * The default schema pins `className` on some tags to GitHub's values
 * (`task-list-item` on li, `footnotes` on section). Keep those, and also
 * allow Elemnt's own `elemnt-*` classes there.
 */
function withElemntClasses(attributes: NonNullable<Schema["attributes"]>): NonNullable<Schema["attributes"]> {
  return Object.fromEntries(
    Object.entries(attributes).map(([tag, defs]) => [
      tag,
      defs.map((def) => (Array.isArray(def) && def[0] === "className" ? [...def, /^elemnt-/] : def)),
    ]),
  ) as NonNullable<Schema["attributes"]>;
}

export const elemntSanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "aside",
    "figure",
    "figcaption",
    "section",
    "elemnt-tabs",
    "elemnt-diagram",
    "elemnt-steps",
    "elemnt-runbook",
    "elemnt-query",
    "elemnt-run",
    "elemnt-chart",
    "elemnt-datagrid",
    "elemnt-explore",
    "elemnt-var",
    "elemnt-calc",
    "elemnt-annotate",
    "elemnt-quiz",
    "elemnt-widget",
    "dfn",
    "header",
    ...SVG_TAGS,
  ],
  attributes: {
    ...withElemntClasses(defaultSchema.attributes ?? {}),
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "role", "data*", "ariaHidden"],
    dfn: ["title", "tabIndex"],
    // Only components emit SVG (raw HTML never reaches here); graphic.ts has already checked href values.
    ...Object.fromEntries(SVG_TAGS.map((t) => [t, ["use", "textPath", "linearGradient", "radialGradient", "pattern", "filter", "mpath"].includes(t) ? [...SVG_ATTRIBUTES, "href"] : SVG_ATTRIBUTES])),
  },
};

function context(state: State): HtmlContext {
  return {
    children(node) {
      const { content } = splitDirective(node);
      return state.all({ ...node, children: content } as DirectiveNode);
    },
    label(node) {
      const { label } = splitDirective(node);
      return label.length ? state.all({ type: "paragraph", children: label }) : [];
    },
    labelText,
  };
}

const directiveHandler =
  (registry: ReadonlyMap<string, AnyComponent>): Handler =>
  (state, node: DirectiveNode) => {
  const data = elemntData(node);
  const component = data && registry.get(node.name);
  if (!data || !component) {
    // Unknown or invalid directive: keep its content readable and mark it for the editor.
    const el: Element = {
      type: "element",
      tagName: node.type === "textDirective" ? "span" : "div",
      properties: { dataElemntInvalid: node.name },
      children: state.all({ ...node, children: splitDirective(node).content } as DirectiveNode),
    };
    state.patch(node, el);
    return el;
  }
  return component.render(node, data.props, context(state));
};

/** ```js run fences become a runnable block; the sandbox runtime hydrates `<elemnt-run>`. */
const codeHandler: Handler = (state, node: Code) => {
  const el = defaultHandlers.code(state, node);
  const runtime = wantsRun(node) ? runtimeFor(node) : undefined;
  return runtime ? h("elemnt-run", { dataRuntime: runtime }, [el]) : el;
};

export interface HtmlOptions {
  /** Return the tree before the sanitize pass. For debugging component output only; never serve it. */
  unsafeSkipSanitize?: boolean;
}

/** URL-safe slug of a heading's text, as GitHub makes them. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "section";
}

/**
 * Gives h2 and h3 a stable id from their text, after sanitizing (which would
 * otherwise prefix it). The ids are anchors for links, and the sections the
 * reader reports engagement for.
 */
function addHeadingIds(root: HastRoot): HastRoot {
  const seen = new Map<string, number>();
  const walk = (nodes: HastRoot["children"]) => {
    for (const n of nodes) {
      if (n.type !== "element") continue;
      if (n.tagName === "h2" || n.tagName === "h3") {
        const base = slugify(hastText(n));
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        n.properties = { ...n.properties, id: count ? `${base}-${count + 1}` : base };
      } else walk(n.children);
    }
  };
  walk(root.children);
  return root;
}

function hastText(n: Element | HastRoot["children"][number]): string {
  if (n.type === "text") return n.value;
  return "children" in n ? n.children.map((c) => hastText(c as Element)).join("") : "";
}

export function toHtmlTree(doc: ParsedDocument, registry: ReadonlyMap<string, AnyComponent>, options: HtmlOptions = {}): HastRoot {
  const handler = directiveHandler(registry);
  const hast = toHast(structuredClone(doc.tree), {
    handlers: { code: codeHandler, containerDirective: handler, leafDirective: handler, textDirective: handler },
  }) as HastRoot;
  return options.unsafeSkipSanitize ? hast : addHeadingIds(sanitize(hast, elemntSanitizeSchema) as HastRoot);
}

export function toHtml(doc: ParsedDocument, registry: ReadonlyMap<string, AnyComponent>, options: HtmlOptions = {}): string {
  return hastToHtml(toHtmlTree(doc, registry, options));
}
