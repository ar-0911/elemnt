import { authPage } from "./auth.js";
import { escapeHtml } from "./page.js";

/**
 * Hosted mode's main address: the landing page, sign-up with "pick your
 * address", your workspaces, and the operators' admin page. Same look as the
 * sign-in screens.
 */

type Errors = Partial<Record<string, string>>;
const v = (s: string | undefined) => escapeHtml(s ?? "");
const err = (e: Errors, k: string) => (e[k] ? `<span class="field-error" id="${k}-error">${escapeHtml(e[k]!)}</span>` : "");
const inv = (e: Errors, k: string) => (e[k] ? ` aria-invalid="true" aria-describedby="${k}-error"` : "");
const alert = (msg?: string, ok = false) => (msg ? `<p class="alert${ok ? " ok" : ""}" role="alert">${escapeHtml(msg)}</p>` : "");
const when = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Checks the address as it's typed, and fills it in from the workspace name until the person edits it. */
const ADDRESS_SCRIPT = `(function(){var s=document.getElementById("slug"),n=document.getElementById("wsname"),out=document.getElementById("slug-check");if(!s||!out)return;var edited=!!s.value,t;
function slugify(x){return x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,30)}
function check(){clearTimeout(t);var q=s.value.trim().toLowerCase();if(!q){out.textContent="";out.className="check";return}t=setTimeout(function(){fetch("/api/check-address?slug="+encodeURIComponent(q)).then(function(r){return r.json()}).then(function(j){if(s.value.trim().toLowerCase()!==q)return;out.textContent=j.ok?"✓ "+j.address+" is free":j.reason;out.className="check "+(j.ok?"ok":"bad")}).catch(function(){})},250)}
s.addEventListener("input",function(){edited=true;check()});if(n)n.addEventListener("input",function(){if(!edited){s.value=slugify(n.value);check()}});if(s.value)check()})();`;

function addressFields(o: { domain: string; approval: boolean; values: Record<string, string>; errors: Errors }) {
  const e = o.errors;
  const val = o.values;
  return `<label for="wsname">Workspace name <span class="hint">Your team, project or just your name.</span><input id="wsname" name="wsname" required maxlength="80" value="${v(val.wsname)}"${inv(e, "wsname")}>${err(e, "wsname")}</label>
<label for="slug">Address
<div class="addr"><input id="slug" name="slug" required minlength="3" maxlength="30" autocapitalize="none" spellcheck="false" value="${v(val.slug)}"${inv(e, "slug")} aria-describedby="slug-check"><span>.${escapeHtml(o.domain)}</span></div>
${err(e, "slug")}<span class="check" id="slug-check" aria-live="polite"></span></label>
${o.approval ? `<label for="purpose">What's it for? <span class="hint">A sentence or two. Workspaces here are approved by hand.</span><textarea id="purpose" name="purpose" maxlength="1000"${inv(e, "purpose")}>${v(val.purpose)}</textarea>${err(e, "purpose")}</label>` : ""}`;
}

export function landingPage(nonce: string, o: { domain: string; approval: boolean }) {
  return authPage(
    nonce,
    "Docs your readers finish",
    `<h1 class="hero">Docs your readers actually finish.</h1>
<p class="lede">Write in Markdown, get a designed page. Claude drafts and suggests edits, and you approve them. Publish to the web when you're ready.</p>
<ul class="points"><li>Your own address, like <strong>you.${escapeHtml(o.domain)}</strong></li><li>Private spaces for your team, public pages for everyone</li><li>Bring your own Claude key; nothing else to set up</li></ul>
<a class="btn" style="display:grid;place-items:center" href="/signup">${o.approval ? "Ask for a workspace" : "Create your workspace"}</a>
<p class="switch">Already have one? <a href="/login">Sign in</a></p>`,
    { index: true },
  );
}

export function hostedSignupPage(nonce: string, o: { domain: string; approval: boolean; values?: Record<string, string>; errors?: Errors; error?: string }) {
  const e = o.errors ?? {};
  const val = o.values ?? {};
  const pw = `<div class="pw"><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"${inv(e, "password")}><button type="button" aria-label="Show password" aria-pressed="false">Show</button></div>`;
  return authPage(
    nonce,
    "Create your workspace",
    `<h1>Create your workspace</h1><p class="lede">${o.approval ? "Make an account and pick an address. We'll open it as soon as it's approved." : "One form, then you're in. It takes about a minute."}</p>${alert(o.error)}
<form method="post" action="/signup" novalidate>
${addressFields({ domain: o.domain, approval: o.approval, values: val, errors: e })}
<label for="name">Your name<input id="name" name="name" autocomplete="name" value="${v(val.name)}"></label>
<label for="username">Username<input id="username" name="username" autocomplete="username" required minlength="3" maxlength="30" value="${v(val.username)}"${inv(e, "username")} autocapitalize="none" spellcheck="false">${err(e, "username") || `<span class="hint">3 to 30 letters, digits, - or _.</span>`}</label>
<label for="email">Email<input id="email" name="email" type="email" autocomplete="email" required value="${v(val.email)}"${inv(e, "email")}>${err(e, "email")}</label>
<label for="password">Password${pw}${err(e, "password") || `<span class="hint">At least 8 characters.</span>`}</label>
<button class="btn" type="submit">${o.approval ? "Ask for my workspace" : "Create my workspace"}</button></form>
<p class="switch">Already have an account? <a href="/login">Sign in</a></p>`,
    { script: ADDRESS_SCRIPT },
  );
}

export function hostedLoginPage(nonce: string, o: { next: string; identifier?: string; error?: string }) {
  return authPage(
    nonce,
    "Sign in",
    `<h1>Welcome back</h1><p class="lede">Sign in to see your workspaces.</p>${alert(o.error)}
<form method="post" action="/login"><input type="hidden" name="next" value="${v(o.next)}">
<label for="identifier">Username or email<input id="identifier" name="identifier" autocomplete="username" required value="${v(o.identifier)}"${o.identifier ? "" : " autofocus"}></label>
<label for="password">Password<div class="pw"><input id="password" name="password" type="password" required autocomplete="current-password"${o.identifier ? " autofocus" : ""}><button type="button" aria-label="Show password" aria-pressed="false">Show</button></div></label>
<button class="btn" type="submit">Sign in</button></form>
<p class="switch">New here? <a href="/signup">Create a workspace</a></p>`,
  );
}

export interface DashboardData {
  who: string;
  domain: string;
  approval: boolean;
  operator: boolean;
  canCreate: boolean;
  maxOwned: number;
  workspaces: { slug: string; name: string; role: string; url: string; suspended: boolean }[];
  requests: { slug: string; name: string; status: string; note: string | null; createdAt: Date }[];
  values?: Record<string, string>;
  errors?: Errors;
  error?: string;
  notice?: string;
}

export function dashboardPage(nonce: string, o: DashboardData) {
  const spaces = o.workspaces.length
    ? `<ul class="list">${o.workspaces
        .map(
          (w) =>
            `<li><div><strong>${escapeHtml(w.name)}</strong><div class="meta">${escapeHtml(new URL(w.url).host)} · ${escapeHtml(w.role)}${w.suspended ? " · suspended" : ""}</div></div>${w.suspended ? "" : `<a class="btn small" style="display:grid;place-items:center" href="/go/${encodeURIComponent(w.slug)}">Open</a>`}</li>`,
        )
        .join("")}</ul>`
    : `<p class="empty">You're not in any workspace yet.</p>`;
  const open = o.requests.filter((r) => r.status !== "approved");
  const requests = open.length
    ? `<h2>Requests</h2><ul class="list">${open
        .map((r) => `<li><div><strong>${escapeHtml(r.name)}</strong><div class="meta">${escapeHtml(r.slug)}.${escapeHtml(o.domain)} · asked ${when(r.createdAt)}${r.note ? ` · ${escapeHtml(r.note)}` : ""}</div></div><span class="role">${r.status === "pending" ? "waiting" : escapeHtml(r.status)}</span></li>`)
        .join("")}</ul>`
    : "";
  const create = o.canCreate
    ? `<h2>${o.approval ? "Ask for a workspace" : "New workspace"}</h2><form method="post" action="/workspaces" novalidate>${addressFields({ domain: o.domain, approval: o.approval, values: o.values ?? {}, errors: o.errors ?? {} })}<button class="btn" type="submit">${o.approval ? "Ask for it" : "Create it"}</button></form>`
    : `<p class="foot">You own ${o.maxOwned} workspaces, the most one person can have here${o.approval ? ", or have a request waiting" : ""}.</p>`;
  return authPage(
    nonce,
    "Your workspaces",
    `<h1>Your workspaces</h1><p class="lede">Signed in as <strong>${escapeHtml(o.who)}</strong>${o.operator ? ` · <a href="/admin">Admin</a>` : ""}</p>${alert(o.notice, true)}${alert(o.error)}
${spaces}${requests}${create}
<form method="post" action="/logout" style="margin-top:22px"><button class="btn secondary" type="submit">Sign out</button></form>`,
    { wide: true, script: ADDRESS_SCRIPT },
  );
}

export interface AdminData {
  domain: string;
  pending: { id: string; slug: string; name: string; purpose: string; createdAt: Date; email: string; username: string | null }[];
  workspaces: { slug: string; name: string; createdAt: Date; suspendedAt: Date | null; owner: string | null; members: number | null }[];
  notice?: string;
  error?: string;
}

export function adminPage(nonce: string, o: AdminData) {
  const pending = o.pending.length
    ? `<h2>Waiting for approval</h2><ul class="list">${o.pending
        .map(
          (r) =>
            `<li><div><strong>${escapeHtml(r.name)}</strong> <span class="meta">${escapeHtml(r.slug)}.${escapeHtml(o.domain)}</span><div class="meta">${escapeHtml(r.email)} · ${when(r.createdAt)}</div><div>${escapeHtml(r.purpose)}</div></div>
<form method="post" action="/admin/requests/${encodeURIComponent(r.id)}"><input name="note" placeholder="Note (if declining)" aria-label="Note" style="height:34px;width:180px"><button class="btn small secondary" name="decision" value="decline">Decline</button><button class="btn small" name="decision" value="approve">Approve</button></form></li>`,
        )
        .join("")}</ul>`
    : "";
  const all = o.workspaces.length
    ? `<ul class="list">${o.workspaces
        .map(
          (w) =>
            `<li><div><strong>${escapeHtml(w.name)}</strong> <span class="meta">${escapeHtml(w.slug)}.${escapeHtml(o.domain)}</span><div class="meta">${escapeHtml(w.owner ?? "no owner")} · ${w.members ?? 0} ${w.members === 1 ? "member" : "members"} · since ${when(w.createdAt)}${w.suspendedAt ? ` · suspended ${when(w.suspendedAt)}` : ""}</div></div>
<form method="post" action="/admin/workspaces/${encodeURIComponent(w.slug)}">${w.suspendedAt ? `<button class="btn small" name="action" value="resume">Turn back on</button>` : `<button class="btn small danger" name="action" value="suspend">Suspend</button>`}</form></li>`,
        )
        .join("")}</ul>`
    : `<p class="empty">No workspaces yet.</p>`;
  return authPage(
    nonce,
    "Admin",
    `<h1>Admin</h1><p class="lede">Everything on ${escapeHtml(o.domain)}. Suspending a workspace closes it to everyone, its owners included, until you turn it back on. Nothing is deleted.</p>${alert(o.notice, true)}${alert(o.error)}
${pending}<h2>Workspaces (${o.workspaces.length})</h2>${all}<p class="switch"><a href="/">Back to your workspaces</a></p>`,
    { wide: true },
  );
}

/** What a workspace address shows when nobody has it, or it's suspended. */
export function noWorkspacePage(o: { host: string; home: string; suspended: boolean }) {
  const body = o.suspended
    ? `<h1>This workspace is switched off</h1><p>${escapeHtml(o.host)} has been suspended. If it's yours, get in touch with whoever runs this server.</p>`
    : `<h1>Nothing here yet</h1><p>No workspace lives at ${escapeHtml(o.host)}.</p><p><a href="${escapeHtml(o.home)}/signup">Make it yours</a></p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${o.suspended ? "Switched off" : "Nothing here"}</title></head><body style="font:16px/1.6 system-ui;max-width:560px;margin:80px auto;padding:0 16px;text-align:center">${body}</body></html>`;
}
