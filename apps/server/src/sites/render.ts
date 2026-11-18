import type { Elemnt } from "@elemnt/core";
import { Liquid, type FS } from "liquidjs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { BlobStore } from "../lib/blobs.js";
import { escapeHtml, jsonForScript } from "../render/page.js";
import { readFileText, type Tree } from "./tree.js";

/**
 * Turns a site's files plus its space's published Markdown pages into HTML.
 *
 * - `pages/**` are designed pages: Liquid templates (.html/.liquid) or
 *   Elemnt Markdown (.md), routed by their path (`pages/index.html` is `/`).
 * - Every published page of the linked space is a doc page under the docs
 *   prefix (`/docs/<path>`), its Markdown wrapped in a layout.
 * - Layouts and partials are Liquid. `:::section{use="x"}` in any Markdown
 *   becomes `partials/x.liquid`, so design can sit inside the words.
 *
 * Templates come from the workspace's editors (or Claude, reviewed by them),
 * and run with LiquidJS's limits: no file system, no JS evaluation on the
 * server, capped render time. Scripts in the output run only in the browser,
 * on the site's own origin, which never holds an Elemnt session.
 */

export const siteConfigSchema = z
  .object({
    name: z.string().max(120).optional(),
    tagline: z.string().max(300).optional(),
    description: z.string().max(1000).optional(),
    nav: z.array(z.object({ label: z.string().max(60), href: z.string().max(300) }).passthrough()).max(20).default([]),
    docs: z
      .object({
        /** Where the space's pages live on the site. "" mounts them at the root. */
        prefix: z.string().regex(/^(\/[a-z0-9][a-z0-9-]*)*$/, 'docs.prefix is a path like "/docs" (or "" for the root)').default("/docs"),
        layout: z.string().default("docs"),
        /** Title of the generated docs index when the space has no `index` page. */
        title: z.string().default("Documentation"),
        /**
         * Use only the space's pages at or under this path, re-rooted: with
         * root "ares", page ares is the docs index and ares/flags is /docs/flags.
         * Lets several sites share one space without moving pages.
         */
        root: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/, 'docs.root is a page path like "ares"')
          .optional(),
      })
      .default({ prefix: "/docs", layout: "docs", title: "Documentation" }),
    /** Layout for designed pages that don't name one. */
    layout: z.string().default("page"),
    /** Default colour scheme; visitors can still toggle. */
    theme: z.enum(["auto", "light", "dark"]).default("dark"),
    /** Social preview image, a path on the site or a URL. */
    image: z.string().optional(),
    /** Anything else templates want, as `site.data`. */
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

export type SiteConfig = z.infer<typeof siteConfigSchema>;

export interface DocPage {
  id: string;
  path: string;
  title: string;
  summary: string | null;
  position: number;
  revisionId: string;
  updatedAt: Date;
}

export interface SiteRef {
  name: string;
  slug: string;
  url: string;
  tagline?: string;
  repo?: string | null;
}

/** Everything a render needs, fetched once per request (and cached briefly). */
export interface SiteSnapshot {
  key: string;
  site: { id: string; slug: string; name: string; repo: string | null };
  url: string;
  tree: Tree;
  docs: DocPage[];
  /** Slug of the linked space, to point its reader links (/s/<space>/…) at the site's own docs. */
  spaceSlug?: string;
  /** Published sites in the workspace, for hub pages. */
  sites: SiteRef[];
  sandboxUrl?: string;
  appUrl: string;
  preview: boolean;
}

export interface RenderDeps {
  blobs: BlobStore;
  elemnt: Elemnt;
  /** Stored HTML/Markdown for a doc page's published revision. */
  readRevision(revisionId: string, kind: "html" | "markdown"): Promise<string>;
  /** Adds author/blocked/host data to widget tags (services/widgets.ts). */
  decorateWidgets(html: string): Promise<string>;
}

export interface Diagnostic {
  file?: string;
  route?: string;
  message: string;
}

export type Resolved =
  | { kind: "designed"; route: string; file: string }
  | { kind: "doc"; route: string; page: DocPage }
  | { kind: "docs-index"; route: string }
  | { kind: "file"; file: string }
  | { kind: "markdown"; route: string; page: DocPage }
  | { kind: "generated"; name: "sitemap" | "robots" | "llms" | "search" };

const TEMPLATE_EXT = /\.(html|liquid|md)$/;

/** `pages/guide/index.html` -> `/guide`, `pages/about.md` -> `/about`. */
export function routeOfPageFile(file: string): string {
  const rel = file.slice("pages/".length).replace(TEMPLATE_EXT, "");
  const route = "/" + rel.replace(/(^|\/)index$/, "");
  return route === "/" ? "/" : route.replace(/\/$/, "");
}

export async function readConfig(blobs: BlobStore, tree: Tree): Promise<{ config: SiteConfig; diagnostics: Diagnostic[] }> {
  const raw = await readFileText(blobs, tree, "site.json");
  if (raw === undefined) return { config: siteConfigSchema.parse({}), diagnostics: [] };
  try {
    const parsed = siteConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { config: parsed.data, diagnostics: [] };
    return { config: siteConfigSchema.parse({}), diagnostics: parsed.error.issues.map((i) => ({ file: "site.json", message: `${i.path.join(".") || "site.json"}: ${i.message}` })) };
  } catch (err) {
    return { config: siteConfigSchema.parse({}), diagnostics: [{ file: "site.json", message: `Not valid JSON: ${(err as Error).message}` }] };
  }
}

export function designedRoutes(tree: Tree): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of Object.keys(tree.files).sort()) {
    if (!file.startsWith("pages/") || !TEMPLATE_EXT.test(file)) continue;
    const route = routeOfPageFile(file);
    if (route === "/404") continue;
    if (!out.has(route)) out.set(route, file);
  }
  return out;
}

const docRoute = (config: SiteConfig, path: string) => (path === "index" ? config.docs.prefix || "/" : `${config.docs.prefix}/${path}`.replace(/^\/\//, "/"));

export function resolve(snapshot: SiteSnapshot, config: SiteConfig, pathname: string): Resolved | undefined {
  const path = decodeURIComponent(pathname).replace(/\/+$/, "") || "/";
  if (path === "/sitemap.xml") return { kind: "generated", name: "sitemap" };
  if (path === "/robots.txt") return { kind: "generated", name: "robots" };
  if (path === "/llms.txt") return { kind: "generated", name: "llms" };
  if (path === "/_elemnt/search.json") return { kind: "generated", name: "search" };

  const file = path.slice(1);
  const top = file.split("/")[0];
  if ((top === "styles" || top === "scripts" || top === "assets") && snapshot.tree.files[file]) return { kind: "file", file };
  // Favicons and the like at the root are served from assets/.
  if (/^[^/]+\.(ico|png|svg|webmanifest)$/.test(file) && snapshot.tree.files[`assets/${file}`]) return { kind: "file", file: `assets/${file}` };

  const designed = designedRoutes(snapshot.tree);
  const hit = designed.get(path);
  if (hit) return { kind: "designed", route: path, file: hit };

  const prefix = config.docs.prefix;
  const md = path.endsWith(".md");
  const bare = md ? path.slice(0, -3) : path;
  if (prefix === "" || bare === prefix || bare.startsWith(prefix + "/")) {
    const rel = bare.slice(prefix.length).replace(/^\//, "") || "index";
    const page = snapshot.docs.find((p) => p.path === rel);
    if (page) return md ? { kind: "markdown", route: docRoute(config, page.path), page } : { kind: "doc", route: rel === "index" && bare === prefix ? (prefix || "/") : docRoute(config, page.path), page };
    if (!md && rel === "index" && (bare === prefix || (prefix === "" && bare === "/"))) return { kind: "docs-index", route: prefix || "/" };
  }
  return undefined;
}

/** Docs as a tree for sidebars, ordered like the space. */
export interface NavNode {
  title: string;
  url: string;
  path: string;
  summary: string | null;
  active: boolean;
  open: boolean;
  children: NavNode[];
}

function docsTree(config: SiteConfig, docs: DocPage[], current?: string): NavNode[] {
  // The docs home comes first, then the space's order.
  const sorted = [...docs].sort((a, b) => Number(b.path === "index") - Number(a.path === "index") || a.position - b.position || a.path.localeCompare(b.path));
  const byPath = new Map<string, NavNode>();
  const roots: NavNode[] = [];
  for (const p of sorted.sort((a, b) => a.path.split("/").length - b.path.split("/").length)) {
    const node: NavNode = { title: p.title, url: docRoute(config, p.path), path: p.path, summary: p.summary, active: p.path === current, open: Boolean(current && (current === p.path || current.startsWith(p.path + "/"))), children: [] };
    byPath.set(p.path, node);
    const parent = p.path.includes("/") ? byPath.get(p.path.slice(0, p.path.lastIndexOf("/"))) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const order = (list: NavNode[]) => {
    list.sort((a, b) => sorted.findIndex((p) => p.path === a.path) - sorted.findIndex((p) => p.path === b.path));
    list.forEach((n) => order(n.children));
  };
  order(roots);
  return roots;
}

function flatten(nodes: NavNode[]): NavNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Splits `---\nyaml\n---\nbody`. */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string; error?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  try {
    const data = parseYaml(m[1]!) ?? {};
    return { data: typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}, body: text.slice(m[0].length) };
  } catch (err) {
    return { data: {}, body: text.slice(m[0].length), error: (err as Error).message };
  }
}

/** Headings with ids, for an on-page table of contents. */
export function headings(html: string): { id: string; text: string; depth: number }[] {
  return [...html.matchAll(/<h([23])[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({ depth: Number(m[1]), id: m[2]!, text: m[3]!.replace(/<[^>]+>/g, "").trim() }));
}

const decodeAttr = (s: string) => s.replace(/&#x22;|&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Finds each `<div class="elemnt-section" …>…</div>` (balanced, since the
 * HTML is our own sanitized output) and hands it to `replace`.
 */
export async function replaceSections(html: string, replace: (use: string, props: Record<string, string>, content: string) => Promise<string>): Promise<string> {
  const open = /<div class="elemnt-section" data-use="([^"]*)" data-props="([^"]*)">/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    let depth = 1;
    let i = open.lastIndex;
    const tag = /<div[\s>]|<\/div>/g;
    tag.lastIndex = i;
    let t: RegExpExecArray | null;
    while (depth > 0 && (t = tag.exec(html))) {
      depth += t[0] === "</div>" ? -1 : 1;
      i = tag.lastIndex;
    }
    const inner = html.slice(open.lastIndex, i - "</div>".length);
    let props: Record<string, string> = {};
    try {
      props = JSON.parse(decodeAttr(m[2]!));
    } catch {
      props = {};
    }
    out += html.slice(last, m.index) + (await replace(m[1]!, props, await replaceSections(inner, replace)));
    last = i;
    open.lastIndex = i;
  }
  return out + html.slice(last);
}

/** The tags every site page gets in <head>: Elemnt's content styles, the 3D import map and the site runtime. */
export function elemntHead(snapshot: SiteSnapshot, config: SiteConfig): string {
  return [
    `<meta name="generator" content="Elemnt">`,
    `<script type="importmap">${jsonForScript({ imports: { three: "/_elemnt/vendor/three.module.js", "three/addons/": "/_elemnt/vendor/three/addons/" } })}</script>`,
    `<link rel="stylesheet" href="/_elemnt/content.css">`,
    `<script>try{var t=localStorage.getItem("elemnt-theme");t=t==="light"||t==="dark"?t:${JSON.stringify(config.theme === "auto" ? null : config.theme)};if(t)document.documentElement.dataset.theme=t}catch(e){}</script>`,
    `<script type="application/json" id="elemnt-site">${jsonForScript({ sandboxUrl: snapshot.sandboxUrl ?? null, preview: snapshot.preview })}</script>`,
    `<script type="module" src="/_elemnt/site.js"></script>`,
  ].join("\n");
}

function seoHead(snapshot: SiteSnapshot, config: SiteConfig, page: { title: string; summary?: string | null; url: string; markdownUrl?: string }): string {
  const siteName = config.name ?? snapshot.site.name;
  const title = page.url === snapshot.url + "/" || page.title === siteName ? siteName : `${page.title} · ${siteName}`;
  const desc = page.summary ?? config.description ?? config.tagline;
  const image = config.image ? (/^https?:/.test(config.image) ? config.image : `${snapshot.url}/${config.image.replace(/^\//, "")}`) : undefined;
  return [
    `<title>${escapeHtml(title)}</title>`,
    desc ? `<meta name="description" content="${escapeHtml(desc)}">` : "",
    `<link rel="canonical" href="${escapeHtml(page.url)}">`,
    page.markdownUrl ? `<link rel="alternate" type="text/markdown" href="${escapeHtml(page.markdownUrl)}">` : "",
    `<meta property="og:type" content="website"><meta property="og:site_name" content="${escapeHtml(siteName)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:url" content="${escapeHtml(page.url)}">`,
    desc ? `<meta property="og:description" content="${escapeHtml(desc)}">` : "",
    image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`,
    snapshot.preview ? `<meta name="robots" content="noindex">` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Puts Elemnt's head (and SEO tags the layout left out) into a finished page. */
export function injectHead(html: string, elemnt: string, seo: string): string {
  let extra = "";
  if (!html.includes('name="generator" content="Elemnt"')) extra += elemnt + "\n";
  // Only add what the layout didn't write itself.
  extra += seo
    .split("\n")
    .filter((tag) => !(tag.startsWith("<title") && /<title[\s>]/i.test(html)) && !(tag.includes('name="description"') && /name="description"/i.test(html)) && !(tag.includes('rel="canonical"') && /rel="canonical"/i.test(html)))
    .join("\n");
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (h) => `${h}\n${extra}`);
  // A layout without <head> (a fragment): wrap it so it's a whole document.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n${extra}</head><body>${html}</body></html>`;
}

/** The fallback look for sites (or parts of sites) that haven't been designed yet. */
const FALLBACK_LAYOUT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body class="elemnt-fallback">
<header class="ef-bar"><a class="ef-brand" href="/">{{ site.name }}</a><nav>{% for item in site.nav %}<a href="{{ item.href }}"{% if item.active %} aria-current="page"{% endif %}>{{ item.label }}</a>{% endfor %}<elemnt-search></elemnt-search><button data-elemnt-theme-toggle aria-label="Toggle dark mode">◐</button></nav></header>
<div class="ef-wrap">{% if page.kind == "doc" or page.kind == "docs-index" %}<aside class="ef-side">{% for n in docs.tree %}<a href="{{ n.url }}"{% if n.active %} aria-current="page"{% endif %}>{{ n.title }}</a>{% for c in n.children %}<a class="ef-sub" href="{{ c.url }}"{% if c.active %} aria-current="page"{% endif %}>{{ c.title }}</a>{% endfor %}{% endfor %}</aside>{% endif %}
<main class="ef-main">{% if page.kind == "doc" %}<h1>{{ page.title }}</h1>{% endif %}{{ page.content }}</main></div>
<style>.elemnt-fallback{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,sans-serif}.ef-bar{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:12px 24px;border-bottom:1px solid var(--line);background:var(--surface);z-index:5}.ef-bar nav{display:flex;gap:16px;align-items:center}.ef-bar a{color:var(--fg);text-decoration:none}.ef-brand{font-weight:700}.ef-wrap{display:flex;max-width:1200px;margin:0 auto}.ef-side{width:240px;padding:24px;display:flex;flex-direction:column;gap:6px;border-right:1px solid var(--line)}.ef-side a{color:var(--muted);text-decoration:none}.ef-side a[aria-current]{color:var(--accent);font-weight:600}.ef-sub{padding-left:14px}.ef-main{flex:1;min-width:0;padding:32px 24px 96px;max-width:820px}@media(max-width:760px){.ef-side{display:none}}</style>
</body></html>`;

class MemoryFs implements FS {
  constructor(private readonly files: Map<string, string>) {}
  sep = "/";
  dirname = (file: string) => file.slice(0, file.lastIndexOf("/"));
  resolve = (root: string, file: string, ext: string) => {
    const name = file.endsWith(ext) || /\.[a-z]+$/.test(file) ? file : file + ext;
    return name.includes("/") ? name : `${root}/${name}`;
  };
  contains = async () => true;
  exists = async (file: string) => this.files.has(file);
  existsSync = (file: string) => this.files.has(file);
  readFile = async (file: string) => this.readFileSync(file);
  readFileSync = (file: string) => {
    const body = this.files.get(file);
    if (body === undefined) throw new Error(`No template ${file}`);
    return body;
  };
}

export interface RenderedPage {
  status: number;
  html: string;
  diagnostics: Diagnostic[];
}

/**
 * Renders routes of one snapshot. Create one per snapshot: it loads the
 * templates once and reuses the Liquid engine.
 */
/** The docs a site shows: all of the space, or the subtree under docs.root with paths re-rooted. */
export function scopeDocs(config: SiteConfig, docs: DocPage[]): DocPage[] {
  const root = config.docs.root;
  if (!root) return docs;
  const out: DocPage[] = [];
  for (const d of docs) {
    if (d.path === root) out.push({ ...d, path: "index" });
    else if (d.path.startsWith(`${root}/`)) out.push({ ...d, path: d.path.slice(root.length + 1) });
  }
  // A child literally named "index" would clash with the root page; the root wins.
  return out.filter((d, i) => d.path !== "index" || out.findIndex((x) => x.path === "index") === i);
}

export async function siteRenderer(deps: RenderDeps, input: SiteSnapshot) {
  const { config, diagnostics: configDiagnostics } = await readConfig(deps.blobs, input.tree);
  const snapshot: SiteSnapshot = { ...input, docs: scopeDocs(config, input.docs) };
  const templates = new Map<string, string>();
  await Promise.all(
    Object.keys(snapshot.tree.files)
      .filter((f) => /^(layouts|partials|pages)\//.test(f) && TEMPLATE_EXT.test(f))
      .map(async (f) => templates.set(f, (await readFileText(deps.blobs, snapshot.tree, f)) ?? "")),
  );
  const data = new Map<string, unknown>();
  for (const f of Object.keys(snapshot.tree.files).filter((f) => f.startsWith("data/") && f.endsWith(".json"))) {
    try {
      data.set(f.slice(5, -5).replace(/\//g, "_"), JSON.parse((await readFileText(deps.blobs, snapshot.tree, f)) ?? "null"));
    } catch (err) {
      configDiagnostics.push({ file: f, message: `Not valid JSON: ${(err as Error).message}` });
    }
  }

  // Layouts and partials keep their frontmatter out of the Liquid source.
  const bodies = new Map<string, string>();
  const front = new Map<string, Record<string, unknown>>();
  for (const [f, text] of templates) {
    const { data: fm, body, error } = splitFrontmatter(text);
    bodies.set(f, body);
    front.set(f, fm);
    if (error) configDiagnostics.push({ file: f, message: `Frontmatter isn't valid YAML: ${error}` });
  }
  const liquidFiles = new Map<string, string>();
  for (const [f, body] of bodies) {
    if (f.startsWith("partials/") || f.startsWith("layouts/")) liquidFiles.set(f.replace(/\.(html|liquid)$/, ".liquid"), body);
  }
  const engine = new Liquid({
    fs: new MemoryFs(liquidFiles),
    root: ["partials"],
    partials: ["partials"],
    layouts: ["layouts"],
    extname: ".liquid",
    relativeReference: false,
    ownPropertyOnly: true,
    renderLimit: 3000,
    parseLimit: 2_000_000,
    memoryLimit: 64_000_000,
    cache: true,
  });
  engine.registerFilter("markdown", (text: unknown) => deps.elemnt.compile(String(text ?? "")).html);
  engine.registerFilter("json", (v: unknown) => jsonForScript(v));

  const designed = designedRoutes(snapshot.tree);
  const tree = docsTree(config, snapshot.docs);
  const siteName = config.name ?? snapshot.site.name;

  function context(page: Record<string, unknown> & { route: string }): { site: Record<string, unknown>; page: Record<string, unknown>; docs: Record<string, unknown>; elemnt: Record<string, unknown> } {
    const docsCurrent = page.kind === "doc" ? (page.path as string) : undefined;
    const t = docsCurrent ? docsTree(config, snapshot.docs, docsCurrent) : tree;
    const flat = flatten(t);
    const i = docsCurrent ? flat.findIndex((n) => n.path === docsCurrent) : -1;
    const active = (href: string) => href === page.route || (href !== "/" && page.route.startsWith(href.replace(/\/$/, "") + "/"));
    return {
      site: {
        ...config,
        name: siteName,
        slug: snapshot.site.slug,
        url: snapshot.url,
        repo: snapshot.site.repo,
        repo_url: snapshot.site.repo ? `https://github.com/${snapshot.site.repo}` : null,
        nav: config.nav.map((n) => ({ ...n, active: active(n.href) })),
        pages: [...designed.keys()].map((route) => ({ route, url: route, title: (front.get(designed.get(route)!)?.title as string) ?? route })),
        data: { ...config.data, ...Object.fromEntries(data) },
      },
      page: { ...page, prev: i > 0 ? flat[i - 1] : null, next: i >= 0 && i < flat.length - 1 ? flat[i + 1] : null },
      docs: { prefix: config.docs.prefix || "/", tree: t, list: flat, count: flat.length },
      elemnt: { sites: snapshot.sites, app_url: snapshot.appUrl, preview: snapshot.preview, year: new Date().getUTCFullYear() },
    };
  }

  async function renderSection(use: string, props: Record<string, string>, content: string, ctx: object, diagnostics: Diagnostic[], route: string) {
    const file = `partials/${use}.liquid`;
    if (!liquidFiles.has(file)) {
      diagnostics.push({ route, message: `:::section{use="${use}"} has no partials/${use}.liquid (or .html), so only its content shows.` });
      return `<section class="section section-${escapeHtml(use)}">${content}</section>`;
    }
    try {
      return await engine.parseAndRender(liquidFiles.get(file)!, { ...ctx, props, content });
    } catch (err) {
      diagnostics.push({ file, route, message: (err as Error).message });
      return `<section class="section section-${escapeHtml(use)}">${content}</section>`;
    }
  }

  /** Markdown (already compiled) with its designed sections filled in. */
  /**
   * Pages link to each other with reader URLs (/s/<space>/<path>). On a site,
   * those go to the site's own doc routes when the page is part of the site,
   * and to the app otherwise, so no link lands on a missing route.
   */
  function siteLinks(html: string) {
    if (!snapshot.spaceSlug) return html;
    const base = `/s/${snapshot.spaceSlug}/`;
    return html.replace(/href="(\/s\/[^"#?]+)([^"]*)"/g, (whole, path: string, rest: string) => {
      if (!path.startsWith(base)) return `href="${escapeHtml(snapshot.appUrl)}${path}${rest}"`;
      const full = path.slice(base.length).replace(/\/$/, "");
      const scoped = scopeDocs(config, [{ path: full } as DocPage])[0]?.path;
      if (scoped && snapshot.docs.some((d) => d.path === scoped)) return `href="${docRoute(config, scoped)}${rest}"`;
      return `href="${escapeHtml(snapshot.appUrl)}${path}${rest}"`;
    });
  }

  async function markdownHtml(html: string, ctx: object, diagnostics: Diagnostic[], route: string) {
    const decorated = siteLinks(await deps.decorateWidgets(html));
    return replaceSections(decorated, (use, props, content) => renderSection(use, props, content, ctx, diagnostics, route));
  }

  async function wrap(layoutName: string | undefined, content: string, ctx: ReturnType<typeof context>, diagnostics: Diagnostic[], route: string): Promise<string> {
    let html = content;
    let name = layoutName;
    for (let depth = 0; name && depth < 5; depth++) {
      const file = `layouts/${name}.liquid`;
      const src = liquidFiles.get(file);
      if (src === undefined) {
        if (name !== config.layout && name !== config.docs.layout) diagnostics.push({ route, message: `Layout "${name}" doesn't exist (add layouts/${name}.liquid).` });
        return engine.parseAndRender(FALLBACK_LAYOUT, { ...ctx, page: { ...ctx.page, content: html } });
      }
      try {
        html = await engine.parseAndRender(src, { ...ctx, page: { ...ctx.page, content: html }, content: html });
      } catch (err) {
        diagnostics.push({ file, route, message: (err as Error).message });
        throw new SiteRenderError(diagnostics);
      }
      const parent = [...front.entries()].find(([f]) => f.replace(/\.(html|liquid)$/, ".liquid") === file)?.[1]?.layout;
      name = typeof parent === "string" ? parent : undefined;
    }
    return html;
  }

  async function finish(html: string, page: { title: string; summary?: string | null; route: string; markdownUrl?: string }) {
    const url = snapshot.url + (page.route === "/" ? "/" : page.route);
    return injectHead(html, elemntHead(snapshot, config), seoHead(snapshot, config, { ...page, url }));
  }

  async function renderDesigned(route: string, file: string): Promise<RenderedPage> {
    const diagnostics: Diagnostic[] = [...configDiagnostics];
    const fm = front.get(file) ?? {};
    const body = bodies.get(file) ?? "";
    const title = typeof fm.title === "string" ? fm.title : route === "/" ? siteName : route.split("/").pop()!;
    const summary = typeof fm.summary === "string" ? fm.summary : null;
    const page = { ...fm, kind: "page", title, summary, route, url: route, file };
    const ctx = context(page);
    let content: string;
    try {
      if (file.endsWith(".md")) {
        const compiled = deps.elemnt.compile(body);
        for (const d of compiled.diagnostics) diagnostics.push({ file, route, message: `line ${d.line ?? "?"}: ${d.message}` });
        content = `<div class="elemnt-page">${await markdownHtml(compiled.html, ctx, diagnostics, route)}</div>`;
      } else {
        content = await engine.parseAndRender(body, ctx);
      }
    } catch (err) {
      if (err instanceof SiteRenderError) throw err;
      diagnostics.push({ file, route, message: (err as Error).message });
      throw new SiteRenderError(diagnostics);
    }
    // Designed HTML pages that are whole documents need no layout.
    const layout = fm.layout === false || fm.layout === "none" || (fm.layout === undefined && /<html[\s>]/i.test(content)) ? undefined : typeof fm.layout === "string" ? fm.layout : config.layout;
    const html = layout ? await wrap(layout, content, { ...ctx, page: { ...ctx.page, content } }, diagnostics, route) : content;
    return { status: 200, html: await finish(html, { title, summary, route }), diagnostics };
  }

  async function renderDoc(route: string, doc: DocPage): Promise<RenderedPage> {
    const diagnostics: Diagnostic[] = [...configDiagnostics];
    const stored = await deps.readRevision(doc.revisionId, "html");
    const page = { kind: "doc", title: doc.title, summary: doc.summary, route, url: route, path: doc.path, updated_at: doc.updatedAt.toISOString(), markdown_url: `${docRoute(config, doc.path)}.md` };
    const ctx = context(page);
    const content = `<div class="elemnt-page">${await markdownHtml(stored, ctx, diagnostics, route)}</div>`;
    const html = await wrap(config.docs.layout, content, { ...ctx, page: { ...ctx.page, content, toc: headings(content) } }, diagnostics, route);
    return { status: 200, html: await finish(html, { title: doc.title, summary: doc.summary, route, markdownUrl: snapshot.url + page.markdown_url }), diagnostics };
  }

  async function renderDocsIndex(route: string): Promise<RenderedPage> {
    const diagnostics: Diagnostic[] = [...configDiagnostics];
    const items = flatten(tree);
    const content = `<h1>${escapeHtml(config.docs.title)}</h1><div class="elemnt-docs-index">${items
      .map((n) => `<a class="elemnt-docs-card" href="${escapeHtml(n.url)}"><strong>${escapeHtml(n.title)}</strong>${n.summary ? `<span>${escapeHtml(n.summary)}</span>` : ""}</a>`)
      .join("")}</div>`;
    const page = { kind: "docs-index", title: config.docs.title, summary: null, route, url: route };
    const ctx = context(page);
    const html = await wrap(config.docs.layout, content, { ...ctx, page: { ...ctx.page, content } }, diagnostics, route);
    return { status: 200, html: await finish(html, { title: config.docs.title, route }), diagnostics };
  }

  async function renderNotFound(): Promise<RenderedPage> {
    const file = [...templates.keys()].find((f) => /^pages\/404\.(html|liquid|md)$/.test(f));
    if (file) return { ...(await renderDesigned("/404", file)), status: 404 };
    const diagnostics: Diagnostic[] = [];
    const content = `<div class="elemnt-404"><h1>Page not found</h1><p>There's nothing at this address. <a href="/">Go to the home page</a>.</p></div>`;
    const ctx = context({ kind: "page", title: "Not found", route: "/404" });
    const html = await wrap(config.layout, content, { ...ctx, page: { ...ctx.page, content } }, diagnostics, "/404");
    return { status: 404, html: await finish(html, { title: "Not found", route: "/404" }), diagnostics };
  }

  function allRoutes(): string[] {
    const out = new Set<string>(designed.keys());
    for (const d of snapshot.docs) out.add(d.path === "index" ? config.docs.prefix || "/" : docRoute(config, d.path));
    if (snapshot.docs.length && !snapshot.docs.some((d) => d.path === "index") && !designed.has(config.docs.prefix || "/")) out.add(config.docs.prefix || "/");
    return [...out].sort();
  }

  function sitemap(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allRoutes()
      .map((r) => `  <url><loc>${escapeHtml(snapshot.url + (r === "/" ? "/" : r))}</loc></url>`)
      .join("\n")}\n</urlset>\n`;
  }

  function robots(): string {
    return snapshot.preview ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\n\nSitemap: ${snapshot.url}/sitemap.xml\n`;
  }

  function llms(): string {
    const lines = snapshot.docs.map((d) => `- [${d.title}](${snapshot.url}${docRoute(config, d.path)}.md)${d.summary ? `: ${d.summary}` : ""}`);
    return `# ${siteName}\n\n> ${config.tagline ?? config.description ?? `The ${siteName} website.`}\n\n## Docs\n\n${lines.join("\n") || "(none yet)"}\n`;
  }

  async function searchIndex(): Promise<string> {
    const docs = await Promise.all(
      snapshot.docs.map(async (d) => {
        const md = await deps.readRevision(d.revisionId, "markdown");
        return { title: d.title, url: docRoute(config, d.path), summary: d.summary ?? "", section: "Docs", text: md.replace(/[#>*_`|[\]()-]+/g, " ").replace(/\s+/g, " ").slice(0, 6000) };
      }),
    );
    const pages = [...designed.entries()].map(([route, file]) => {
      const fm = front.get(file) ?? {};
      const body = (bodies.get(file) ?? "").replace(/\{[{%][\s\S]*?[%}]\}/g, " ").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
      return { title: typeof fm.title === "string" ? fm.title : route === "/" ? siteName : route, url: route, summary: typeof fm.summary === "string" ? fm.summary : "", section: "Pages", text: body.replace(/\s+/g, " ").slice(0, 3000) };
    });
    return JSON.stringify({ site: siteName, items: [...pages, ...docs] });
  }

  return {
    config,
    configDiagnostics,
    resolve: (pathname: string) => resolve(snapshot, config, pathname),
    renderDesigned,
    renderDoc,
    renderDocsIndex,
    renderNotFound,
    allRoutes,
    sitemap,
    robots,
    llms,
    searchIndex,
    async markdown(doc: DocPage) {
      return deps.readRevision(doc.revisionId, "markdown");
    },
    /** Renders every route; used before publishing so a broken template never goes live. */
    async check(): Promise<Diagnostic[]> {
      const out: Diagnostic[] = [...configDiagnostics];
      for (const route of allRoutes()) {
        const r = resolve(snapshot, config, route);
        try {
          const page = r?.kind === "designed" ? await renderDesigned(route, r.file) : r?.kind === "doc" ? await renderDoc(route, r.page) : r?.kind === "docs-index" ? await renderDocsIndex(route) : undefined;
          for (const d of page?.diagnostics ?? []) if (!out.some((o) => o.message === d.message && o.file === d.file)) out.push(d);
        } catch (err) {
          for (const d of err instanceof SiteRenderError ? err.diagnostics : [{ route, message: (err as Error).message }]) if (!out.some((o) => o.message === d.message && o.file === d.file)) out.push(d);
        }
      }
      return out;
    },
  };
}

export class SiteRenderError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => `${d.file ?? d.route ?? ""}: ${d.message}`).join("\n"));
  }
}

export type SiteRenderer = Awaited<ReturnType<typeof siteRenderer>>;
