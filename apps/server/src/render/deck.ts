import { contentCss, themeTokensCss } from "@elemnt/core";
import { bodyClass, escapeHtml, jsonForScript, lookHead, type Look } from "./page.js";

/**
 * Present mode and the LinkedIn carousel. Both come from the page split into
 * slides by @elemnt/core (a slide per h1/h2 or ---).
 *
 * - present: full-screen deck with keyboard and swipe navigation
 * - carousel: every slide as a 1080×1350 page, printed to PDF, which LinkedIn
 *   shows as a swipeable document post
 */
export interface DeckInput {
  nonce: string;
  title: string;
  canonicalUrl: string;
  slides: { title: string | undefined; html: string; cover?: boolean }[];
  mode: "present" | "carousel";
  sandboxUrl?: string;
  /** Run widgets without a click (members and verified workspaces), as on the page. */
  autorun?: boolean;
  look?: Look;
}

/*
 * Every slide is laid out on a fixed stage (--w × --h at reading size) and
 * scaled as a whole (--s), so a slide looks the same in any window and in the
 * PDF. The browser then splits slides that don't fit and scales down blocks
 * that can't be split (fitSlides in @elemnt/elements), so nothing is clipped.
 */
const BASE = `${themeTokensCss}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",sans-serif)}
${contentCss}
.slide-frame{width:calc(var(--w) * var(--s,1));height:calc(var(--h) * var(--s,1));overflow:hidden;flex:none}
.slide-stage{width:var(--w);height:var(--h);transform:scale(var(--s,1));transform-origin:0 0;display:flex;flex-direction:column;padding:var(--pad);background:var(--bg);font-size:var(--fs);line-height:1.5}
.slide-body.elemnt-page{--gap:.9em;flex:1;min-height:0;max-width:none;margin:0;padding:0;overflow:hidden}
.slide-fit{transform-origin:0 0}
.slide-body > :first-child,.slide-fit > :first-child{margin-top:0}.slide-body > :last-child,.slide-fit > :last-child{margin-bottom:0}
.slide-cover .slide-body{display:flex;flex-direction:column;justify-content:center}
.slide-body :is(p,ul,ol,blockquote,dl){max-width:38em}
.slide-body p,.slide-body li{margin-block:.55em}
.slide-body :is(h1,h2,h3,h4){text-wrap:balance}
.slide-body h1,.slide-body .elemnt-hero h1{font-size:2.3em;line-height:1.08;margin:0 0 .4em}
.slide-body h2{font-size:1.55em;line-height:1.15;margin:0 0 .7em}
.slide-body h3{font-size:1.1em;margin:1.1em 0 .35em}.slide-body h4{font-size:1em;margin:1em 0 .3em}
.slide-cover .slide-body h1 + p{font-size:1.15em;color:var(--muted);max-width:30em}
.slide-cont{font-size:.45em;font-weight:500;letter-spacing:0;color:var(--muted);-webkit-text-fill-color:var(--muted);white-space:nowrap}
.slide-body code{overflow-wrap:anywhere}
.slide-body pre{font-size:.85em;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;overflow:visible}
.slide-body table{display:table;width:100%;overflow:visible;font-size:.8em}
.slide-body .elemnt-band{margin:0;padding:0;background:none;border:0}
.slide-body .elemnt-band:is([data-tone=accent],[data-tone=contrast]){padding:1.2em 1.4em;border-radius:var(--radius,8px)}
.slide-body .elemnt-hero{margin:0;padding:2em 2.2em}.slide-body .elemnt-hero-body{position:relative;z-index:1}
.slide-body .elemnt-stat-value{font-size:2em}.slide-body .elemnt-quote blockquote{font-size:1.3em}
.slide-foot{flex:none;display:flex;justify-content:space-between;gap:1em;margin-top:1.4em;padding-top:.8em;border-top:1px solid var(--line);font:600 11px/1.3 system-ui,sans-serif;color:var(--muted)}
.slide-foot span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;

const PRESENT_CSS = `
.deck{height:100vh;height:100dvh;display:flex;flex-direction:column}
.deck-slides{flex:1;min-height:0;display:grid;place-items:center;overflow:hidden}
.elemnt-slide{--w:960px;--h:540px;--fs:20px;--pad:44px 64px 40px;grid-area:1/1}
.deck:not(.ready) .elemnt-slide{visibility:hidden}
.deck-bar{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 16px;border-top:1px solid var(--line);font:13px system-ui;color:var(--muted)}
.deck-bar a,.deck-bar button{font:600 13px system-ui;color:var(--muted);background:none;border:1px solid var(--line);border-radius:6px;padding:5px 10px;cursor:pointer;text-decoration:none}
@media (max-width:640px){.deck-hint{display:none}}`;

const CAROUSEL_CSS = `
@page{size:1080px 1350px;margin:0}
body{background:#888}
.elemnt-slide{--w:540px;--h:675px;--s:2;--fs:17px;--pad:48px 40px 22px;width:fit-content;margin:24px auto;break-after:page;break-inside:avoid}
.slide-body .elemnt-cards{grid-template-columns:1fr}
.slide-body .elemnt-art:not(.elemnt-art-waves,.elemnt-art-grid){opacity:.25}
.slide-body elemnt-widget .elemnt-widget-label{display:none}
.elemnt-widget-live{margin:.5em 0 0;font:600 12px/1.4 var(--font-body,system-ui);color:var(--muted);text-align:center}.elemnt-widget-live a{color:var(--accent)}
.print-hint{max-width:1080px;margin:24px auto 0;padding:14px 18px;background:var(--surface);border-radius:8px;font:15px system-ui}
@media print{body{background:none}.elemnt-slide{margin:0}.print-hint,.elemnt-widget-run{display:none}}`;

export function renderDeck(d: DeckInput): string {
  const t = escapeHtml(d.title);
  const total = d.slides.length;
  const slides = d.slides
    .map(
      (s, i) =>
        `<section class="elemnt-slide${s.cover ? " slide-cover" : ""}" aria-label="Slide ${i + 1} of ${total}"><div class="slide-frame"><div class="slide-stage"><div class="slide-body elemnt-page">${s.html}</div>${
          d.mode === "carousel" ? `<div class="slide-foot"><span>${t}</span><span class="slide-num">${i + 1} / ${total}</span></div>` : ""
        }</div></div></section>`,
    )
    .join("\n");
  const body =
    d.mode === "present"
      ? `<div class="deck"><div class="deck-slides">${slides}</div><div class="deck-bar"><a href="${escapeHtml(d.canonicalUrl)}">Exit</a><span><button class="deck-prev" type="button">←</button> <span class="deck-count"></span> <button class="deck-next" type="button">→</button></span><span><span class="deck-hint">F for full screen · </span><a href="${escapeHtml(d.canonicalUrl)}?view=carousel">LinkedIn carousel</a></span></div></div>`
      : `<p class="print-hint">LinkedIn carousel: print this page and choose <strong>Save as PDF</strong> (no margins), then upload the PDF as a document post. <button type="button" id="print">Print</button> · <a href="${escapeHtml(d.canonicalUrl)}?view=present">Back to present mode</a></p>${slides}`;
  const script =
    d.mode === "present"
      ? `import { enhance, mountDeck } from "/assets/elements.js";
const cfg = JSON.parse(document.getElementById("elemnt-config").textContent);
const deck = document.querySelector(".deck");
enhance(deck, { sandboxOrigin: cfg.sandboxUrl ?? undefined, widgets: { autorun: Boolean(cfg.autorun) } });
mountDeck(deck);`
      : `import { enhance, fitSlides } from "/assets/elements.js";
const cfg = JSON.parse(document.getElementById("elemnt-config").textContent);
// Widgets run and stay loaded so the printed PDF shows them as they look, with a link to the live page.
enhance(document.body, { sandboxOrigin: cfg.sandboxUrl ?? undefined, widgets: { autorun: Boolean(cfg.autorun), keepLoaded: true, liveUrl: cfg.liveUrl } });
document.fonts.ready.then(() => fitSlides(document.body));
document.getElementById("print")?.addEventListener("click", () => print());`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t} · ${d.mode === "present" ? "Present" : "Carousel"}</title>
<link rel="canonical" href="${escapeHtml(d.canonicalUrl)}"><meta name="robots" content="noindex">
<style>${BASE}${d.mode === "present" ? PRESENT_CSS : CAROUSEL_CSS}</style>
${lookHead(d.nonce, d.look)}
</head><body${bodyClass(d.look)}>
${body}
<script type="application/json" id="elemnt-config">${jsonForScript({ sandboxUrl: d.sandboxUrl ?? null, autorun: Boolean(d.autorun), liveUrl: d.canonicalUrl })}</script>
<script type="module" nonce="${d.nonce}">${script}</script>
</body></html>`;
}
