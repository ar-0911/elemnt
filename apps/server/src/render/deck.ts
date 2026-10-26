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
  slides: { title: string | undefined; html: string }[];
  mode: "present" | "carousel";
  sandboxUrl?: string;
  look?: Look;
}

const BASE = `${themeTokensCss}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",sans-serif)}
${contentCss}
.elemnt-slide .elemnt-page{max-width:none}`;

const PRESENT_CSS = `
.deck{height:100vh;display:flex;flex-direction:column}
.elemnt-slide{flex:1;overflow:auto;padding:6vh 8vw;font-size:clamp(18px,2.2vw,30px);line-height:1.5}
.elemnt-slide h1{font-size:2.4em;margin-top:18vh}.elemnt-slide h2{font-size:1.7em;margin-top:0}
.deck-bar{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 16px;border-top:1px solid var(--line);font:13px system-ui;color:var(--muted)}
.deck-bar a,.deck-bar button{font:600 13px system-ui;color:var(--muted);background:none;border:1px solid var(--line);border-radius:6px;padding:5px 10px;cursor:pointer;text-decoration:none}`;

const CAROUSEL_CSS = `
@page{size:1080px 1350px;margin:0}
body{background:#888}
.elemnt-slide{width:1080px;height:1350px;margin:24px auto;background:var(--bg);padding:110px 90px 120px;overflow:hidden;position:relative;font-size:34px;line-height:1.45;break-after:page}
.elemnt-slide h1{font-size:84px;line-height:1.05;margin:280px 0 30px}.elemnt-slide h2{font-size:60px;line-height:1.1;margin:0 0 36px}
.elemnt-slide pre{font-size:24px}
.slide-foot{position:absolute;left:90px;right:90px;bottom:56px;display:flex;justify-content:space-between;font:600 22px system-ui;color:var(--muted)}
.print-hint{max-width:1080px;margin:24px auto 0;padding:14px 18px;background:var(--surface);border-radius:8px;font:15px system-ui}
@media print{body{background:none}.elemnt-slide{margin:0}.print-hint{display:none}}`;

export function renderDeck(d: DeckInput): string {
  const t = escapeHtml(d.title);
  const total = d.slides.length;
  const slides = d.slides
    .map(
      (s, i) =>
        `<section class="elemnt-slide" aria-label="Slide ${i + 1} of ${total}"><div class="elemnt-page">${s.html}</div>${
          d.mode === "carousel" ? `<div class="slide-foot"><span>${t}</span><span>${i + 1} / ${total}</span></div>` : ""
        }</section>`,
    )
    .join("\n");
  const body =
    d.mode === "present"
      ? `<div class="deck">${slides}<div class="deck-bar"><a href="${escapeHtml(d.canonicalUrl)}">Exit</a><span><button class="deck-prev" type="button">←</button> <span class="deck-count"></span> <button class="deck-next" type="button">→</button></span><span>F for full screen · <a href="${escapeHtml(d.canonicalUrl)}?view=carousel">LinkedIn carousel</a></span></div></div>`
      : `<p class="print-hint">LinkedIn carousel: print this page and choose <strong>Save as PDF</strong> (no margins), then upload the PDF as a document post. <button type="button" id="print">Print</button> · <a href="${escapeHtml(d.canonicalUrl)}?view=present">Back to present mode</a></p>${slides}`;
  const script =
    d.mode === "present"
      ? `import { enhance, mountDeck } from "/assets/elements.js";
const cfg = JSON.parse(document.getElementById("elemnt-config").textContent);
const deck = document.querySelector(".deck");
enhance(deck, { sandboxOrigin: cfg.sandboxUrl ?? undefined, widgets: { autorun: false } });
mountDeck(deck);`
      : `import { enhance } from "/assets/elements.js";
enhance(document.body, {});
document.getElementById("print")?.addEventListener("click", () => print());`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t} · ${d.mode === "present" ? "Present" : "Carousel"}</title>
<link rel="canonical" href="${escapeHtml(d.canonicalUrl)}"><meta name="robots" content="noindex">
<style>${BASE}${d.mode === "present" ? PRESENT_CSS : CAROUSEL_CSS}</style>
${lookHead(d.nonce, d.look)}
</head><body${bodyClass(d.look)}>
${body}
<script type="application/json" id="elemnt-config">${jsonForScript({ sandboxUrl: d.sandboxUrl ?? null })}</script>
<script type="module" nonce="${d.nonce}">${script}</script>
</body></html>`;
}
