import { escapeHtml } from "./page.js";

/**
 * The README card: an SVG GitHub shows inline, so a README can open with the
 * explainer's title and summary instead of a wall of text. GitHub proxies
 * images through its camo cache, so the card is self-contained (no fonts or
 * links inside) and the README wraps it in a link.
 */

const THEMES = {
  light: { bg: "#ffffff", fg: "#111827", muted: "#4b5563", line: "#e5e7eb", accent: "#2949c7", accent2: "#0ea5e9", chip: "#eef2ff" },
  dark: { bg: "#0d1117", fg: "#f3f4f6", muted: "#9ca3af", line: "#30363d", accent: "#8b9cff", accent2: "#38bdf8", chip: "#161b2e" },
} as const;

export type CardTheme = keyof typeof THEMES;

/** Greedy word wrap by an average glyph width; good enough for a card and needs no font metrics. */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line ? `${line} ${w}` : w).length <= maxChars) line = line ? `${line} ${w}` : w;
    else {
      if (line) lines.push(line);
      line = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  const used = lines.join(" ").length;
  if (used < words.join(" ").length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1]!.replace(/[.,;:]?$/, "").slice(0, maxChars - 1)}…`;
  return lines;
}

export function readmeCard(input: { repo: string; title?: string; summary?: string | null; theme?: CardTheme }): string {
  const t = THEMES[input.theme ?? "light"];
  const W = 840;
  const H = 220;
  const title = wrap(input.title ?? input.repo, 44, 2);
  // A two-line title leaves room for one line of summary above the button.
  const summary = wrap(input.summary ?? "An interactive explainer: what it is, how it works, and how to try it.", 86, title.length > 1 ? 1 : 2);
  const titleY = 74;
  const summaryY = titleY + title.length * 38 + 8;
  const text = (s: string) => escapeHtml(s);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${text(`${input.title ?? input.repo}: explained on Elemnt`)}">
<title>${text(input.title ?? input.repo)}</title>
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.accent}"/><stop offset="1" stop-color="${t.accent2}"/></linearGradient>
  <clipPath id="c"><rect width="${W}" height="${H}" rx="14"/></clipPath>
</defs>
<g clip-path="url(#c)">
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  <rect width="6" height="${H}" fill="url(#g)"/>
  <circle cx="${W - 40}" cy="-30" r="150" fill="url(#g)" opacity="0.10"/>
  <circle cx="${W - 120}" cy="${H + 40}" r="110" fill="url(#g)" opacity="0.07"/>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${t.line}"/>
<g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <text x="36" y="40" font-size="14" font-weight="600" fill="${t.muted}" letter-spacing="0.4">${text(input.repo)}</text>
  ${title.map((l, i) => `<text x="36" y="${titleY + i * 38}" font-size="30" font-weight="700" fill="${t.fg}">${text(l)}</text>`).join("\n  ")}
  ${summary.map((l, i) => `<text x="36" y="${summaryY + i * 24}" font-size="17" fill="${t.muted}">${text(l)}</text>`).join("\n  ")}
  <rect x="36" y="${H - 50}" width="214" height="32" rx="16" fill="url(#g)"/>
  <text x="143" y="${H - 29}" font-size="14" font-weight="600" fill="#ffffff" text-anchor="middle">Read the explainer  →</text>
  <g transform="translate(${W - 132} ${H - 46})">
    <rect width="22" height="22" rx="6" fill="url(#g)"/>
    <text x="11" y="16" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">E</text>
    <text x="30" y="16" font-size="14" font-weight="600" fill="${t.muted}">Elemnt</text>
  </g>
</g>
</svg>`;
}
