import type { Element, ElementContent, Root as HastRoot } from "hast";
import { fromHtml } from "hast-util-from-html";
import { h } from "hastscript";
import type { Code } from "mdast";
import { z } from "zod";
import { splitDirective } from "../directive.js";
import { sha256Hex } from "../sha256.js";
import type { DirectiveNode, ElemntComponent } from "../types.js";

/**
 * Inline SVG art: banners, diagrams, animated accents. It renders in the page
 * itself (no iframe), so it is held to an allowlist: shapes, gradients,
 * filters and SMIL animation, but no script, no foreignObject, no style
 * elements or attributes, no links and nothing fetched from elsewhere.
 */

export const SVG_TAGS = [
  "svg", "g", "defs", "symbol", "use", "title", "desc",
  "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan", "textPath",
  "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker",
  "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feMerge", "feMergeNode", "feFlood", "feComposite", "feTurbulence", "feDisplacementMap", "feDropShadow",
  "animate", "animateTransform", "animateMotion", "mpath", "set",
];

/** hast property names (camelCased SVG attributes). */
export const SVG_ATTRIBUTES = [
  "viewBox", "preserveAspectRatio", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr",
  "d", "points", "pathLength", "transform", "opacity", "visibility", "display", "color",
  "fill", "fillOpacity", "fillRule", "stroke", "strokeWidth", "strokeOpacity", "strokeLineCap", "strokeLineJoin", "strokeDashArray", "strokeDashOffset", "strokeMiterLimit", "vectorEffect", "paintOrder",
  "clipPath", "clipRule", "mask", "filter", "markerStart", "markerMid", "markerEnd", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient",
  "offset", "stopColor", "stopOpacity", "gradientUnits", "gradientTransform", "spreadMethod", "patternUnits", "patternContentUnits", "patternTransform", "maskUnits", "maskContentUnits", "clipPathUnits", "filterUnits", "primitiveUnits",
  "fontSize", "fontFamily", "fontWeight", "fontStyle", "letterSpacing", "textAnchor", "dominantBaseline", "alignmentBaseline", "textLength", "lengthAdjust", "startOffset", "dx", "dy", "rotate",
  "in", "in2", "result", "mode", "type", "values", "operator", "k1", "k2", "k3", "k4", "stdDeviation", "baseFrequency", "numOctaves", "seed", "stitchTiles", "scale", "xChannelSelector", "yChannelSelector", "floodColor", "floodOpacity",
  "attributeName", "attributeType", "begin", "dur", "end", "repeatCount", "repeatDur", "from", "to", "by", "keyTimes", "keySplines", "keyPoints", "calcMode", "additive", "accumulate", "path", "restart", "min", "max",
  "ariaLabel", "ariaHidden", "role", "focusable", "id", "className",
];

const TAGS = new Set(SVG_TAGS);
const ATTRS = new Set(SVG_ATTRIBUTES);
/** Elements whose href is kept, and only when it points inside the graphic. */
const LINKING = new Set(["use", "textPath", "linearGradient", "radialGradient", "pattern", "filter", "mpath"]);
const MAX_BYTES = 150_000;

const props = z.object({
  alt: z.string().min(5, "alt must describe the graphic in words (5+ characters)").max(500),
  caption: z.string().max(300).optional(),
  /** Display width: full, or a share of the column. */
  width: z.enum(["full", "wide", "half", "third"]).default("full"),
});

function svgSource(node: DirectiveNode): Code | undefined {
  return splitDirective(node).content.find((c): c is Code => c.type === "code" && c.lang?.toLowerCase() === "svg");
}

interface Cleaned {
  svg?: Element;
  problems: string[];
}

/**
 * Parses and cleans author SVG. Ids get a per-graphic prefix so two graphics
 * never collide, and references are rewritten to match the `user-content-`
 * prefix the final sanitize pass adds to every id.
 */
export function cleanSvg(source: string): Cleaned {
  const problems: string[] = [];
  const tree = fromHtml(source, { fragment: true }) as HastRoot;
  const top = tree.children.filter((c): c is Element => c.type === "element");
  if (top.length !== 1 || top[0]!.tagName !== "svg") return { problems: ["graphic must contain exactly one <svg> element"] };
  const prefix = `g${sha256Hex(source).slice(0, 6)}-`;
  const ref = (id: string) => `user-content-${prefix}${id}`;
  const dropped = new Set<string>();

  const clean = (el: Element): Element | undefined => {
    if (!TAGS.has(el.tagName)) {
      dropped.add(`<${el.tagName}>`);
      return undefined;
    }
    const target = el.properties?.attributeName;
    if (typeof target === "string" && /href/i.test(target)) {
      dropped.add("animation of href");
      return undefined;
    }
    const properties: Element["properties"] = {};
    for (const [key, raw] of Object.entries(el.properties ?? {})) {
      const value = Array.isArray(raw) ? raw.join(" ") : raw;
      if ((key === "href" || key === "xLinkHref") && LINKING.has(el.tagName)) {
        if (typeof value === "string" && /^#[\w-]+$/.test(value)) properties.href = `#${ref(value.slice(1))}`;
        else dropped.add(`${key} that leaves the graphic`);
        continue;
      }
      if (!ATTRS.has(key)) {
        dropped.add(key === "style" ? "style attributes (use fill, stroke and other attributes)" : key);
        continue;
      }
      if (typeof value === "string") {
        if (/url\(\s*['"]?(?!#)/i.test(value)) {
          dropped.add(`${key} that loads a url()`);
          continue;
        }
        if (/javascript:|data:/i.test(value)) {
          dropped.add(`${key} with a script or data URL`);
          continue;
        }
        let v = value.replace(/url\(\s*['"]?#([\w-]+)['"]?\s*\)/g, (_m, id: string) => `url(#${ref(id)})`);
        if (key === "id") v = prefix + v;
        if (key === "begin" || key === "end") v = v.replace(/(^|[;\s])([A-Za-z_][\w-]*)\.(begin|end|click|repeat)/g, (_m, sep: string, id: string, ev: string) => `${sep}${ref(id)}.${ev}`);
        properties[key] = v;
      } else properties[key] = value as never;
    }
    const children: ElementContent[] = [];
    for (const c of el.children) {
      if (c.type === "element") {
        const kept = clean(c);
        if (kept) children.push(kept);
      } else if (c.type === "text") children.push(c);
    }
    return { ...el, properties, children };
  };

  const svg = clean(top[0]!);
  if (dropped.size) problems.push(`graphic: removed ${[...dropped].slice(0, 6).join(", ")}; graphics can't use them`);
  return { svg, problems };
}

export const graphic: ElemntComponent<z.infer<typeof props>> = {
  name: "graphic",
  kinds: ["containerDirective"],
  props,
  validate(node) {
    const code = svgSource(node);
    if (!code) return ["graphic needs one ```svg code block"];
    if (new TextEncoder().encode(code.value).length > MAX_BYTES) return [`graphic SVG is over ${MAX_BYTES / 1000} KB`];
    const { svg, problems } = cleanSvg(code.value);
    if (!svg) return problems;
    // Removed parts are worth knowing about but don't block publishing.
    return problems.map((message) => ({ severity: "warning" as const, message }));
  },
  render(node, { alt, caption, width }) {
    const code = svgSource(node);
    const svg = code ? cleanSvg(code.value).svg : undefined;
    const art = svg ? { ...svg, properties: { ...svg.properties, role: "img", ariaLabel: alt } } : h("p", alt);
    return h("figure", { className: ["elemnt-graphic"], dataWidth: width }, [art, ...(caption ? [h("figcaption", caption)] : [])]);
  },
  toMarkdown(_node, { alt, caption }) {
    return [{ type: "paragraph", children: [{ type: "emphasis", children: [{ type: "text", value: `Graphic: ${alt}${caption ? ` (${caption})` : ""}` }] }] }];
  },
  authoring: {
    doc: "Inline SVG art drawn right in the page: banners, diagrams, animated accents (SMIL <animate>). alt= is required and is what agents read. Use var(--accent), var(--accent-2) and currentColor so it follows the page style and dark mode. No script, style, foreignObject, links or external url().",
    snippet:
      ':::graphic{alt="Three services in a row, with a pulse travelling from the API to the queue to the worker"}\n```svg\n<svg viewBox="0 0 360 80"><g fill="none" stroke="currentColor" stroke-opacity=".4"><rect x="10" y="20" width="80" height="40" rx="8"/><rect x="140" y="20" width="80" height="40" rx="8"/><rect x="270" y="20" width="80" height="40" rx="8"/><path d="M90 40H140M220 40H270"/></g><circle r="5" fill="var(--accent)"><animateMotion dur="2s" repeatCount="indefinite" path="M90 40H270"/></circle></svg>\n```\n:::',
  },
};
