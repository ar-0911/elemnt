import { createElemnt } from "@elemnt/core";
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createApp, type AppDeps } from "./app.js";
import { sites, workspaces } from "./db/schema.js";
import { contentSecurityPolicy } from "./render/page.js";
import { adminPage, dashboardPage, hostedLoginPage, hostedSignupPage, landingPage, noWorkspacePage } from "./render/hosted.js";
import { sandboxApp } from "./sandbox.js";
import * as accounts from "./services/accounts.js";
import { HttpError } from "./services/errors.js";
import * as hosted from "./services/hosted.js";
import { siteOrigins } from "./services/sites.js";
import { viewerForToken, type Viewer } from "./services/workspace.js";
import { sql } from "drizzle-orm";

/**
 * Hosted mode (ELEMNT_HOSTED_DOMAIN): one server, many workspaces.
 *
 *   <domain>             accounts: sign up and pick an address, your workspaces, /admin
 *   <slug>.<domain>      that workspace's own Elemnt (editor, reader, API, /mcp)
 *   the sandbox host     widgets and runnable code, shared by every workspace
 *   any other name       a workspace's website on its own custom domain
 *
 * Each workspace gets its own app (createApp) with its own public URL, so
 * cookies, OAuth for Claude and every link stay on that workspace's host.
 */

/** Workspace apps kept in memory; the least recently used is dropped past this. */
const MAX_APPS = 200;
const LOOKUP_MS = 10_000;

type Env = { Variables: { nonce: string; viewer: Viewer | undefined } };

export function createHostedServer(deps: AppDeps) {
  const cfg = deps.config;
  if (!cfg.hosted) throw new Error("createHostedServer needs ELEMNT_HOSTED_DOMAIN.");
  const h = cfg.hosted;
  const db = deps.db;
  const elemnt = deps.elemnt ?? createElemnt();
  const pageDeps = { db, blobs: deps.blobs, elemnt };
  const home = cfg.publicUrl;
  const apexHost = new URL(home).host;
  const sandboxHost = cfg.sandboxUrl ? new URL(cfg.sandboxUrl).host : undefined;
  const secure = home.startsWith("https://");
  const COOKIE = secure ? "__Host-elemnt_token" : "elemnt_token";
  const urlFor = (slug: string) => hosted.workspaceUrl(home, h.domain, slug);

  // ---------- workspace apps ----------

  const apps = new Map<string, ReturnType<typeof createApp>>();
  function appFor(slug: string) {
    let a = apps.get(slug);
    if (a) {
      apps.delete(slug);
      apps.set(slug, a);
      return a;
    }
    const { anthropicApiKey: _serverKey, sitesDomain: _sites, setupCode: _setup, ...rest } = cfg;
    a = createApp({
      ...deps,
      elemnt,
      // Every workspace brings its own Claude key, and has websites only on custom domains.
      config: { ...rest, publicUrl: urlFor(slug), workspaceSlug: slug, signupOpen: false, hosted: { ...h } },
    });
    apps.set(slug, a);
    if (apps.size > MAX_APPS) apps.delete(apps.keys().next().value!);
    return a;
  }

  const lookups = new Map<string, { at: number; value: unknown }>();
  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = lookups.get(key);
    if (hit && Date.now() - hit.at < LOOKUP_MS) return hit.value as T;
    const value = await load();
    if (lookups.size > 5000) lookups.clear();
    lookups.set(key, { at: Date.now(), value });
    return value;
  }
  const forget = (slug: string) => lookups.delete(`ws:${slug}`);
  const workspaceState = (slug: string) => cached(`ws:${slug}`, () => hosted.liveWorkspace(db, slug));
  /** The workspace whose published site has this custom hostname. */
  const siteOwner = (host: string) =>
    cached(`site:${host}`, async () => {
      const [row] = await db
        .select({ slug: workspaces.slug })
        .from(sites)
        .innerJoin(workspaces, eq(workspaces.id, sites.workspaceId))
        .where(and(eq(sites.hostname, host), isNotNull(sites.publishedTree)));
      return row?.slug;
    });

  const sandbox = cfg.sandboxUrl
    ? sandboxApp({
        db,
        blobs: deps.blobs,
        publicUrl: home,
        frameAncestors: async () => [`${new URL(home).protocol}//*.${h.domain}${new URL(home).port ? `:${new URL(home).port}` : ""}`, ...(await siteOrigins({ db, blobs: deps.blobs, elemnt, publicUrl: home }))],
      })
    : undefined;

  // ---------- the main address ----------

  const apex = new Hono<Env>();
  const html = (c: Context<Env>, body: string, status: 200 | 400 | 401 | 403 | 404 | 409 | 422 | 429 = 200) => {
    c.header("Content-Security-Policy", contentSecurityPolicy(c.get("nonce")));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "DENY");
    if (secure) c.header("Strict-Transport-Security", "max-age=31536000");
    return c.html(body, status);
  };
  const tries = new Map<string, number[]>();
  function limit(who: string, perHour: number, message: string) {
    const now = Date.now();
    const recent = (tries.get(who) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= perHour) throw new HttpError(429, message);
    tries.set(who, [...recent, now]);
    if (tries.size > 10_000) tries.clear();
  }
  const ip = (c: Context<Env>) => c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  const isOperator = (v: Viewer | undefined) => Boolean(v && h.operators.includes(v.email.toLowerCase()));
  const signIn = (c: Context<Env>, token: string) => setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * accounts.SESSION_DAYS });
  const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/");
  const fields = async (c: Context<Env>) => Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const zodErrors = (e: z.ZodError) => Object.fromEntries(e.issues.map((i) => [i.path[0] === "name" ? "wsname" : String(i.path[0]), i.message]));

  apex.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...err.details }, err.status);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request.", issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: "Something went wrong on our side." }, 500);
  });

  apex.use(async (c, next) => {
    c.set("nonce", randomBytes(16).toString("base64"));
    const token = getCookie(c, COOKIE);
    // Form posts riding on the session cookie must come from this address.
    if (!["GET", "HEAD"].includes(c.req.method) && token) {
      const origin = c.req.header("origin");
      if (origin && origin !== new URL(home).origin) throw new HttpError(403, "This request came from another site, so it was refused.");
    }
    c.set("viewer", token ? await viewerForToken(db, "", token) : undefined);
    await next();
  });

  apex.get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.text("ok");
    } catch {
      return c.text("database unreachable", 503);
    }
  });

  /** For Caddy's on-demand TLS: only names this server answers. */
  apex.get("/internal/tls-allow", async (c) => {
    const host = (c.req.query("domain") ?? "").toLowerCase();
    if (!host) return c.text("domain required", 400);
    if (host === new URL(home).hostname || (sandboxHost && host === new URL(cfg.sandboxUrl!).hostname)) return c.text("ok");
    const slug = hosted.slugForHost(host, h.domain);
    if (slug) return (await workspaceState(slug)) ? c.text("ok") : c.text("unknown host", 404);
    return (await siteOwner(host)) ? c.text("ok") : c.text("unknown host", 404);
  });

  apex.get("/api/check-address", async (c) => {
    limit(`check|${ip(c)}`, 600, "Slow down a little.");
    const result = await hosted.checkSlug(db, c.req.query("slug") ?? "");
    return c.json(result.ok ? { ok: true, address: new URL(urlFor(result.slug)).host } : result);
  });

  async function dashboard(c: Context<Env>, viewer: Viewer, extra: { values?: Record<string, string>; errors?: Record<string, string>; error?: string; notice?: string } = {}, status: 200 | 409 | 422 = 200) {
    const mine = await hosted.mine(db, viewer.userId);
    const states = await Promise.all(mine.workspaces.map((w) => hosted.liveWorkspace(db, w.slug)));
    const owned = mine.workspaces.filter((w) => w.role === "owner").length;
    const waiting = mine.requests.some((r) => r.status === "pending");
    return html(
      c,
      dashboardPage(c.get("nonce"), {
        who: viewer.email,
        domain: h.domain,
        approval: h.approval,
        operator: isOperator(viewer),
        canCreate: owned < hosted.MAX_OWNED && !(h.approval && waiting),
        maxOwned: hosted.MAX_OWNED,
        workspaces: mine.workspaces.map((w, i) => ({ ...w, url: urlFor(w.slug), suspended: Boolean(states[i]?.suspended) })),
        requests: mine.requests,
        ...extra,
      }),
      status,
    );
  }

  apex.get("/", async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) return html(c, landingPage(c.get("nonce"), { domain: h.domain, approval: h.approval }));
    return dashboard(c, viewer, c.req.query("asked") ? { notice: "Thanks. Your request is waiting for approval; your workspace opens here as soon as it's approved." } : {});
  });

  /** Makes (or, in approval mode, asks for) a workspace for this person. Returns where to go next. */
  async function newWorkspace(userId: string, f: Record<string, string>) {
    const input = { slug: f.slug ?? "", name: f.wsname ?? "", ...(h.approval ? { purpose: f.purpose ?? "" } : {}) };
    if (h.approval) {
      await hosted.requestWorkspace(db, userId, input);
      return "/?asked=1";
    }
    const ws = await hosted.createWorkspaceNow(pageDeps, userId, input);
    forget(ws.slug);
    return `/go/${encodeURIComponent(ws.slug)}?welcome=1`;
  }

  apex.get("/signup", async (c) => {
    if (c.get("viewer")) return c.redirect("/");
    const slug = c.req.query("slug");
    return html(c, hostedSignupPage(c.get("nonce"), { domain: h.domain, approval: h.approval, ...(slug ? { values: { slug } } : {}) }));
  });

  apex.post("/signup", async (c) => {
    const f = await fields(c);
    const values = { name: f.name ?? "", username: f.username ?? "", email: f.email ?? "", wsname: f.wsname ?? "", slug: f.slug ?? "", purpose: f.purpose ?? "" };
    const again = (status: 403 | 409 | 422 | 429, extra: { errors?: Record<string, string>; error?: string }) => html(c, hostedSignupPage(c.get("nonce"), { domain: h.domain, approval: h.approval, values, ...extra }), status);
    try {
      limit(`signup|${ip(c)}`, 10, "Too many sign-ups from here. Try again later.");
    } catch (e) {
      return again(429, { error: (e as Error).message });
    }
    // Check the workspace part first, so a bad address doesn't leave a half-made account.
    const wsCheck = (h.approval ? hosted.requestSchema : hosted.workspaceSchema).safeParse({ slug: values.slug, name: values.wsname, purpose: values.purpose });
    const account = accounts.signupSchemaForHosted.safeParse({ name: values.name, username: values.username, email: values.email, password: f.password ?? "" });
    if (!wsCheck.success || !account.success) {
      return again(422, { errors: { ...(account.success ? {} : zodErrors(account.error)), ...(wsCheck.success ? {} : zodErrors(wsCheck.error)) } });
    }
    const free = await hosted.checkSlug(db, values.slug);
    if (!free.ok) return again(409, { errors: { slug: free.reason } });
    let made: Awaited<ReturnType<typeof accounts.createAccount>>;
    try {
      made = await accounts.createAccount(db, account.data);
    } catch (e) {
      if (e instanceof HttpError) {
        const field = (e.details as { field?: string } | undefined)?.field;
        return again(409, field ? { errors: { [field]: e.message } } : { error: e.message });
      }
      throw e;
    }
    signIn(c, made.token);
    try {
      return c.redirect(await newWorkspace(made.user.id, f));
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      // The account exists now; let them pick another address from their dashboard.
      return dashboard(c, { userId: made.user.id, email: made.user.email, role: undefined }, { values, error: e.message }, 409);
    }
  });

  apex.post("/workspaces", async (c) => {
    const viewer = c.get("viewer");
    if (!viewer) return c.redirect("/login");
    const f = await fields(c);
    const values = { wsname: f.wsname ?? "", slug: f.slug ?? "", purpose: f.purpose ?? "" };
    try {
      limit(`create|${viewer.userId}`, 10, "You've made a lot of workspaces. Try again later.");
      return c.redirect(await newWorkspace(viewer.userId, f));
    } catch (e) {
      if (e instanceof z.ZodError) return dashboard(c, viewer, { values, errors: zodErrors(e) }, 422);
      if (e instanceof HttpError) {
        const field = (e.details as { field?: string } | undefined)?.field;
        return dashboard(c, viewer, { values, ...(field ? { errors: { [field]: e.message } } : { error: e.message }) }, 409);
      }
      throw e;
    }
  });

  apex.get("/login", (c) => (c.get("viewer") ? c.redirect(safeNext(c.req.query("next"))) : html(c, hostedLoginPage(c.get("nonce"), { next: safeNext(c.req.query("next")) }))));

  apex.post("/login", async (c) => {
    const f = await fields(c);
    const next = safeNext(f.next);
    const identifier = (f.identifier ?? "").slice(0, 200);
    try {
      limit(`login|${ip(c)}|${identifier.toLowerCase()}`, 20, "Too many sign-in attempts. Wait a few minutes and try again.");
      const { token } = await accounts.login(db, identifier, f.password ?? "");
      signIn(c, token);
      return c.redirect(next);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return html(c, hostedLoginPage(c.get("nonce"), { next, identifier, error: e.message }), e.status === 429 ? 429 : 401);
    }
  });

  apex.post("/logout", async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await accounts.endSession(db, token);
    deleteCookie(c, COOKIE, { path: "/", secure });
    return c.redirect("/");
  });

  /** Into one of your workspaces, signed in, without typing your password again. */
  apex.get("/go/:slug", async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    const viewer = c.get("viewer");
    if (!viewer) return c.redirect(`/login?next=${encodeURIComponent(`/go/${slug}`)}`);
    const mine = await hosted.mine(db, viewer.userId);
    if (!mine.workspaces.some((w) => w.slug === slug)) return c.redirect("/");
    c.header("Cache-Control", "no-store");
    const code = hosted.handoffCode(cfg.secretKey, viewer.userId, slug);
    return c.redirect(`${urlFor(slug)}/hosted/enter?code=${encodeURIComponent(code)}${c.req.query("welcome") ? "&welcome=1" : ""}`);
  });

  // ---------- operators ----------

  function operator(c: Context<Env>) {
    const viewer = c.get("viewer");
    if (!isOperator(viewer)) throw new HttpError(404, "Not found.");
    return viewer!;
  }
  async function admin(c: Context<Env>, extra: { notice?: string; error?: string } = {}) {
    const [pending, all] = await Promise.all([hosted.pendingRequests(db), hosted.allWorkspaces(db)]);
    return html(c, adminPage(c.get("nonce"), { domain: h.domain, pending, workspaces: all, ...extra }));
  }
  apex.get("/admin", async (c) => {
    operator(c);
    return admin(c);
  });
  apex.post("/admin/requests/:id", async (c) => {
    const viewer = operator(c);
    const f = await fields(c);
    try {
      if (f.decision === "approve") {
        const ws = await hosted.approve(pageDeps, c.req.param("id"), viewer.userId);
        forget(ws.slug);
        return admin(c, { notice: `Approved. ${ws.slug}.${h.domain} is live.` });
      }
      await hosted.decline(db, c.req.param("id"), viewer.userId, f.note);
      return admin(c, { notice: "Declined." });
    } catch (e) {
      if (e instanceof HttpError) return admin(c, { error: e.message });
      throw e;
    }
  });
  apex.post("/admin/workspaces/:slug", async (c) => {
    operator(c);
    const slug = c.req.param("slug");
    const f = await fields(c);
    await hosted.setSuspended(db, slug, f.action === "suspend");
    forget(slug);
    apps.delete(slug);
    return admin(c, { notice: f.action === "suspend" ? `${slug} is suspended.` : `${slug} is back on.` });
  });

  // ---------- routing by hostname ----------

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const host = url.host.toLowerCase();
    if (host === apexHost) return apex.fetch(req);
    if (sandbox && host === sandboxHost) return sandbox.fetch(req);
    const slug = hosted.slugForHost(url.hostname, h.domain);
    if (slug) {
      const ws = await workspaceState(slug);
      if (!ws || ws.suspended) return new Response(noWorkspacePage({ host: url.hostname, home, suspended: Boolean(ws?.suspended) }), { status: ws ? 403 : 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
      return appFor(slug).fetch(req);
    }
    // A reverse proxy asking about certificates, or a health check, by internal name.
    if (url.pathname === "/internal/tls-allow" || url.pathname === "/healthz") return apex.fetch(req);
    const owner = await siteOwner(url.hostname.toLowerCase());
    if (owner) {
      const ws = await workspaceState(owner);
      if (ws && !ws.suspended) return appFor(owner).fetch(req);
    }
    return new Response(noWorkspacePage({ host: url.hostname, home, suspended: false }).replace("Make it yours", "Get your own"), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return { fetch, apex };
}
