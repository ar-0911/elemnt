import type { BrowsePage } from "../services/browse.js";
import { bodyClass, escapeHtml, lookHead, pageCss, type Look } from "./page.js";

/**
 * Public browsing: the space landing page, the "Pages" menu in the reader's
 * header, and the "Keep reading" cards under every page, so a reader who
 * arrives from one shared link can find the rest.
 */


const spaceHref = (slug: string) => `/s/${escapeHtml(slug)}`;
const pageHref = (slug: string, path: string) => `${spaceHref(slug)}/${path.split("/").map((s) => escapeHtml(encodeURIComponent(s))).join("/")}`;

const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One page as a card, coloured with that page's own accent. */
export function pageCard(spaceSlug: string, p: BrowsePage, feature = false): string {
  const vars = `--ca:${p.accent.light[0]};--cb:${p.accent.light[1]};--cad:${p.accent.dark[0]};--cbd:${p.accent.dark[1]}`;
  const meta = [
    p.repo ? `<span class="eb-chip">${escapeHtml(p.repo)}</span>` : "",
    `<span>${p.minutes} min read</span>`,
    `<span>Updated ${date(p.updatedAt)}</span>`,
  ].join("");
  return `<a class="eb-card${feature ? " eb-feature" : ""}" href="${pageHref(spaceSlug, p.path)}" style="${escapeHtml(vars)}"><span class="eb-meta">${meta}</span><h3>${escapeHtml(p.title)}</h3>${p.summary ? `<p>${escapeHtml(p.summary)}</p>` : ""}<span class="eb-go">Read</span></a>`;
}

/** The "Pages" menu next to the breadcrumb in the reader's header. */
export function pagesMenu(space: { slug: string; name: string }, list: BrowsePage[], current: string): string {
  if (list.length < 2) return "";
  const items = list
    .map((p) => `<a href="${pageHref(space.slug, p.path)}"${p.path === current ? ' aria-current="page"' : ""}>${escapeHtml(p.title)}${p.summary ? `<small>${escapeHtml(p.summary)}</small>` : ""}</a>`)
    .join("");
  return `<details class="eb-menu"><summary>${list.length} pages</summary><nav class="eb-menu-list" aria-label="Pages in ${escapeHtml(space.name)}">${items}<a class="eb-all" href="${spaceHref(space.slug)}">All of ${escapeHtml(space.name)}</a></nav></details>`;
}

/** "Keep reading" cards under a page. */
export function keepReading(space: { slug: string; name: string }, more: BrowsePage[]): string {
  if (!more.length) return "";
  return `<section class="eb-more" aria-labelledby="eb-more-title"><div class="eb-more-head"><h2 id="eb-more-title">Keep reading</h2><a href="${spaceHref(space.slug)}">All pages in ${escapeHtml(space.name)} →</a></div><div class="eb-grid">${more.map((p) => pageCard(space.slug, p)).join("")}</div></section>`;
}

const INDEX_SCRIPT = `
import { mountThemeToggle } from "/assets/elements.js";
const toggle = document.getElementById("theme-toggle");
if (toggle) mountThemeToggle(toggle, JSON.parse(document.getElementById("elemnt-config").textContent).mode);
`;

export interface SpaceIndexInput {
  nonce: string;
  publicUrl: string;
  space: { slug: string; name: string; visibility: string };
  pages: BrowsePage[];
  look: Look;
}

/** A space's landing page: a hero, then every published page as a card. */
export function renderSpaceIndex(p: SpaceIndexInput): string {
  const name = escapeHtml(p.space.name);
  const [first, ...rest] = p.pages;
  const minutes = p.pages.reduce((n, x) => n + x.minutes, 0);
  const repos = new Set(p.pages.flatMap((x) => (x.repo ? [x.repo] : []))).size;
  const latest = p.pages.reduce<Date | null>((d, x) => (!d || x.updatedAt > d ? x.updatedAt : d), null);
  const description = `${p.pages.length} interactive page${p.pages.length === 1 ? "" : "s"} in ${p.space.name}${first ? `, starting with ${first.title}` : ""}.`;
  const canonical = `${p.publicUrl}/s/${p.space.slug}`;
  const stats = [
    `<li><b>${p.pages.length}</b> page${p.pages.length === 1 ? "" : "s"}</li>`,
    minutes ? `<li><b>${minutes}</b> min of reading</li>` : "",
    repos ? `<li><b>${repos}</b> GitHub repo${repos === 1 ? "" : "s"} explained</li>` : "",
    latest ? `<li>Updated <b>${date(latest)}</b></li>` : "",
  ].join("");
  const eyebrow = p.space.visibility === "public" ? "Public space" : "Space";
  const actions = first
    ? `<p class="elemnt-hero-actions"><a href="${pageHref(p.space.slug, first.path)}">Start with ${escapeHtml(first.title)}</a><a href="${spaceHref(p.space.slug)}/llms.txt">llms.txt for agents</a></p>`
    : "";
  const cards = first
    ? `<h2 class="eb-section">${p.pages.length === 1 ? "The page" : "All pages"}</h2><div class="eb-grid">${pageCard(p.space.slug, first, p.pages.length >= 4)}${rest.map((x) => pageCard(p.space.slug, x)).join("")}</div>`
    : `<p class="eb-empty">Nothing is published here yet.</p>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${name}">
<meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary">
<style>${pageCss}</style>
${lookHead(p.nonce, p.look)}
</head><body${bodyClass(p.look)}>
<header class="bar">
  <span class="crumb"><a href="/">Elemnt</a> / ${name}</span>
  <span class="actions"><button class="btn theme-toggle" id="theme-toggle" type="button" aria-label="Toggle dark mode">☾</button></span>
</header>
<main class="eb-index">
  <section class="elemnt-hero"><div class="elemnt-hero-body"><p class="elemnt-eyebrow">${eyebrow}</p><h1>${name}</h1><p>Interactive write-ups you can read, run and present. Pick one to start.</p>${actions}<ul class="eb-stats">${stats}</ul></div></section>
  ${cards}
  <footer class="eb-foot"><span>Made with <a href="/">Elemnt</a></span><a href="${spaceHref(p.space.slug)}/llms.txt">Every page as Markdown</a></footer>
</main>
<script type="application/json" id="elemnt-config">${JSON.stringify({ mode: p.look.mode })}</script>
<script type="module" nonce="${p.nonce}">${INDEX_SCRIPT}</script>
</body></html>`;
}

export interface HomeInput {
  nonce: string;
  spaces: { slug: string; name: string; visibility: string; pages: BrowsePage[] }[];
  look: Look;
  /** Sign-in, editor and sign-out controls, already rendered. */
  account: string;
}

/** The site's front door: every space the reader can open, as cards. */
export function renderHome(p: HomeInput): string {
  const cards = p.spaces
    .map((s) => {
      const first = s.pages[0];
      const vars = first ? `--ca:${first.accent.light[0]};--cb:${first.accent.light[1]};--cad:${first.accent.dark[0]};--cbd:${first.accent.dark[1]}` : "";
      const titles = s.pages.slice(0, 4).map((x) => x.title).join(" · ");
      const meta = `<span class="eb-chip">${escapeHtml(s.visibility)}</span><span>${s.pages.length} page${s.pages.length === 1 ? "" : "s"}</span>`;
      return `<a class="eb-card" href="${spaceHref(s.slug)}"${vars ? ` style="${escapeHtml(vars)}"` : ""}><span class="eb-meta">${meta}</span><h3>${escapeHtml(s.name)}</h3>${titles ? `<p>${escapeHtml(titles)}</p>` : ""}<span class="eb-go">Browse</span></a>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Elemnt</title>
<style>${pageCss}</style>
${lookHead(p.nonce, p.look)}
</head><body${bodyClass(p.look)}>
<header class="bar">
  <span class="crumb"><a href="/">Elemnt</a></span>
  <span class="actions">${p.account}<button class="btn theme-toggle" id="theme-toggle" type="button" aria-label="Toggle dark mode">☾</button></span>
</header>
<main class="eb-index">
  <section class="elemnt-hero"><div class="elemnt-hero-body"><p class="elemnt-eyebrow">Elemnt</p><h1>Docs worth reading</h1><p>Interactive write-ups you can read, run and present.</p></div></section>
  ${cards ? `<h2 class="eb-section">Spaces</h2><div class="eb-grid">${cards}</div>` : `<p class="eb-empty">No spaces yet.</p>`}
</main>
<script type="application/json" id="elemnt-config">${JSON.stringify({ mode: p.look.mode })}</script>
<script type="module" nonce="${p.nonce}">${INDEX_SCRIPT}</script>
</body></html>`;
}
