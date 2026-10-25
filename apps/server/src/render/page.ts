import { contentCss, themeTokensCss } from "@elemnt/core";
/**
 * The reader shell around a stored rendition. Server-rendered, readable with
 * JavaScript off; one small nonce'd script adds tabs, the copy button and
 * Mermaid. The interactive Web Components package replaces it in M3.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

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
}

const MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const CSS = `
${themeTokensCss}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
header.bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px max(16px,4vw);border-bottom:1px solid var(--line);background:var(--surface)}
header.bar a{color:var(--muted);text-decoration:none}.bar .crumb{font-size:14px}
.toggle{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:13px}
.toggle a{padding:6px 12px;color:var(--muted)}.toggle a[aria-current="page"]{background:var(--soft);color:var(--accent);font-weight:600}
.actions{display:flex;gap:8px;align-items:center}
.btn{font:600 13px system-ui;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--fg);cursor:pointer;text-decoration:none}
.btn.li{background:#0a66c2;border-color:#0a66c2;color:#fff}
main{max-width:760px;margin:0 auto;padding:32px 16px 96px}
.md pre{white-space:pre-wrap;font-size:14px}
dialog{border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg);max-width:520px;width:calc(100% - 32px)}
dialog textarea{width:100%;min-height:120px;font:inherit}
${contentCss}
`;

const SCRIPT = `
for (const root of document.querySelectorAll(".elemnt-tabs")) {
  const panels = [...root.querySelectorAll(":scope > .elemnt-tab")];
  if (panels.length < 2) continue;
  const list = document.createElement("div"); list.className = "tablist"; list.setAttribute("role", "tablist");
  panels.forEach((p, i) => {
    p.querySelector(".elemnt-tab-label")?.setAttribute("hidden", "");
    const b = document.createElement("button"); b.type = "button"; b.role = "tab"; b.textContent = p.dataset.label || "Tab " + (i + 1);
    b.onclick = () => { panels.forEach((q, j) => { q.hidden = j !== i; list.children[j].setAttribute("aria-selected", String(j === i)); }); };
    list.append(b);
  });
  root.prepend(list); list.children[0].click();
}
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
if (document.querySelector("pre.mermaid")) {
  const { default: mermaid } = await import("${MERMAID}");
  mermaid.initialize({ startOnLoad: false, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
  await mermaid.run({ querySelector: "pre.mermaid" });
}
`;

export function renderShell(p: ShellInput): string {
  const t = escapeHtml(p.title);
  const d = p.summary ? escapeHtml(p.summary) : "";
  const pageHref = p.canonicalUrl;
  const mdViewHref = `${p.canonicalUrl}?view=markdown`;
  const content =
    p.view === "page"
      ? `<article class="elemnt-page">${/<h1[\s>]/.test(p.body) ? "" : `<h1>${t}</h1>${d ? `<p class="lede">${d}</p>` : ""}`}${p.body}</article>`
      : `<div class="md"><p><button class="btn" id="copy-md" type="button">Copy Markdown</button> This is exactly what Claude reads, also at <a href="${escapeHtml(p.markdownUrl)}">${escapeHtml(new URL(p.markdownUrl).pathname)}</a>.</p><pre id="md-body">${escapeHtml(p.body)}</pre></div>`;

  const share = p.share
    ? `<a class="btn li" href="${escapeHtml(p.share.dialogUrl)}" target="_blank" rel="noopener">Share on LinkedIn</a>` +
      (p.share.canPost ? `<button class="btn" id="post-li" type="button" data-page="${escapeHtml(p.share.pageId)}">Post from Elemnt</button>` : "")
    : "";
  const dialog = p.share?.canPost
    ? `<dialog id="li-dialog"><form id="li-form" method="dialog"><h3>Post to LinkedIn</h3><label for="commentary">What do you want to say?</label><textarea id="commentary" name="commentary" maxlength="3000" required>New write-up: ${t}${d ? `. ${d}` : ""}</textarea><p><button class="btn li" type="submit">Post</button> <button class="btn" type="button" onclick="this.closest('dialog').close()">Cancel</button></p><p id="li-status" role="status"></p></form></dialog>`
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
</head><body>
<header class="bar">
  <span class="crumb"><a href="/s/${escapeHtml(p.space.slug)}">${escapeHtml(p.space.name)}</a> / ${t}</span>
  <span class="actions">
    <nav class="toggle" aria-label="View"><a href="${escapeHtml(pageHref)}"${p.view === "page" ? ' aria-current="page"' : ""}>Page</a><a href="${escapeHtml(mdViewHref)}"${p.view === "markdown" ? ' aria-current="page"' : ""}>Markdown</a></nav>
    ${p.editUrl ? `<a class="btn" href="${escapeHtml(p.editUrl)}">Edit</a>` : ""}
    ${share}
  </span>
</header>
<main>${content}</main>
${dialog}
<script type="module" nonce="${p.nonce}">${SCRIPT}</script>
</body></html>`;
}

export function renderSimple(nonce: string, title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${bodyHtml}</main><script type="module" nonce="${nonce}"></script></body></html>`;
}
