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
:root{--bg:#f7f8fa;--fg:#161a22;--muted:#5b6374;--line:#dde1e8;--surface:#fff;--accent:#2949c7;--soft:#e7ecfb;--code:#eef0f4;--warn:#9a5b00;--warn-soft:#fbf0dc;--danger:#b0312b;--danger-soft:#fbe6e4;--ok:#1f7a4d;--ok-soft:#e3f3ea}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--fg:#e4e7ee;--muted:#9aa2b4;--line:#2a303c;--surface:#161a22;--accent:#8aa2ff;--soft:#1d2440;--code:#1c212b;--warn:#f0b65a;--warn-soft:#2c2213;--danger:#ff8b84;--danger-soft:#331a19;--ok:#6fd3a0;--ok-soft:#13291f;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
header.bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px max(16px,4vw);border-bottom:1px solid var(--line);background:var(--surface)}
header.bar a{color:var(--muted);text-decoration:none}.bar .crumb{font-size:14px}
.toggle{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:13px}
.toggle a{padding:6px 12px;color:var(--muted)}.toggle a[aria-current="page"]{background:var(--soft);color:var(--accent);font-weight:600}
.actions{display:flex;gap:8px;align-items:center}
.btn{font:600 13px system-ui;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--fg);cursor:pointer;text-decoration:none}
.btn.li{background:#0a66c2;border-color:#0a66c2;color:#fff}
main{max-width:760px;margin:0 auto;padding:32px 16px 96px}
h1,h2,h3{line-height:1.2;text-wrap:balance}a{color:var(--accent)}
code{font:0.88em ui-monospace,Menlo,monospace;background:var(--code);padding:1px 5px;border-radius:4px}
pre{background:var(--code);border:1px solid var(--line);border-radius:6px;padding:12px 14px;overflow-x:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 10px}
.md pre{white-space:pre-wrap;font-size:14px}
.lede{font-size:19px;color:var(--muted);margin-top:-8px}
.elemnt-callout{border:1px solid var(--line);border-left:4px solid var(--accent);background:var(--surface);border-radius:6px;padding:4px 16px;margin:16px 0}
.elemnt-callout[data-type=warn]{border-left-color:var(--warn);background:var(--warn-soft)}
.elemnt-callout[data-type=danger]{border-left-color:var(--danger);background:var(--danger-soft)}
.elemnt-callout[data-type=tip]{border-left-color:var(--ok);background:var(--ok-soft)}
.elemnt-callout-title{font-weight:700;margin-bottom:0}
.elemnt-steps ol,.elemnt-runbook{counter-reset:s;list-style:none;padding-left:0}
.elemnt-steps li,.elemnt-runbook-step{counter-increment:s;position:relative;padding-left:40px;margin:14px 0}
.elemnt-steps li::before,.elemnt-runbook-step::before{content:counter(s);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--soft);color:var(--accent);font:700 13px/28px system-ui;text-align:center}
.elemnt-runbook-title{font-weight:700;margin:0 0 6px}.elemnt-runbook-gate{margin-left:8px;font:600 11px system-ui;padding:3px 7px;border-radius:4px;background:var(--warn-soft);color:var(--warn)}
.elemnt-runbook-expect{font-size:14px;color:var(--muted)}
.elemnt-tab-label{font-weight:700}.tablist{display:flex;gap:2px;border-bottom:1px solid var(--line)}
.tablist button{font:600 13px system-ui;border:0;background:none;color:var(--muted);padding:8px 12px;border-bottom:2px solid transparent;cursor:pointer}
.tablist button[aria-selected=true]{color:var(--accent);border-bottom-color:var(--accent)}
.elemnt-details{border:1px solid var(--line);border-radius:6px;padding:8px 14px;background:var(--surface)}.elemnt-details summary{font-weight:600;cursor:pointer}
figure.elemnt-diagram{margin:20px 0;text-align:center}figure.elemnt-diagram pre.mermaid{background:var(--surface)}figcaption{font-size:14px;color:var(--muted)}
elemnt-query{font-weight:600;font-variant-numeric:tabular-nums}
[data-elemnt-invalid]{outline:2px dashed var(--danger);outline-offset:4px}
dialog{border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg);max-width:520px;width:calc(100% - 32px)}
dialog textarea{width:100%;min-height:120px;font:inherit}
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
