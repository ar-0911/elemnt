import { contentCss, themeTokensCss } from "@elemnt/core";

/**
 * What Elemnt adds to every site page, served from the site's own origin:
 * `/_elemnt/content.css` styles Markdown and components, `/_elemnt/site.js`
 * hydrates them and gives designers a few helpers that need no code:
 *
 * - `<elemnt-search>`: a ⌘K search box over the whole site.
 * - `[data-elemnt-theme-toggle]`: a light/dark switch.
 * - `[data-reveal]`: fades and lifts in when scrolled into view
 *   (`data-reveal="left|right|scale"`, `data-reveal-delay="120"`).
 * - `[data-tilt]`: follows the pointer in 3D.
 * - `[data-parallax="0.2"]`: moves at a fraction of the scroll speed.
 * - `[data-count-to="1200"]`: counts up when visible.
 * - `[data-elemnt-toc]`: highlights the heading being read.
 * - nav links to the current page get `aria-current="page"`.
 *
 * Three.js is in the import map as "three" and "three/addons/…", served
 * from the site itself, so scenes need no CDN.
 */

// Layered, so anything a site's own CSS sets (tokens included) wins without
// needing more specific selectors.
export const siteCss = `
@layer elemnt{
${themeTokensCss}
${contentCss}
}
html{scroll-behavior:smooth}
.elemnt-docs-index{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-top:24px}
.elemnt-docs-card{display:flex;flex-direction:column;gap:6px;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--fg);text-decoration:none;transition:transform .2s,border-color .2s}
.elemnt-docs-card:hover{transform:translateY(-2px);border-color:var(--accent)}
.elemnt-docs-card span{color:var(--muted);font-size:14px}
.elemnt-404{text-align:center;padding:80px 20px}
[data-reveal]{opacity:0;transform:translateY(24px);transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1)}
[data-reveal=left]{transform:translateX(-32px)}[data-reveal=right]{transform:translateX(32px)}[data-reveal=scale]{transform:scale(.94)}
[data-reveal].is-visible{opacity:1;transform:none}
[data-tilt]{transform-style:preserve-3d;transition:transform .25s ease-out;will-change:transform}
@media (prefers-reduced-motion:reduce){[data-reveal]{opacity:1;transform:none;transition:none}[data-tilt]{transform:none!important}}
elemnt-search{display:inline-block}
.es-open{display:inline-flex;align-items:center;gap:10px;font:500 14px var(--font-body,system-ui);color:var(--muted);background:color-mix(in srgb,var(--surface) 70%,transparent);border:1px solid var(--line);border-radius:999px;padding:7px 12px;cursor:pointer}
.es-open kbd{font:600 11px var(--font-mono,ui-monospace,monospace);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.es-dialog{width:min(640px,calc(100vw - 24px));max-height:min(70vh,640px);padding:0;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--fg);box-shadow:0 30px 80px rgba(0,0,0,.45)}
.es-dialog::backdrop{background:rgba(0,0,0,.45);backdrop-filter:blur(4px)}
.es-dialog input{width:100%;box-sizing:border-box;font:500 17px var(--font-body,system-ui);padding:16px 18px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--fg);outline:none}
.es-results{list-style:none;margin:0;padding:8px;overflow:auto;max-height:calc(min(70vh,640px) - 60px)}
.es-results a{display:block;padding:10px 12px;border-radius:8px;color:var(--fg);text-decoration:none}
.es-results a[aria-selected=true],.es-results a:hover{background:var(--soft)}
.es-results small{display:block;color:var(--muted);font-size:13px;margin-top:2px}
.es-results mark{background:color-mix(in srgb,var(--accent) 30%,transparent);color:inherit;border-radius:3px}
.es-empty{padding:18px;color:var(--muted)}
.elemnt-preview-badge{position:fixed;left:12px;bottom:12px;z-index:9999;font:600 12px system-ui;background:#f59e0b;color:#111;padding:6px 10px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.3)}
`;

export const siteJs = `
import { enhance, mountThemeToggle } from "/_elemnt/elements.js";
const cfg = JSON.parse(document.getElementById("elemnt-site")?.textContent || "{}");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

enhance(document.body, { sandboxOrigin: cfg.sandboxUrl || undefined, widgets: { autorun: true } });
for (const b of document.querySelectorAll("[data-elemnt-theme-toggle]")) mountThemeToggle(b, "auto");

// Current page in navigation.
const here = location.pathname.replace(/\\/$/, "") || "/";
for (const a of document.querySelectorAll("nav a[href], [data-elemnt-nav] a[href]")) {
  const href = new URL(a.href, location.href);
  if (href.origin !== location.origin || href.hash) continue;
  const p = href.pathname.replace(/\\/$/, "") || "/";
  if (p === here || (p !== "/" && here.startsWith(p + "/"))) a.setAttribute("aria-current", p === here ? "page" : "true");
}

// Scroll reveals and counters.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target;
    const delay = Number(el.dataset.revealDelay || 0);
    setTimeout(() => el.classList.add("is-visible"), reduced ? 0 : delay);
    if (el.dataset.countTo) countUp(el);
    io.unobserve(el);
  }
}, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
for (const el of document.querySelectorAll("[data-reveal], [data-count-to]")) io.observe(el);
function countUp(el) {
  const to = Number(el.dataset.countTo), from = Number(el.dataset.countFrom || 0), dur = reduced ? 0 : 1400, t0 = performance.now();
  const fmt = new Intl.NumberFormat();
  const step = (t) => { const k = dur ? Math.min(1, (t - t0) / dur) : 1; el.textContent = fmt.format(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))) + (el.dataset.countSuffix || ""); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// Pointer tilt.
if (!reduced) for (const el of document.querySelectorAll("[data-tilt]")) {
  const max = Number(el.dataset.tilt || 10);
  el.addEventListener("pointermove", (e) => { const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.transform = "perspective(900px) rotateY(" + (x * max) + "deg) rotateX(" + (-y * max) + "deg)"; });
  el.addEventListener("pointerleave", () => { el.style.transform = ""; });
}

// Parallax.
const par = [...document.querySelectorAll("[data-parallax]")];
if (par.length && !reduced) {
  const tick = () => { const y = scrollY; for (const el of par) el.style.transform = "translate3d(0," + (y * Number(el.dataset.parallax)).toFixed(1) + "px,0)"; };
  addEventListener("scroll", () => requestAnimationFrame(tick), { passive: true }); tick();
}

// On-page table of contents.
const toc = document.querySelector("[data-elemnt-toc]");
if (toc) {
  const links = new Map([...toc.querySelectorAll("a[href^='#']")].map((a) => [decodeURIComponent(a.getAttribute("href").slice(1)), a]));
  const spy = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { for (const a of links.values()) a.removeAttribute("aria-current"); links.get(e.target.id)?.setAttribute("aria-current", "true"); } }, { rootMargin: "0px 0px -70% 0px" });
  for (const id of links.keys()) { const h = document.getElementById(id); if (h) spy.observe(h); }
}

// Search.
let index;
const loadIndex = () => (index ??= fetch("/_elemnt/search.json").then((r) => r.json()).catch(() => ({ items: [] })));
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function search(items, q) {
  const terms = q.toLowerCase().split(/\\s+/).filter(Boolean);
  if (!terms.length) return items.slice(0, 8).map((item) => ({ item, snippet: item.summary }));
  const out = [];
  for (const item of items) {
    const t = item.title.toLowerCase(), s = (item.summary || "").toLowerCase(), x = (item.text || "").toLowerCase();
    let score = 0;
    for (const term of terms) { const st = (t.includes(term) ? 6 : 0) + (s.includes(term) ? 3 : 0) + (x.includes(term) ? 1 : 0); if (!st) { score = 0; break; } score += st; }
    if (!score) continue;
    const at = x.indexOf(terms[0]);
    const snippet = at >= 0 ? (at > 60 ? "…" : "") + item.text.slice(Math.max(0, at - 60), at + 120) + "…" : item.summary;
    out.push({ item, score, snippet });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}
class ElemntSearch extends HTMLElement {
  connectedCallback() {
    if (this.dialog) return;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    this.innerHTML = '<button class="es-open" type="button" aria-haspopup="dialog"><span>' + esc(this.getAttribute("label") || "Search") + '</span><kbd>' + (mac ? "⌘" : "Ctrl ") + 'K</kbd></button>';
    const dialog = document.createElement("dialog");
    dialog.className = "es-dialog";
    dialog.setAttribute("aria-label", "Search the site");
    dialog.innerHTML = '<input type="search" placeholder="Search docs and pages…" aria-label="Search" autocomplete="off"><ul class="es-results" role="listbox"></ul>';
    document.body.append(dialog);
    this.dialog = dialog;
    const input = dialog.querySelector("input"), list = dialog.querySelector("ul");
    let sel = 0, hits = [];
    const paint = () => {
      const terms = input.value.toLowerCase().split(/\\s+/).filter(Boolean);
      const mark = (s) => terms.reduce((acc, t) => acc.replace(new RegExp("(" + t.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + ")", "gi"), "<mark>$1</mark>"), esc(s || ""));
      list.innerHTML = hits.length ? hits.map((h, i) => '<li><a role="option" href="' + esc(h.item.url) + '" aria-selected="' + (i === sel) + '"><strong>' + mark(h.item.title) + '</strong> <small>' + esc(h.item.section) + (h.snippet ? " · " + mark(h.snippet) : "") + '</small></a></li>').join("") : '<li class="es-empty">Nothing matches “' + esc(input.value) + '”.</li>';
    };
    const run = async () => { hits = search((await loadIndex()).items, input.value); sel = 0; paint(); };
    input.addEventListener("input", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % Math.max(1, hits.length); paint(); }
      if (e.key === "Enter" && hits[sel]) location.href = hits[sel].item.url;
    });
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    const open = () => { dialog.showModal(); input.value = ""; run(); input.focus(); };
    this.querySelector("button").addEventListener("click", open);
    addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); dialog.open ? dialog.close() : open(); } else if (e.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName || "") && !dialog.open) { e.preventDefault(); open(); } });
  }
}
customElements.define("elemnt-search", ElemntSearch);

if (cfg.preview) { const b = document.createElement("div"); b.className = "elemnt-preview-badge"; b.textContent = "Preview · not published"; document.body.append(b); }
`;
