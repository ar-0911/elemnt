import { contentCss, MERMAID_BASE, themeTokensCss } from "@elemnt/core";
/**
 * The reader shell around a stored rendition. Server-rendered and readable
 * with JavaScript off; @elemnt/elements (served at /assets/elements.js) then
 * hydrates tabs, charts, sliders, quizzes, diagrams, widgets and runnable code.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export interface Look {
  css: string;
  classes: string[];
  fontsHref?: string;
  mode: "auto" | "light" | "dark";
}

/**
 * Head tags for a page style. The inline script sets light or dark before
 * first paint (the reader's saved choice, else the page's default), so a
 * dark page never flashes white.
 */
export function lookHead(nonce: string, look?: Look): string {
  const fonts = look?.fontsHref
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" data-elemnt-fonts href="${escapeHtml(look.fontsHref)}">`
    : "";
  const mode = look?.mode ?? "auto";
  return `${fonts}${look ? `<style>${look.css.replace(/<\/(style)/gi, "<\\/$1")}</style>` : ""}
<script nonce="${nonce}">try{var t=localStorage.getItem("elemnt-theme");t=t==="light"||t==="dark"?t:${JSON.stringify(mode === "auto" ? null : mode)};if(t)document.documentElement.dataset.theme=t}catch(e){}</script>`;
}

export const bodyClass = (look?: Look) => (look ? ` class="${escapeHtml(look.classes.join(" "))}"` : "");

export interface ShellInput {
  nonce: string;
  title: string;
  summary?: string | null;
  canonicalUrl: string;
  markdownUrl: string;
  space: { slug: string; name: string };
  view: "page" | "markdown";
  /** Rendered HTML (view=page) or Markdown text (view=markdown). */
  body: string;
  /** Present for public pages only. */
  share?: { dialogUrl: string; canPost: boolean; pageId: string };
  /** Present for members who can edit. */
  editUrl?: string;
  /** Where widgets run; widgets stay static without it. */
  sandboxUrl?: string;
  /** Run widgets without a click (members, or verified workspaces). */
  autorun?: boolean;
  pageId?: string;
  /** Show Ask the page. */
  ask?: boolean;
  /** Approved reading levels, and the one being shown. */
  levels?: { level: string; label: string }[];
  level?: string;
  /** The page style: tokens, wrapper classes, fonts, and the default light/dark mode. */
  look?: Look;
  /** Explainer pages: the repo and commit the page was written against. */
  repo?: { repo: string; pinnedCommit: string; checkedCommit: string | null; behindBy: number };
}

function levelNav(p: ShellInput): string {
  if (!p.levels?.length) return "";
  const href = (level?: string) => {
    const q = new URLSearchParams();
    if (level) q.set("level", level);
    if (p.view === "markdown") q.set("view", "markdown");
    const qs = q.toString();
    return escapeHtml(qs ? `${p.canonicalUrl}?${qs}` : p.canonicalUrl);
  };
  const links = [{ level: undefined, label: "Original" }, ...p.levels].map(
    (l) => `<a href="${href(l.level)}"${(l.level ?? undefined) === p.level ? ' aria-current="page"' : ""}>${escapeHtml(l.label)}</a>`,
  );
  return `<nav class="levels" aria-label="Reading level">${links.join("")}</nav>`;
}

function repoBanner(r: NonNullable<ShellInput["repo"]>): string {
  const base = `https://github.com/${escapeHtml(r.repo)}`;
  const sha = escapeHtml(r.pinnedCommit);
  const behind =
    r.behindBy > 0 && r.checkedCommit
      ? ` · <a href="${base}/compare/${sha}...${escapeHtml(r.checkedCommit)}">${r.behindBy} commit${r.behindBy === 1 ? "" : "s"} behind</a>`
      : " · up to date";
  return `<p class="repo-banner">Explains <a href="${base}">${escapeHtml(r.repo)}</a>, written against <a href="${base}/tree/${sha}"><code>${sha.slice(0, 7)}</code></a>${behind}</p>`;
}

export function contentSecurityPolicy(nonce: string, sandboxUrl?: string): string {
  return [
    "default-src 'self'",
    // Page-style fonts come from Google Fonts (ELEMNT_FONTS=off turns that off).
    "font-src 'self' data: https://fonts.gstatic.com",
    // 'self' for /assets/elements.js; Mermaid's own folder on jsDelivr, loaded only on pages with diagrams.
    `script-src 'nonce-${nonce}' 'self' ${MERMAID_BASE}`,
    `frame-src ${sandboxUrl ? new URL(sandboxUrl).origin : "'none'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const CSS = `
${themeTokensCss}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 var(--font-body,system-ui,-apple-system,"Segoe UI",sans-serif);-webkit-font-smoothing:antialiased}
header.bar{position:sticky;top:0;z-index:4;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:10px max(16px,4vw);border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--surface) 78%,transparent);-webkit-backdrop-filter:saturate(1.4) blur(12px);backdrop-filter:saturate(1.4) blur(12px)}
.theme-toggle{min-width:34px;font-size:15px;line-height:1}
.frame{container-type:inline-size}
header.bar a{color:var(--muted);text-decoration:none}.bar .crumb{font-size:14px}
.toggle{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:13px}
.toggle a{padding:6px 12px;color:var(--muted)}.toggle a[aria-current="page"]{background:var(--soft);color:var(--accent);font-weight:600}
.actions{display:flex;gap:8px;align-items:center}
.btn{font:600 13px system-ui;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--fg);cursor:pointer;text-decoration:none}
.btn.li{background:#0a66c2;border-color:#0a66c2;color:#fff}
main{max-width:var(--page-width,760px);margin:0 auto;padding:32px 16px 96px}
.levels{display:inline-flex;gap:2px;font-size:13px}.levels a{padding:4px 8px;border-radius:5px;color:var(--muted)}.levels a[aria-current=page]{background:var(--soft);color:var(--accent);font-weight:600}
.elemnt-ask-open{position:fixed;right:20px;bottom:20px;font:600 14px system-ui;padding:10px 18px;border-radius:999px;border:0;background:var(--accent);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer}
.elemnt-ask-chip{position:absolute;z-index:5;font:600 12px system-ui;padding:5px 10px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--accent);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.elemnt-ask{position:fixed;right:16px;bottom:16px;width:min(420px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:10}
.elemnt-ask[hidden]{display:none}.elemnt-ask-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}
.elemnt-ask-close{border:0;background:none;font-size:20px;color:var(--muted);cursor:pointer}
.elemnt-ask-quote{margin:10px 14px 0;padding:6px 10px;border-left:3px solid var(--accent);color:var(--muted);font-size:13px;max-height:80px;overflow:auto}
.elemnt-ask-log{overflow:auto;padding:4px 14px;flex:1}.elemnt-ask-q{font-weight:600;margin:12px 0 4px}.elemnt-ask-a{font-size:15px}.elemnt-ask-a[data-error]{color:var(--danger)}
.elemnt-ask-meta{font-size:13px;color:var(--muted)}
.elemnt-ask form{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line)}.elemnt-ask textarea{flex:1;font:inherit;font-size:14px;resize:vertical;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--fg)}
@media print{.elemnt-ask,.elemnt-ask-open,.elemnt-ask-chip,header.bar{display:none}}
.repo-banner{font-size:13px;color:var(--muted);border:1px solid var(--line);background:var(--surface);border-radius:6px;padding:6px 12px;margin:0 0 20px}
.md pre{white-space:pre-wrap;font-size:14px}
dialog{border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg);max-width:520px;width:calc(100% - 32px)}
dialog textarea{width:100%;min-height:120px;font:inherit}
${contentCss}
`;

const SCRIPT = `
import { enhance, mountAsk, mountThemeToggle, trackReading } from "/assets/elements.js";
const cfg = JSON.parse(document.getElementById("elemnt-config").textContent);
const toggle = document.getElementById("theme-toggle");
if (toggle) mountThemeToggle(toggle, cfg.mode);
const article = document.querySelector("article.elemnt-page");
const source = new URLSearchParams(location.search).get("utm_source") || undefined;
const options = {
  sandboxOrigin: cfg.sandboxUrl ?? undefined,
  widgets: {
    autorun: cfg.autorun,
    report: async (hash, reason) => {
      const res = await fetch("/api/widgets/" + hash + "/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, page: location.pathname }) });
      if (!res.ok) throw new Error("report failed");
    },
  },
};
if (article) {
  enhance(article, options);
  if (cfg.pageId) trackReading(article, { pageId: cfg.pageId, source });
  if (cfg.pageId && cfg.ask) mountAsk(article, { pageId: cfg.pageId, source, enhance: (el) => enhance(el, options) });
}
document.getElementById("li-draft")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = "Drafting…";
  const res = await fetch("/api/pages/" + post.dataset.page + "/linkedin/draft", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (res.ok) document.getElementById("commentary").value = data.commentary;
  else document.getElementById("li-status").textContent = data.error || "Couldn't draft a post.";
  btn.disabled = false; btn.textContent = "Draft with Claude";
});
const copy = document.getElementById("copy-md");
copy?.addEventListener("click", async () => {
  const text = document.getElementById("md-body")?.textContent ?? "";
  try { await navigator.clipboard.writeText(text); copy.textContent = "Copied"; } catch { copy.textContent = "Select and copy"; }
});
const post = document.getElementById("post-li");
post?.addEventListener("click", () => document.getElementById("li-dialog")?.showModal());
document.getElementById("li-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("li-status");
  status.textContent = "Posting…";
  const res = await fetch("/api/pages/" + post.dataset.page + "/linkedin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentary: e.target.commentary.value }) });
  const data = await res.json().catch(() => ({}));
  status.innerHTML = res.ok ? (data.postUrl ? 'Posted. <a href="' + data.postUrl + '" target="_blank" rel="noopener">View on LinkedIn</a>' : "Posted.") : (data.error || "Posting failed.");
});
`;

export function renderShell(p: ShellInput): string {
  const t = escapeHtml(p.title);
  const d = p.summary ? escapeHtml(p.summary) : "";
  const pageHref = p.canonicalUrl;
  const lv = p.level ? `level=${encodeURIComponent(p.level)}` : "";
  const pageViewHref = lv ? `${p.canonicalUrl}?${lv}` : p.canonicalUrl;
  const mdViewHref = `${p.canonicalUrl}?view=markdown${lv ? `&${lv}` : ""}`;
  const content =
    p.view === "page"
      ? `<article class="elemnt-page">${/<h1[\s>]/.test(p.body) ? "" : `<h1>${t}</h1>${d ? `<p class="lede">${d}</p>` : ""}`}${p.body}</article>`
      : `<div class="md"><p><button class="btn" id="copy-md" type="button">Copy Markdown</button> This is exactly what Claude reads, also at <a href="${escapeHtml(p.markdownUrl)}">${escapeHtml(new URL(p.markdownUrl).pathname)}</a>.</p><pre id="md-body">${escapeHtml(p.body)}</pre></div>`;

  const share = p.share
    ? `<a class="btn li" href="${escapeHtml(p.share.dialogUrl)}" target="_blank" rel="noopener">Share on LinkedIn</a>` +
      (p.share.canPost ? `<button class="btn" id="post-li" type="button" data-page="${escapeHtml(p.share.pageId)}">Post from Elemnt</button>` : "")
    : "";
  const dialog = p.share?.canPost
    ? `<dialog id="li-dialog"><form id="li-form" method="dialog"><h3>Post to LinkedIn</h3><label for="commentary">What do you want to say?</label><textarea id="commentary" name="commentary" maxlength="3000" required>New write-up: ${t}${d ? `. ${d}` : ""}</textarea><p><button class="btn" type="button" id="li-draft">Draft with Claude</button> <button class="btn li" type="submit">Post</button> <button class="btn" type="button" onclick="this.closest('dialog').close()">Cancel</button></p><p id="li-status" role="status"></p></form></dialog>`
    : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t} · ${escapeHtml(p.space.name)}</title>
${d ? `<meta name="description" content="${d}">` : ""}
<link rel="canonical" href="${escapeHtml(pageHref)}">
<link rel="alternate" type="text/markdown" href="${escapeHtml(p.markdownUrl)}">
<meta property="og:type" content="article"><meta property="og:title" content="${t}">
${d ? `<meta property="og:description" content="${d}">` : ""}
<meta property="og:url" content="${escapeHtml(pageHref)}"><meta property="og:site_name" content="${escapeHtml(p.space.name)}">
<meta name="twitter:card" content="summary">
<style>${CSS}</style>
${lookHead(p.nonce, p.look)}
</head><body${bodyClass(p.look)}>
<header class="bar">
  <span class="crumb"><a href="/s/${escapeHtml(p.space.slug)}">${escapeHtml(p.space.name)}</a> / ${t}</span>
  <span class="actions">
    ${levelNav(p)}
    <a class="btn" href="${escapeHtml(pageHref)}?view=present${p.level ? `&amp;level=${escapeHtml(p.level)}` : ""}">Present</a>
    <nav class="toggle" aria-label="View"><a href="${escapeHtml(pageViewHref)}"${p.view === "page" ? ' aria-current="page"' : ""}>Page</a><a href="${escapeHtml(mdViewHref)}"${p.view === "markdown" ? ' aria-current="page"' : ""}>Markdown</a></nav>
    <button class="btn theme-toggle" id="theme-toggle" type="button" aria-label="Toggle dark mode">☾</button>
    ${p.editUrl ? `<a class="btn" href="${escapeHtml(p.editUrl)}">Edit</a>` : ""}
    ${share}
  </span>
</header>
<div class="frame"><main>${p.repo ? repoBanner(p.repo) : ""}${content}</main></div>
${dialog}
<script type="application/json" id="elemnt-config">${jsonForScript({ sandboxUrl: p.sandboxUrl ?? null, autorun: Boolean(p.autorun), pageId: p.pageId ?? null, ask: Boolean(p.ask && p.view === "page"), mode: p.look?.mode ?? "auto" })}</script>
<script type="module" nonce="${p.nonce}">${SCRIPT}</script>
</body></html>`;
}

/** JSON that can't end the script element it sits in. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderSimple(nonce: string, title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${bodyHtml}</main><script type="module" nonce="${nonce}"></script></body></html>`;
}
