import type { Element, ElementContent } from "hast";
import { h, s } from "hastscript";
import type { ListItem, PhrasingContent } from "mdast";
import { z } from "zod";
import { isDirective } from "../directive.js";
import type { ElemntComponent, MarkdownContent } from "../types.js";

/**
 * Layout components for pages that read like a landing page: a hero, cards,
 * big numbers, a timeline, full-width bands, badges and pull quotes. They
 * only arrange content; colours and fonts come from the page style, so the
 * same source looks right in every preset and in light and dark.
 */

const TONES = ["accent", "ok", "warn", "danger", "muted"] as const;
const isLinkOnly = (el: ElementContent) =>
  el.type === "element" &&
  el.tagName === "p" &&
  el.children.length > 0 &&
  el.children.every((c) => (c.type === "element" && c.tagName === "a") || (c.type === "text" && !c.value.trim()));

/** Decorative art behind the hero. Hidden from assistive tech; motion stops under prefers-reduced-motion. */
function heroArt(kind: "orbit" | "waves" | "grid" | "none"): Element[] {
  if (kind === "none") return [];
  const attrs = { className: ["elemnt-art", `elemnt-art-${kind}`], ariaHidden: "true", focusable: "false", preserveAspectRatio: "xMidYMid slice" };
  if (kind === "orbit") {
    return [
      s("svg", { ...attrs, viewBox: "0 0 400 400" }, [
        ...[70, 120, 170].map((r, i) =>
          s("g", { className: ["elemnt-orbit", `elemnt-orbit-${i + 1}`] }, [
            s("circle", { cx: 200, cy: 200, r, fill: "none", stroke: "currentColor", strokeOpacity: 0.25, strokeDashArray: i === 1 ? "4 8" : undefined }),
            s("circle", { cx: 200 + r, cy: 200, r: 6 - i, fill: i % 2 ? "var(--accent-2)" : "var(--accent)" }),
          ]),
        ),
        s("circle", { cx: 200, cy: 200, r: 26, fill: "var(--accent)", fillOpacity: 0.9 }),
      ]),
    ];
  }
  if (kind === "waves") {
    const wave = (y: number, a: number) => `M0 ${y} Q 100 ${y - a} 200 ${y} T 400 ${y} T 600 ${y} T 800 ${y}`;
    return [
      s("svg", { ...attrs, viewBox: "0 0 400 200" }, [
        s("path", { className: ["elemnt-wave"], d: wave(120, 40), fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeOpacity: 0.6 }),
        s("path", { className: ["elemnt-wave", "elemnt-wave-2"], d: wave(140, 30), fill: "none", stroke: "var(--accent-2)", strokeWidth: 2, strokeOpacity: 0.5 }),
        s("path", { className: ["elemnt-wave", "elemnt-wave-3"], d: wave(160, 20), fill: "none", stroke: "currentColor", strokeWidth: 1, strokeOpacity: 0.25 }),
      ]),
    ];
  }
  const lines: Element[] = [];
  for (let i = 0; i <= 12; i++) lines.push(s("line", { x1: i * 40 - 40, y1: 200, x2: 200 + (i - 6) * 90, y2: 0, stroke: "currentColor", strokeOpacity: 0.18 }));
  for (let j = 1; j <= 6; j++) lines.push(s("line", { x1: 0, y1: 200 - j * j * 5, x2: 400, y2: 200 - j * j * 5, stroke: "currentColor", strokeOpacity: 0.18 }));
  return [s("svg", { ...attrs, viewBox: "0 0 400 200" }, lines)];
}

const heroProps = z.object({
  eyebrow: z.string().max(80).optional(),
  art: z.enum(["orbit", "waves", "grid", "none"]).default("orbit"),
  align: z.enum(["left", "center"]).default("left"),
});

/** The opening of a page: a big title, a lede, optional call-to-action links and background art. */
export const hero: ElemntComponent<z.infer<typeof heroProps>> = {
  name: "hero",
  kinds: ["containerDirective"],
  props: heroProps,
  validate(node) {
    return (node.children[0]?.data as { directiveLabel?: boolean } | undefined)?.directiveLabel ? [] : ["hero needs a title, e.g. :::hero[Ship docs people read]"];
  },
  render(node, { eyebrow, art, align }, ctx) {
    const body = ctx.children(node).map((el) =>
      isLinkOnly(el) ? { ...(el as Element), properties: { ...(el as Element).properties, className: ["elemnt-hero-actions"] } } : el,
    );
    return h("header", { className: ["elemnt-hero"], dataAlign: align, dataArt: art }, [
      ...heroArt(art),
      h("div", { className: ["elemnt-hero-body"] }, [
        ...(eyebrow ? [h("p", { className: ["elemnt-eyebrow"] }, eyebrow)] : []),
        h("h1", ctx.label(node)),
        ...body,
      ]),
    ]);
  },
  toMarkdown(node, { eyebrow }, ctx) {
    return [
      ...(eyebrow ? [{ type: "paragraph", children: [{ type: "emphasis", children: [{ type: "text", value: eyebrow }] }] } as MarkdownContent] : []),
      { type: "heading", depth: 1, children: ctx.label(node) },
      ...ctx.children(node),
    ];
  },
  authoring: {
    doc: "Page opening: big title ([label]), lede paragraph, and a final paragraph of links that become buttons. eyebrow= small line above the title; art=orbit|waves|grid|none; align=left|center. Use once, at the top, instead of a # heading.",
    snippet:
      ':::hero[Payments, explained in five minutes]{eyebrow="Platform guide" art=orbit}\nEverything a new engineer needs to move money safely: the flow, the failure modes and the one config you must not touch.\n\n[Start the tour](#the-flow) [API reference](/s/api)\n:::',
  },
};

const cardsProps = z.object({ cols: z.coerce.number().int().min(1).max(4).default(3) });

/** A grid of cards. */
export const cards: ElemntComponent<z.infer<typeof cardsProps>> = {
  name: "cards",
  kinds: ["containerDirective"],
  props: cardsProps,
  validate(_node, _props, { children }) {
    return children.length > 0 && children.every((c) => isDirective(c) && c.name === "card") ? [] : ["cards may only contain :::card[Title] blocks; wrap with four colons"];
  },
  render(node, { cols }, ctx) {
    return h("div", { className: ["elemnt-cards"], dataCols: String(cols) }, ctx.children(node));
  },
  toMarkdown(node, _props, ctx) {
    return ctx.children(node);
  },
  authoring: {
    doc: "Grid of cards (cols=1–4, default 3). Contains :::card[Title]{icon=\"⚡\" href=/path} blocks. Use for features, options, next steps.",
    snippet: '::::cards{cols=3}\n:::card[Fast]{icon="⚡"}\nP99 under 120 ms in every region.\n:::\n:::card[Safe]{icon="🛡️"}\nIdempotent writes, so retries never double-charge.\n:::\n:::card[Observable]{icon="📈" href="/s/ops/dashboards"}\nEvery request traced end to end.\n:::\n::::',
  },
};

const cardProps = z.object({
  icon: z.string().max(8).optional(),
  href: z
    .string()
    .max(500)
    .regex(/^(https?:\/\/|\/|#)/, "href must start with https://, / or #")
    .optional(),
  tone: z.enum(TONES).optional(),
});

export const card: ElemntComponent<z.infer<typeof cardProps>> = {
  name: "card",
  kinds: ["containerDirective"],
  props: cardProps,
  validate(node, _props, { parent }) {
    const problems: string[] = [];
    if (parent?.name !== "cards") problems.push("card must be inside ::::cards");
    if (!(node.children[0]?.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) problems.push("card needs a title, e.g. :::card[Fast]");
    return problems;
  },
  render(node, { icon, href, tone }, ctx) {
    const title = ctx.label(node);
    const head = [
      ...(icon ? [h("span", { className: ["elemnt-card-icon"], ariaHidden: "true" }, icon)] : []),
      h("h3", { className: ["elemnt-card-title"] }, href ? [h("a", { href }, title)] : title),
    ];
    return h("section", { className: ["elemnt-card"], ...(tone ? { dataTone: tone } : {}), ...(href ? { dataLink: "" } : {}) }, [...head, ...ctx.children(node)]);
  },
  toMarkdown(node, { href }, ctx) {
    const label = ctx.label(node);
    return [
      { type: "heading", depth: ctx.headingDepth(node), children: href ? [{ type: "link", url: href, children: label }] : label },
      ...ctx.children(node),
    ];
  },
  authoring: { doc: "One card of ::::cards. Optional icon (emoji), href, tone=accent|ok|warn|danger|muted.", snippet: '::::cards{cols=2}\n:::card[Read the guide]{icon="📘" href="/s/docs/guide"}\nTen minutes, start to finish.\n:::\n:::card[Ask in #help]{icon="💬"}\nSomeone answers within the hour.\n:::\n::::' },
};

/** Big numbers. */
export const stats: ElemntComponent<Record<string, never>> = {
  name: "stats",
  kinds: ["containerDirective"],
  props: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  validate(_node, _props, { children }) {
    return children.length > 0 && children.every((c) => isDirective(c) && c.name === "stat") ? [] : ["stats may only contain ::stat[value]{label=\"…\"} lines"];
  },
  render(node, _props, ctx) {
    return h("div", { className: ["elemnt-stats"] }, ctx.children(node));
  },
  toMarkdown(node, _props, ctx) {
    const items: ListItem[] = ctx.children(node).flatMap((c) => (c.type === "listItem" ? [c] : c.type === "list" ? c.children : []));
    return [{ type: "list", ordered: false, spread: false, children: items }];
  },
  authoring: {
    doc: "A row of big numbers. Contains ::stat[value]{label=\"…\" note=\"…\"} lines.",
    snippet: ':::stats\n::stat[99.95%]{label="Uptime, last 90 days"}\n::stat[118 ms]{label="P99 latency"}\n::stat[0]{label="Double charges" note="since idempotency keys"}\n:::',
  },
};

const statProps = z.object({ label: z.string().min(1).max(80), note: z.string().max(120).optional() });

export const stat: ElemntComponent<z.infer<typeof statProps>> = {
  name: "stat",
  kinds: ["leafDirective"],
  props: statProps,
  validate(node, _props, { parent }) {
    const problems: string[] = [];
    if (parent?.name !== "stats") problems.push("stat must be inside :::stats");
    if (!node.children.length) problems.push("stat needs its value as the label, e.g. ::stat[99.9%]{label=\"Uptime\"}");
    return problems;
  },
  render(node, { label, note }, ctx) {
    return h("div", { className: ["elemnt-stat"] }, [
      h("p", { className: ["elemnt-stat-value"] }, ctx.label(node)),
      h("p", { className: ["elemnt-stat-label"] }, label),
      ...(note ? [h("p", { className: ["elemnt-stat-note"] }, note)] : []),
    ]);
  },
  toMarkdown(node, { label, note }, ctx) {
    const children: PhrasingContent[] = [{ type: "strong", children: ctx.label(node) }, { type: "text", value: ` ${label}${note ? ` (${note})` : ""}` }];
    return [{ type: "listItem", spread: false, children: [{ type: "paragraph", children }] }];
  },
  authoring: { doc: "One number in :::stats.", snippet: ':::stats\n::stat[3×]{label="Faster builds"}\n::stat[−40%]{label="CI minutes"}\n:::' },
};

/** Events in order: a release history, a migration plan, an incident. */
export const timeline: ElemntComponent<Record<string, never>> = {
  name: "timeline",
  kinds: ["containerDirective"],
  props: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  validate(_node, _props, { children }) {
    return children.length > 0 && children.every((c) => isDirective(c) && c.name === "event") ? [] : ["timeline may only contain :::event[Title]{date=\"…\"} blocks; wrap with four colons"];
  },
  render(node, _props, ctx) {
    return h("ol", { className: ["elemnt-timeline"] }, ctx.children(node));
  },
  toMarkdown(node, _props, ctx) {
    return ctx.children(node);
  },
  authoring: {
    doc: "A vertical timeline. Contains :::event[Title]{date=\"…\" tone=ok|warn|danger} blocks.",
    snippet: '::::timeline\n:::event[Alert fires]{date="14:02" tone=danger}\nError rate crosses 2%.\n:::\n:::event[Rolled back]{date="14:09" tone=ok}\nTraffic recovers within a minute.\n:::\n::::',
  },
};

const eventProps = z.object({ date: z.string().max(40).optional(), tone: z.enum(TONES).optional() });

export const event: ElemntComponent<z.infer<typeof eventProps>> = {
  name: "event",
  kinds: ["containerDirective"],
  props: eventProps,
  validate(node, _props, { parent }) {
    const problems: string[] = [];
    if (parent?.name !== "timeline") problems.push("event must be inside ::::timeline");
    if (!(node.children[0]?.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) problems.push("event needs a title, e.g. :::event[Launched]");
    return problems;
  },
  render(node, { date, tone }, ctx) {
    return h("li", { className: ["elemnt-event"], ...(tone ? { dataTone: tone } : {}) }, [
      ...(date ? [h("p", { className: ["elemnt-event-date"] }, date)] : []),
      h("p", { className: ["elemnt-event-title"] }, ctx.label(node)),
      ...ctx.children(node),
    ]);
  },
  toMarkdown(node, { date }, ctx) {
    const label = ctx.label(node);
    return [{ type: "heading", depth: ctx.headingDepth(node), children: date ? [{ type: "text", value: `${date}: ` }, ...label] : label }, ...ctx.children(node)];
  },
  authoring: { doc: "One entry of ::::timeline.", snippet: '::::timeline\n:::event[Beta]{date="2026-01"}\nTen design partners.\n:::\n:::event[General availability]{date="2026-03" tone=ok}\nOpen to everyone.\n:::\n::::' },
};

const sectionProps = z.object({ tone: z.enum(["soft", "accent", "contrast", "glow"]).default("soft") });

/** A full-width band that sets a stretch of the page apart. */
export const band: ElemntComponent<z.infer<typeof sectionProps>> = {
  name: "band",
  kinds: ["containerDirective"],
  props: sectionProps,
  render(node, { tone }, ctx) {
    return h("section", { className: ["elemnt-band"], dataTone: tone }, [h("div", { className: ["elemnt-band-inner"] }, ctx.children(node))]);
  },
  toMarkdown(node, _props, ctx) {
    return ctx.children(node);
  },
  authoring: {
    doc: "A full-width coloured band behind its content, to set a section apart. tone=soft|accent|contrast|glow.",
    snippet: ":::band{tone=glow}\n## Why this matters\nOne bad retry can charge a customer twice.\n:::",
  },
};

const badgeProps = z.object({ tone: z.enum(TONES).default("accent") });

export const badge: ElemntComponent<z.infer<typeof badgeProps>> = {
  name: "badge",
  kinds: ["textDirective"],
  props: badgeProps,
  validate(node) {
    return node.children.length ? [] : ["badge needs text, e.g. :badge[Beta]"];
  },
  render(node, { tone }, ctx) {
    return h("span", { className: ["elemnt-badge"], dataTone: tone }, ctx.label(node));
  },
  toMarkdown(node, _props, ctx) {
    return [{ type: "text", value: "[" }, ...ctx.label(node), { type: "text", value: "]" }];
  },
  authoring: { doc: "A small pill label inline: :badge[Beta]{tone=warn}. tone=accent|ok|warn|danger|muted.", snippet: "## Webhooks :badge[Beta]{tone=warn}" },
};

const quoteProps = z.object({ by: z.string().max(80).optional(), role: z.string().max(80).optional() });

export const quote: ElemntComponent<z.infer<typeof quoteProps>> = {
  name: "quote",
  kinds: ["containerDirective"],
  props: quoteProps,
  render(node, { by, role }, ctx) {
    return h("figure", { className: ["elemnt-quote"] }, [
      h("blockquote", ctx.children(node)),
      ...(by ? [h("figcaption", [h("strong", by), ...(role ? [`, ${role}`] : [])])] : []),
    ]);
  },
  toMarkdown(node, { by, role }, ctx) {
    const cite: MarkdownContent[] = by ? [{ type: "paragraph", children: [{ type: "text", value: `— ${by}${role ? `, ${role}` : ""}` }] }] : [];
    return [{ type: "blockquote", children: [...ctx.children(node), ...cite] as never }];
  },
  authoring: { doc: "A large pull quote with an optional by= and role=.", snippet: ':::quote{by="Priya" role="SRE lead"}\nThe rollback took nine minutes. The postmortem took nine days.\n:::' },
};

