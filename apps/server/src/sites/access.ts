import type { Db } from "../db/index.js";
import type { SecretBox } from "../lib/crypto.js";
import * as sitesSvc from "../services/sites.js";
import { viewerForUser } from "../services/workspace.js";

/**
 * Sign-in for members-only websites. A site lives on its own origin, which
 * never sees the app's session cookie (host-only, `__Host-`). So the site
 * sends the visitor to the app, the app checks who they are and whether they
 * may open the site, and hands back a one-minute code bound to that site. The
 * site trades the code for its own host-only cookie. Every request re-checks
 * access (cached for a minute), so removing someone from the space locks them
 * out within a minute.
 */

const CODE_TTL = 60_000;
const SESSION_TTL = 12 * 60 * 60_000;
const ACCESS_TTL = 60_000;

interface Token {
  t: "site-code" | "site-session";
  s: string;
  u: string;
  e: number;
}

function seal(box: SecretBox, t: Token["t"], siteId: string, userId: string, ttl: number) {
  return box.seal(JSON.stringify({ t, s: siteId, u: userId, e: Date.now() + ttl } satisfies Token));
}

function open(box: SecretBox, value: string | undefined, t: Token["t"], siteId: string): Token | undefined {
  if (!value) return undefined;
  try {
    const tok = JSON.parse(box.open(value)) as Token;
    return tok.t === t && tok.s === siteId && typeof tok.u === "string" && tok.e > Date.now() ? tok : undefined;
  } catch {
    return undefined;
  }
}

export function safeReturn(path: string | null | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}

export interface SiteAccessDeps extends sitesSvc.SitesDeps {
  box: SecretBox;
  workspaceId(): Promise<string | undefined>;
}

export function siteAccess(deps: SiteAccessDeps) {
  const secure = deps.publicUrl.startsWith("https://");
  const COOKIE = secure ? "__Host-elemnt_site" : "elemnt_site";
  const decided = new Map<string, { at: number; ok: boolean }>();

  async function allowed(db: Db, userId: string, site: sitesSvc.Site): Promise<boolean> {
    const key = `${site.id}|${site.spaceId ?? ""}|${userId}`;
    const hit = decided.get(key);
    if (hit && Date.now() - hit.at < ACCESS_TTL) return hit.ok;
    const ws = await deps.workspaceId();
    const viewer = ws ? await viewerForUser(db, ws, userId) : undefined;
    const ok = await sitesSvc.canOpenSite(db, viewer, site);
    if (decided.size > 2000) decided.clear();
    decided.set(key, { at: Date.now(), ok });
    return ok;
  }

  function page(status: number, title: string, body: string, extra: Record<string, string> = {}) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><body style="font:16px/1.6 system-ui;max-width:560px;margin:80px auto;padding:0 16px;text-align:center"><h1 style="font-size:1.5rem">${title}</h1>${body}</body>`,
      { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", ...extra } },
    );
  }

  function cookieOf(req: Request): string | undefined {
    const raw = req.headers.get("cookie") ?? "";
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === COOKIE) return decodeURIComponent(v.join("="));
    }
    return undefined;
  }

  const setCookie = (value: string, maxAge: number) =>
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

  return {
    /**
     * On the site's origin: undefined when the request may go on to the site,
     * otherwise the response to send (a redirect to sign in, or a refusal).
     */
    async gate(req: Request, match: sitesSvc.HostMatch): Promise<Response | undefined> {
      const site = match.site;
      if (site.visibility !== "members") return undefined;
      const url = new URL(req.url);

      if (url.pathname === "/_elemnt/auth") {
        const code = open(deps.box, url.searchParams.get("code") ?? undefined, "site-code", site.id);
        if (!code) return page(400, "That sign-in link has expired", `<p><a href="/">Try again</a></p>`);
        return new Response(null, {
          status: 302,
          headers: { Location: safeReturn(url.searchParams.get("return")), "Set-Cookie": setCookie(seal(deps.box, "site-session", site.id, code.u, SESSION_TTL), SESSION_TTL / 1000), "Cache-Control": "no-store" },
        });
      }
      if (url.pathname === "/_elemnt/signout") {
        return new Response(null, { status: 302, headers: { Location: `${deps.publicUrl}/app/`, "Set-Cookie": setCookie("", 0), "Cache-Control": "no-store" } });
      }

      const session = open(deps.box, cookieOf(req), "site-session", site.id);
      if (session && (await allowed(deps.db, session.u, site))) return undefined;
      if (session) {
        return page(403, "You don't have access to this site", `<p>It's private to the people in its Elemnt space. Ask an owner to add you to the space, then reload.</p><p><a href="/_elemnt/signout">Sign out</a></p>`);
      }
      const enter = new URL(`${deps.publicUrl}/sites/enter`);
      enter.searchParams.set("site", site.slug);
      if (match.preview) enter.searchParams.set("preview", match.preview);
      enter.searchParams.set("return", `${url.pathname}${url.search}`);
      if (req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html")) {
        return new Response(null, { status: 302, headers: { Location: enter.toString(), "Cache-Control": "no-store" } });
      }
      return page(401, "Sign in to view this site", `<p><a href="${enter.toString().replace(/&/g, "&amp;")}">Sign in with Elemnt</a></p>`);
    },

    /** Responses from a members-only site must never be cached by a shared cache or indexed. */
    seal(res: Response, match: sitesSvc.HostMatch): Response {
      if (match.site.visibility !== "members") return res;
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", "private, no-store");
      out.headers.set("X-Robots-Tag", "noindex, nofollow");
      return out;
    },

    /** On the app's origin, for a signed-in viewer allowed in: where to send them on the site. */
    handoff(site: sitesSvc.Site, userId: string, ret: string, preview?: string): string | undefined {
      const origin = sitesSvc.siteUrl(deps, site, preview);
      if (!origin) return undefined;
      const to = new URL("/_elemnt/auth", origin);
      to.searchParams.set("code", seal(deps.box, "site-code", site.id, userId, CODE_TTL));
      to.searchParams.set("return", safeReturn(ret));
      return to.toString();
    },
  };
}
