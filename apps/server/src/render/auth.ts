import { escapeHtml } from "./page.js";

/**
 * Sign-in, sign-up and consent screens. One centred card on a quiet
 * background, real labels, errors next to the field they're about, and
 * light or dark to match the reader's choice. No external assets.
 */

const CSS = `
:root{--bg:#f6f7fb;--card:#fff;--fg:#14161f;--muted:#5d6475;--line:#dfe2ea;--accent:#4f46e5;--accent-fg:#fff;--soft:#eef0ff;--danger:#c0262d;--danger-soft:#fdecec;--ok:#15803d;--ok-soft:#e8f6ec;color-scheme:light}
:root[data-theme=dark]{--bg:#0d0f16;--card:#161925;--fg:#eceef5;--muted:#9aa1b4;--line:#2a2f40;--accent:#8b85ff;--accent-fg:#0d0f16;--soft:#1f2236;--danger:#ff7b80;--danger-soft:#3a1c20;--ok:#5ad38a;--ok-soft:#153222;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d0f16;--card:#161925;--fg:#eceef5;--muted:#9aa1b4;--line:#2a2f40;--accent:#8b85ff;--accent-fg:#0d0f16;--soft:#1f2236;--danger:#ff7b80;--danger-soft:#3a1c20;--ok:#5ad38a;--ok-soft:#153222;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 16px;background:radial-gradient(1200px 600px at 10% -10%,var(--soft),transparent 60%),radial-gradient(900px 500px at 110% 110%,var(--soft),transparent 60%),var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 32px 28px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 12px 32px rgba(16,24,40,.08)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:22px;font-weight:800;font-size:18px;letter-spacing:-.02em;color:var(--fg);text-decoration:none}
.brand svg{width:28px;height:28px}
h1{font-size:22px;line-height:1.25;letter-spacing:-.02em;margin:0 0 6px}
.lede{color:var(--muted);margin:0 0 22px}
form{display:grid;gap:14px}
label{display:grid;gap:6px;font-size:13px;font-weight:600}
.hint{font-weight:400;color:var(--muted);font-size:12px}
input{width:100%;height:42px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit;font-size:15px;transition:border-color .15s,box-shadow .15s}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
input[aria-invalid=true]{border-color:var(--danger)}
.pw{position:relative}.pw input{padding-right:64px}
.pw button{position:absolute;right:6px;top:6px;height:30px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--muted);font:600 12px system-ui;cursor:pointer}
.pw button:hover{background:var(--soft);color:var(--fg)}
.field-error{color:var(--danger);font-size:12px;font-weight:500}
.btn{height:44px;border:0;border-radius:10px;background:var(--accent);color:var(--accent-fg);font:600 15px system-ui;cursor:pointer;margin-top:4px;transition:filter .15s}
.btn:hover{filter:brightness(1.07)}.btn:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 40%,transparent);outline-offset:2px}
.btn.secondary{background:transparent;color:var(--fg);border:1px solid var(--line)}
.row{display:flex;gap:10px}.row .btn{flex:1}
.alert{padding:10px 12px;border-radius:10px;background:var(--danger-soft);color:var(--danger);font-size:14px;margin:0 0 16px}
.alert.ok{background:var(--ok-soft);color:var(--ok)}
.switch{margin:20px 0 0;text-align:center;color:var(--muted);font-size:14px}
a{color:var(--accent);font-weight:600;text-decoration:none}a:hover{text-decoration:underline}
details{margin-top:18px;border-top:1px solid var(--line);padding-top:14px;font-size:14px;color:var(--muted)}
summary{cursor:pointer;font-weight:600}details form{margin-top:12px}
.role{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--soft);color:var(--accent);font-weight:700;font-size:12px;text-transform:capitalize}
ul.scopes{margin:0 0 18px;padding-left:18px;color:var(--muted)}
.foot{margin-top:18px;text-align:center;font-size:12px;color:var(--muted)}
`;

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M10 9h12M10 16h9M10 23h12M10 9v14" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`;

/** Applies the reader's saved light/dark choice before paint, and wires show/hide on password fields. */
const SCRIPT = `try{var t=localStorage.getItem("elemnt-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}
document.querySelectorAll(".pw").forEach(function(w){var i=w.querySelector("input"),b=w.querySelector("button");b.addEventListener("click",function(){var s=i.type==="password";i.type=s?"text":"password";b.textContent=s?"Hide":"Show";b.setAttribute("aria-pressed",String(s));i.focus()})});
var f=document.querySelector("[autofocus]");if(f)f.focus();`;

export function authPage(nonce: string, title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Elemnt</title><style>${CSS}</style></head><body><main class="card"><a class="brand" href="/">${LOGO}Elemnt</a>${body}</main><script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

type Errors = Partial<Record<string, string>>;
const v = (s: string | undefined) => escapeHtml(s ?? "");
const err = (e: Errors, k: string) => (e[k] ? `<span class="field-error" id="${k}-error">${escapeHtml(e[k]!)}</span>` : "");
const inv = (e: Errors, k: string) => (e[k] ? ` aria-invalid="true" aria-describedby="${k}-error"` : "");
const alert = (msg?: string, ok = false) => (msg ? `<p class="alert${ok ? " ok" : ""}" role="alert">${escapeHtml(msg)}</p>` : "");
const pw = (name: string, auto: string, e: Errors, extra = "") =>
  `<div class="pw"><input id="${name}" name="${name}" type="password" required autocomplete="${auto}"${inv(e, name)}${extra}><button type="button" aria-label="Show password" aria-pressed="false">Show</button></div>`;

export function loginPage(nonce: string, o: { next: string; identifier?: string; error?: string; notice?: string; signupOpen: boolean }) {
  const next = `<input type="hidden" name="next" value="${v(o.next)}">`;
  return authPage(
    nonce,
    "Sign in",
    `<h1>Welcome back</h1><p class="lede">Sign in to write and publish your docs.</p>${alert(o.notice, true)}${alert(o.error)}
<form method="post" action="/login">${next}
<label for="identifier">Username or email<input id="identifier" name="identifier" autocomplete="username" required value="${v(o.identifier)}"${o.identifier ? "" : " autofocus"}></label>
<label for="password">Password${pw("password", "current-password", {}, o.identifier ? " autofocus" : "")}</label>
<button class="btn" type="submit">Sign in</button></form>
${o.signupOpen ? `<p class="switch">New here? <a href="/signup${o.next !== "/" ? `?next=${encodeURIComponent(o.next)}` : ""}">Create an account</a></p>` : `<p class="switch">Need an account? Ask a workspace admin for an invite link.</p>`}
<details><summary>Sign in with an API token</summary><form method="post" action="/login">${next}<label for="token">API token<span class="hint">Starts with elm_. Made in Settings, or printed by the bootstrap script.</span><input id="token" name="token" type="password" autocomplete="off" required></label><button class="btn secondary" type="submit">Sign in with token</button></form></details>`,
  );
}

export function signupPage(
  nonce: string,
  o: { next: string; invite?: string; values?: Record<string, string>; errors?: Errors; error?: string; firstAccount: boolean; role?: string; workspaceName?: string; blocked?: string },
) {
  const e = o.errors ?? {};
  const val = o.values ?? {};
  if (o.blocked)
    return authPage(nonce, "Create an account", `<h1>Join ${escapeHtml(o.workspaceName ?? "Elemnt")}</h1>${alert(o.blocked)}<p class="switch">Already have an account? <a href="/login">Sign in</a></p>`);
  const heading = o.firstAccount ? "Set up Elemnt" : `Join ${escapeHtml(o.workspaceName ?? "Elemnt")}`;
  const lede = o.firstAccount
    ? "You're the first one here, so this account will own the workspace. You can invite your team afterwards."
    : `You'll join as <span class="role">${escapeHtml(o.role ?? "viewer")}</span>.`;
  return authPage(
    nonce,
    "Create an account",
    `<h1>${heading}</h1><p class="lede">${lede}</p>${alert(o.error)}
<form method="post" action="/signup" novalidate>
<input type="hidden" name="next" value="${v(o.next)}">${o.invite ? `<input type="hidden" name="invite" value="${v(o.invite)}">` : ""}
<label for="name">Your name <span class="hint">Shown on comments and history.</span><input id="name" name="name" autocomplete="name" value="${v(val.name)}" autofocus></label>
<label for="username">Username<input id="username" name="username" autocomplete="username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{2,29}" value="${v(val.username)}"${inv(e, "username")} autocapitalize="none" spellcheck="false">${err(e, "username") || `<span class="hint">3 to 30 letters, digits, - or _.</span>`}</label>
<label for="email">Email<input id="email" name="email" type="email" autocomplete="email" required value="${v(val.email)}"${inv(e, "email")}>${err(e, "email")}</label>
<label for="password">Password${pw("password", "new-password", e, ' minlength="8"')}${err(e, "password") || `<span class="hint">At least 8 characters. A short sentence is easy to remember.</span>`}</label>
<button class="btn" type="submit">${o.firstAccount ? "Create workspace" : "Create account"}</button></form>
${o.firstAccount ? "" : `<p class="switch">Already have an account? <a href="/login">Sign in</a></p>`}`,
  );
}

export function consentPage(nonce: string, o: { client: string; who: string; hidden: string }) {
  return authPage(
    nonce,
    "Connect",
    `<h1>Connect ${escapeHtml(o.client)}?</h1><p class="lede">Signed in as <strong>${escapeHtml(o.who)}</strong>.</p>
<p>${escapeHtml(o.client)} will be able to:</p><ul class="scopes"><li>read the pages you can read</li><li>create drafts and suggest edits for you to review</li><li>add comments</li></ul>
<form method="post" action="/oauth/authorize">${o.hidden}<div class="row"><button class="btn secondary" type="submit" name="decision" value="deny">Cancel</button><button class="btn" type="submit" name="decision" value="allow" autofocus>Allow</button></div></form>
<p class="foot">You can disconnect it any time in Settings → Account.</p>`,
  );
}
