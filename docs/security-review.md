# Security review, October 2026

This covers two passes: a hostile-input pass against the compiler, and a pass against the running server. Neither one replaces an outside review. The areas that most need one are listed at the end.

## Compiler and sanitizer

About 30 hostile inputs went through the compiler. All of these were stripped: script tags, event handlers, `javascript:` and `data:` URLs, iframes, forms, `<base>`, `<link>`, and SVG attacks (scripts, `foreignObject`, external images and `use`, animated hrefs, style imports).

Two things came up, and neither was a hole:

- **An `onerror=` inside a title attribute.** `![a](x "\" onerror=\"alert(1)")` produces `title="&#x22; onerror=&#x22;alert(1)"`. The quotes are escaped, so this is plain text inside the attribute. It was a false positive from the test's regex.
- **Malformed directives showed up as plain text with no warning.** `:::callout{type="warn\" onmouseover=\"..."}` failed to parse, so it was rendered as an escaped paragraph and saved without telling the author. Malformed directives are now diagnostics:
  - A known component name with broken attributes is an **error**, so the page won't save until it's fixed. The message points at the line and explains the quoting rule.
  - An unknown name that looks like a directive (`::foo{…}`) is a **warning**.
  - Code fences, inline code and text like `10:30` produce no diagnostic.

## Running server

What we checked, and what we found:

| Area | Finding | Change |
| --- | --- | --- |
| Reader page CSP | `script-src` allowed all of `https://cdn.jsdelivr.net`. jsDelivr serves any npm package or GitHub file, so anything injected into the page could load arbitrary script from it. | It now allows only `https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/`. That's a single constant (`@elemnt/core/cdn`), which the runtime also uses to load Mermaid, so the two can't drift apart. Checked in a browser: a diagram renders, it loads 23 files, all of them from that folder, and there are no CSP errors. |
| SVG responses (README badge) | They were served with no CSP. An SVG opened directly is a document that can run script. | SVGs now get `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'` plus `nosniff`. |
| Cookie-authenticated writes | Session cookies are `SameSite=Lax`. A sibling subdomain counts as the same site, so it could send a POST that carries the cookie. The OAuth consent POST (`/oauth/authorize`) is the risky one, because MCP client registration is open. | Any non-GET request that carries the session cookie and no `Authorization` header must have no `Origin`, or an `Origin` equal to the app's own origin. Otherwise it gets a 403. Bearer-token requests are unaffected, because browsers never attach them on their own. |
| HTTPS | There was no HSTS. | `Strict-Transport-Security: max-age=31536000` is sent when `ELEMNT_PUBLIC_URL` is https. |
| Sandbox host split | The sandbox origin serves none of the app's routes (they all 404), and the app origin doesn't serve `/w/*` widget frames. Config rejects a sandbox URL whose origin equals the public one. | None. |
| Widget runner | `default-src 'none'`, nonce scripts, `connect-src 'none'` unless the author's host is verified, iframes with `sandbox="allow-scripts"` (no same-origin), credentialless, no referrer. The host's message handler checks `e.source`, allows only http(s) for "open", and clamps resize to 40–2000 px. | None. |

## Still worth an outside review

- **The widget sandbox.** This means the iframe attributes, the runner CSP, the `postMessage` protocol, and how verified `connect-src` hosts are granted. It's the layer that runs code written by authors, and the most likely place a mistake would matter.
- **OAuth for MCP.** Dynamic client registration, redirect URI matching, PKCE, the consent screen, and token lifetimes.
- **Self-host deployments.** Our checks assume the sandbox runs on a separate *site* (registrable domain), not just a separate subdomain. The docs recommend this, but config can only check that the origins differ.
- **Rate limits and resource use.** The explain jobs, Claude-backed endpoints, and the GitHub proxy cache, under abuse.
