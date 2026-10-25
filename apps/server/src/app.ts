import { createElemnt, type Elemnt } from "@elemnt/core";
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Db } from "./db/index.js";
import { visibilities, type spaces } from "./db/schema.js";
import type { BlobStore } from "./lib/blobs.js";
import type { Config } from "./lib/config.js";
import { SecretBox, safeEqual } from "./lib/crypto.js";
import { contentSecurityPolicy, escapeHtml, renderShell, renderSimple } from "./render/page.js";
import { HttpError } from "./services/errors.js";
import * as linkedin from "./services/linkedin.js";
import * as pagesSvc from "./services/pages.js";
import * as commentsSvc from "./services/comments.js";
import { searchPages } from "./services/search.js";
import { anthropicProvider, assistPrompt, EDIT_SCHEMA, editorSystemPrompt, type AiProvider } from "./services/ai.js";
import * as oauth from "./services/oauth.js";
import * as suggestionsSvc from "./services/suggestions.js";
import { handleMcp } from "./mcp.js";
import { sandboxApp } from "./sandbox.js";
import { editorApp } from "./web.js";
import { querySourceService } from "./services/query.js";
import * as widgetsSvc from "./services/widgets.js";
import { widgetHash, sha256Hex } from "@elemnt/core";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { workspaces } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { pageStats, recordView } from "./services/views.js";
import { getWorkspace, hasRole, viewerForToken, type Viewer } from "./services/workspace.js";

export interface AppDeps {
  db: Db;
  blobs: BlobStore;
  config: Config;
  elemnt?: Elemnt;
  /** Injected so tests can stand in for LinkedIn. */
  fetch?: typeof fetch;
  /** Injected so tests can stand in for Claude. */
  ai?: AiProvider;
  /** The built editor (apps/web/dist), served at /app. */
  webDir?: string;
}

/** Reports one IP or user may file per hour, so the report button can't be used to flood admins. */
const REPORTS_PER_HOUR = 10;

type Env = { Variables: { viewer: Viewer | undefined; workspaceId: string; nonce: string } };
type Space = typeof spaces.$inferSelect;

const TOKEN_COOKIE = "elemnt_token";
const LI_STATE_COOKIE = "elemnt_li_state";

export function createApp(deps: AppDeps) {
  const elemnt = deps.elemnt ?? createElemnt();
  const box = new SecretBox(deps.config.secretKey);
  const doFetch = deps.fetch ?? fetch;
  const pageDeps = { db: deps.db, blobs: deps.blobs, elemnt };
  const secure = deps.config.publicUrl.startsWith("https://");
  let workspaceId: string | undefined;

  const app = new Hono<Env>();
  const sandboxUrl = deps.config.sandboxUrl;
  const queries = querySourceService(deps.db, box, doFetch);
  const reportLog = new Map<string, number[]>();

  // The sandbox origin is the same server under another hostname. It answers
  // only /w/*: nothing else, cookies included, is reachable from there.
  if (sandboxUrl) {
    const sandbox = sandboxApp({ db: deps.db, blobs: deps.blobs, publicUrl: deps.config.publicUrl });
    const host = new URL(sandboxUrl).host;
    app.use(async (c, next) => (new URL(c.req.url).host === host ? sandbox.fetch(c.req.raw) : next()));
  }
  if (deps.webDir) app.route("/app", editorApp(deps.webDir, sandboxUrl));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...err.details }, err.status);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request.", issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: "Something went wrong on our side." }, 500);
  });

  app.use(async (c, next) => {
    workspaceId ??= (await getWorkspace(deps.db, deps.config.workspaceSlug)).id;
    c.set("workspaceId", workspaceId);
    c.set("nonce", randomBytes(16).toString("base64"));
    const bearer = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const token = bearer ?? getCookie(c, TOKEN_COOKIE);
    c.set("viewer", token ? await viewerForToken(deps.db, workspaceId, token) : undefined);
    await next();
  });

  // ---------- helpers ----------

  const pageUrl = (space: Space, path: string) => `${deps.config.publicUrl}/s/${space.slug}/${path}`;

  function canRead(viewer: Viewer | undefined, space: Space) {
    // Per-space membership for "private" arrives with sharing in M3; until then members see both.
    return space.visibility === "public" || Boolean(viewer?.role);
  }

  function requireRole(c: Context<Env>, role: "viewer" | "editor" | "admin") {
    const viewer = c.get("viewer");
    if (!viewer) throw new HttpError(401, "Sign in or send an API token.");
    if (!hasRole(viewer, role)) throw new HttpError(403, `You need the ${role} role for this.`);
    return viewer;
  }

  async function readableSpace(c: Context<Env>, slug: string) {
    const space = await pagesSvc.findSpace(deps.db, c.get("workspaceId"), slug);
    if (!space || !canRead(c.get("viewer"), space)) throw new HttpError(404, "Not found.");
    return space;
  }

  async function writableSpace(c: Context<Env>, slug: string) {
    const viewer = requireRole(c, "editor");
    const space = await pagesSvc.findSpace(deps.db, c.get("workspaceId"), slug);
    if (!space) throw new HttpError(404, `Space "${slug}" not found.`);
    return { viewer, space };
  }

  function wantsMarkdown(c: Context<Env>) {
    const accept = c.req.header("accept") ?? "";
    return /text\/markdown/.test(accept) && !/text\/html/.test(accept);
  }

  function html(c: Context<Env>, body: string, status: 200 | 404 = 200) {
    c.header("Content-Security-Policy", contentSecurityPolicy(c.get("nonce"), sandboxUrl));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    return c.html(body, status);
  }

  function markdown(c: Context<Env>, body: string) {
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(body);
  }

  // ---------- sign-in ----------

  app.get("/login", (c) =>
    html(
      c,
      renderSimple(
        c.get("nonce"),
        "Sign in · Elemnt",
        `<h1>Sign in</h1><p>Paste an API token. Run <code>pnpm --filter @elemnt/server bootstrap</code> to create your first one.</p>
<form method="post" action="/login"><input type="hidden" name="next" value="${escapeHtml(c.req.query("next") ?? "/")}"><p><label for="token">API token</label><br><input id="token" name="token" type="password" required size="48" autocomplete="off"></p><p><button class="btn" type="submit">Sign in</button></p></form>`,
      ),
    ),
  );

  app.post("/login", async (c) => {
    const form = await c.req.parseBody();
    const token = String(form.token ?? "");
    const viewer = token ? await viewerForToken(deps.db, c.get("workspaceId"), token) : undefined;
    if (!viewer?.role) return html(c, renderSimple(c.get("nonce"), "Sign in · Elemnt", `<h1>Sign in</h1><p>That token isn't valid for this workspace. <a href="/login">Try again</a>.</p>`));
    setCookie(c, TOKEN_COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    const next = String(form.next ?? "/");
    return c.redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  });

  app.post("/logout", (c) => {
    deleteCookie(c, TOKEN_COOKIE, { path: "/" });
    return c.redirect("/");
  });

  // ---------- API ----------

  app.get("/api/me", async (c) => {
    const viewer = requireRole(c, "viewer");
    const account = await linkedin.getAccount(deps.db, viewer.userId);
    return c.json({ ...viewer, sandboxUrl: sandboxUrl ?? null, linkedin: account ? { connected: true, name: account.name, expiresAt: account.expiresAt } : { connected: false } });
  });

  app.post("/api/preview", async (c) => {
    requireRole(c, "viewer");
    const { source } = z.object({ source: z.string().max(500_000) }).parse(await c.req.json());
    return c.json(elemnt.compile(source));
  });

  // ---------- widgets (spec §7) ----------

  /**
   * The editor preview registers widgets as the author types so the sandbox
   * can serve them. The server recomputes each hash and scans the code; code
   * with error findings is stored but never served.
   */
  app.post("/api/widgets/preview", async (c) => {
    const viewer = requireRole(c, "editor");
    const code = z.object({ html: z.string().max(200_000), css: z.string().max(200_000), js: z.string().max(200_000) });
    const { widgets } = z.object({ widgets: z.array(code).max(20) }).parse(await c.req.json());
    const space = await deps.db.query.spaces.findFirst({ where: (s, { eq }) => eq(s.workspaceId, c.get("workspaceId")) });
    if (!space) throw new HttpError(400, "Create a space first.");
    const { verified } = await widgetsSvc.widgetSettings(deps.db, c.get("workspaceId"));
    const out = widgets.map((w) => ({ hash: widgetHash(w), code: w, summary: "Preview", findings: widgetsSvc.scanWidget(w, { networkAllowed: verified }) }));
    await widgetsSvc.storeWidgets(deps.db, deps.blobs, { spaceId: space.id, authorId: viewer.userId, widgets: out, findings: new Map(out.map((w) => [w.hash, w.findings])) });
    return c.json({ widgets: out.map(({ hash, findings }) => ({ hash, findings })) });
  });

  app.post("/api/widgets/:hash/report", async (c) => {
    const viewer = c.get("viewer");
    const who = viewer?.userId ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
    const now = Date.now();
    const recent = (reportLog.get(who) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= REPORTS_PER_HOUR) throw new HttpError(429, "Too many reports. Try again later.");
    reportLog.set(who, [...recent, now]);
    const { reason, page } = z.object({ reason: z.string().trim().min(1).max(500), page: z.string().max(500).optional() }).parse(await c.req.json());
    await widgetsSvc.reportWidget(deps.db, { hash: c.req.param("hash"), reason, ...(page ? { pageUrl: page } : {}), ...(viewer ? { reporterId: viewer.userId } : {}) });
    return c.json({ reported: true });
  });

  app.get("/api/widgets/reports", async (c) => {
    requireRole(c, "admin");
    return c.json({ reports: await widgetsSvc.listReports(deps.db, c.get("workspaceId")) });
  });

  app.post("/api/widgets/:hash/block", async (c) => {
    const viewer = requireRole(c, "admin");
    const { reason } = z.object({ reason: z.string().trim().min(1).max(200) }).parse(await c.req.json());
    await widgetsSvc.blockWidget(deps.db, { hash: c.req.param("hash"), reason, userId: viewer.userId });
    return c.json({ blocked: true });
  });

  app.delete("/api/widgets/:hash/block", async (c) => {
    requireRole(c, "admin");
    await widgetsSvc.unblockWidget(deps.db, c.req.param("hash"));
    return c.body(null, 204);
  });

  app.get("/api/settings/widgets", async (c) => {
    requireRole(c, "admin");
    return c.json({ ...(await widgetsSvc.widgetSettings(deps.db, c.get("workspaceId"))), selfVerify: Boolean(deps.config.widgetSelfVerify), sandboxUrl: sandboxUrl ?? null });
  });

  app.put("/api/settings/widgets", async (c) => {
    requireRole(c, "admin");
    const host = z.string().trim().toLowerCase().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "use a hostname such as api.example.com");
    const body = z.object({ verified: z.boolean().optional(), hosts: z.array(host).max(20).optional() }).parse(await c.req.json());
    if (body.verified !== undefined && !deps.config.widgetSelfVerify) throw new HttpError(403, "Verification is granted by the operator of this Elemnt server.");
    await deps.db
      .update(workspaces)
      .set({ ...(body.verified !== undefined ? { widgetsVerified: body.verified } : {}), ...(body.hosts ? { widgetHosts: [...new Set(body.hosts)] } : {}) })
      .where(eq(workspaces.id, c.get("workspaceId")));
    return c.json(await widgetsSvc.widgetSettings(deps.db, c.get("workspaceId")));
  });

  // ---------- live data for :query ----------

  app.get("/api/query", async (c) => {
    const source = c.req.query("source") ?? "";
    const key = c.req.query("key") ?? "";
    if (!source || !key || key.length > 200) throw new HttpError(400, "Send source and key.");
    c.header("Cache-Control", "private, max-age=30");
    return c.json(await queries.value(c.get("workspaceId"), source, key, Boolean(c.get("viewer")?.role)));
  });

  app.get("/api/settings/query-sources", async (c) => {
    requireRole(c, "admin");
    return c.json({ sources: await queries.list(c.get("workspaceId")) });
  });

  app.put("/api/settings/query-sources/:slug", async (c) => {
    requireRole(c, "admin");
    const body = z
      .object({ url: z.string().url().max(2000), public: z.boolean().default(false), headers: z.record(z.string().max(100), z.string().max(4000)).nullable().optional() })
      .parse(await c.req.json());
    await queries.save(c.get("workspaceId"), { slug: c.req.param("slug"), url: body.url, public: body.public, ...(body.headers !== undefined ? { headers: body.headers } : {}) });
    return c.json({ sources: await queries.list(c.get("workspaceId")) });
  });

  app.delete("/api/settings/query-sources/:slug", async (c) => {
    requireRole(c, "admin");
    await queries.remove(c.get("workspaceId"), c.req.param("slug"));
    return c.body(null, 204);
  });

  // ---------- reader runtime ----------

  let bundle: Promise<{ js: string; map: string | undefined; etag: string } | undefined> | undefined;
  const loadBundle = () =>
    (bundle ??= (async () => {
      try {
        const path = createRequire(import.meta.url).resolve("@elemnt/elements/bundle");
        const js = await readFile(path, "utf8");
        const map = await readFile(`${path}.map`, "utf8").catch(() => undefined);
        return { js, map, etag: `"${sha256Hex(js).slice(0, 16)}"` };
      } catch {
        console.warn("@elemnt/elements isn't built; run pnpm --filter @elemnt/elements build. Pages render without interactivity.");
        return undefined;
      }
    })());

  app.get("/assets/elements.js", async (c) => {
    const b = await loadBundle();
    if (!b) return c.text("// @elemnt/elements is not built\nexport function enhance() {}\n", 200, { "Content-Type": "text/javascript; charset=utf-8" });
    if (c.req.header("if-none-match") === b.etag) return c.body(null, 304);
    return c.body(b.js, 200, { "Content-Type": "text/javascript; charset=utf-8", ETag: b.etag, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
  });

  app.get("/assets/elements.js.map", async (c) => {
    const b = await loadBundle();
    return b?.map ? c.body(b.map, 200, { "Content-Type": "application/json" }) : c.text("Not found.", 404);
  });

  app.get("/api/spaces", async (c) => {
    const viewer = c.get("viewer");
    const all = await deps.db.query.spaces.findMany({ where: (s, { eq }) => eq(s.workspaceId, c.get("workspaceId")) });
    return c.json(all.filter((s) => canRead(viewer, s)));
  });

  app.post("/api/spaces", async (c) => {
    requireRole(c, "admin");
    const input = z.object({ slug: z.string(), name: z.string().min(1).max(120), visibility: z.enum(visibilities).default("workspace") }).parse(await c.req.json());
    return c.json(await pagesSvc.createSpace(deps.db, c.get("workspaceId"), input), 201);
  });

  app.get("/api/spaces/:space/tree", async (c) => {
    const space = await readableSpace(c, c.req.param("space"));
    const all = await pagesSvc.listPages(deps.db, space.id);
    // Unpublished pages are only visible to workspace members.
    return c.json({ space, pages: c.get("viewer")?.role ? all : all.filter((p) => p.published) });
  });

  const saveBody = z.object({ source: z.string().max(500_000), message: z.string().max(500).optional() });

  app.post("/api/spaces/:space/pages", async (c) => {
    const { viewer, space } = await writableSpace(c, c.req.param("space"));
    const input = saveBody.extend({ path: z.string(), draft: z.boolean().optional() }).parse(await c.req.json());
    const result = await pagesSvc.createPage(pageDeps, { spaceId: space.id, authorId: viewer.userId, ...input });
    return c.json({ ...result, url: pageUrl(space, pagesSvc.normalizePath(input.path)) }, 201);
  });

  async function pageWithAccess(c: Context<Env>, role: "viewer" | "editor", pageId = c.req.param("id")!) {
    const viewer = requireRole(c, role);
    const page = await pagesSvc.getPage(deps.db, pageId);
    const space = await deps.db.query.spaces.findFirst({ where: (s, { eq }) => eq(s.id, page.spaceId) });
    if (!space || space.workspaceId !== c.get("workspaceId")) throw new HttpError(404, "Page not found.");
    return { viewer, page, space };
  }

  /** What the editor opens: the head (draft if any) source plus lock state. */
  app.get("/api/pages/:id", async (c) => {
    const { page, space } = await pageWithAccess(c, "viewer");
    const head = pagesSvc.headRevisionId(page);
    const source = head ? await pagesSvc.readRevision(deps, head, "source") : "";
    const lockActive = Boolean(page.lockedBy && page.lockedUntil && page.lockedUntil.getTime() > Date.now());
    const { searchText: _omit, ...rest } = page;
    return c.json({
      page: { ...rest, lockedBy: lockActive ? page.lockedBy : null, lockedUntil: lockActive ? page.lockedUntil : null },
      space: { slug: space.slug, name: space.name, visibility: space.visibility },
      headRevisionId: head,
      url: pageUrl(space, page.path),
      source,
    });
  });

  app.put("/api/pages/:id", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "editor");
    const input = saveBody.extend({ baseRevisionId: z.string(), publish: z.boolean().optional() }).parse(await c.req.json());
    return c.json(await pagesSvc.updatePage(pageDeps, { pageId: page.id, authorId: viewer.userId, ...input }));
  });

  app.post("/api/pages/:id/publish", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "editor");
    return c.json(await pagesSvc.publishDraft(pageDeps, { pageId: page.id, userId: viewer.userId }));
  });

  app.delete("/api/pages/:id/draft", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "editor");
    await pagesSvc.discardDraft(deps.db, { pageId: page.id, userId: viewer.userId });
    return c.body(null, 204);
  });

  app.post("/api/pages/:id/restore", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "editor");
    const { revisionId } = z.object({ revisionId: z.string() }).parse(await c.req.json());
    return c.json(await pagesSvc.restoreRevision(pageDeps, { pageId: page.id, revisionId, userId: viewer.userId }));
  });

  app.get("/api/pages/:id/diff", async (c) => {
    const { page } = await pageWithAccess(c, "viewer");
    const { from, to } = z.object({ from: z.string(), to: z.string() }).parse(c.req.query());
    return c.json(await pagesSvc.diffRevisions(deps, { pageId: page.id, from, to }));
  });

  app.post("/api/pages/:id/lock", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "editor");
    return c.json(await pagesSvc.acquireLock(deps.db, { pageId: page.id, userId: viewer.userId }));
  });

  app.delete("/api/pages/:id/lock", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "editor");
    await pagesSvc.releaseLock(deps.db, { pageId: page.id, userId: viewer.userId });
    return c.body(null, 204);
  });

  // ---------- comments ----------

  app.get("/api/pages/:id/comments", async (c) => {
    const { page } = await pageWithAccess(c, "viewer");
    return c.json(await commentsSvc.listComments(deps.db, page.id));
  });

  app.post("/api/pages/:id/comments", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "viewer");
    const input = z
      .object({
        body: z.string().min(1).max(10_000),
        parentId: z.string().optional(),
        anchor: z.object({ exact: z.string().min(1).max(1000), prefix: z.string().max(200).optional(), suffix: z.string().max(200).optional() }).optional(),
      })
      .parse(await c.req.json());
    return c.json(await commentsSvc.addComment(deps.db, { pageId: page.id, authorId: viewer.userId, revisionId: page.publishedRevisionId, ...input }), 201);
  });

  app.post("/api/pages/:id/comments/:cid/resolve", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "viewer");
    const { resolved } = z.object({ resolved: z.boolean().default(true) }).parse(await c.req.json().catch(() => ({})));
    return c.json(await commentsSvc.setResolved(deps.db, { pageId: page.id, commentId: c.req.param("cid"), userId: viewer.userId, resolved }));
  });

  app.delete("/api/pages/:id/comments/:cid", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "viewer");
    await commentsSvc.deleteComment(deps.db, { pageId: page.id, commentId: c.req.param("cid"), userId: viewer.userId, isAdmin: hasRole(viewer, "admin") });
    return c.body(null, 204);
  });

  // ---------- search ----------

  app.get("/api/search", async (c) => {
    const { q, space } = z.object({ q: z.string().max(200), space: z.string().optional() }).parse(c.req.query());
    const viewer = c.get("viewer");
    const all = await deps.db.query.spaces.findMany({ where: (s, { eq }) => eq(s.workspaceId, c.get("workspaceId")) });
    const readable = all.filter((s) => canRead(viewer, s) && (!space || s.slug === space));
    return c.json(await searchPages(deps.db, { query: q, spaceIds: readable.map((s) => s.id) }));
  });

  app.get("/api/pages/:id/revisions", async (c) => {
    const { page } = await pageWithAccess(c, "viewer");
    return c.json(await pagesSvc.listRevisions(deps.db, page.id));
  });

  app.get("/api/revisions/:rev/:rendition{source|html|markdown}", async (c) => {
    requireRole(c, "viewer");
    const body = await pagesSvc.readRevision(deps, c.req.param("rev"), c.req.param("rendition") as pagesSvc.Rendition);
    return c.req.param("rendition") === "html" ? c.text(body) : markdown(c, body);
  });

  app.get("/api/pages/:id/stats", async (c) => {
    const { page } = await pageWithAccess(c, "viewer");
    return c.json(await pageStats(deps.db, page.id));
  });

  // ---------- LinkedIn ----------

  const li = deps.config.linkedin;
  const liRedirect = `${deps.config.publicUrl}/integrations/linkedin/callback`;

  app.get("/integrations/linkedin/connect", (c) => {
    if (!li) throw new HttpError(400, "LinkedIn isn't configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.");
    if (!c.get("viewer")) return c.redirect(`/login?next=${encodeURIComponent("/integrations/linkedin/connect")}`);
    requireRole(c, "editor");
    const state = randomBytes(16).toString("base64url");
    setCookie(c, LI_STATE_COOKIE, state, { httpOnly: true, secure, sameSite: "Lax", path: "/integrations/linkedin", maxAge: 600 });
    return c.redirect(linkedin.authorizeUrl(li, liRedirect, state));
  });

  app.get("/integrations/linkedin/callback", async (c) => {
    if (!li) throw new HttpError(400, "LinkedIn isn't configured.");
    const viewer = requireRole(c, "editor");
    const expected = getCookie(c, LI_STATE_COOKIE);
    deleteCookie(c, LI_STATE_COOKIE, { path: "/integrations/linkedin" });
    const { code, state, error_description } = c.req.query();
    if (error_description) throw new HttpError(400, `LinkedIn said: ${error_description}`);
    if (!code || !state || !expected || !safeEqual(state, expected)) throw new HttpError(400, "LinkedIn sign-in expired or was tampered with. Start again.");
    const account = await linkedin.connectAccount({ db: deps.db, box, fetch: doFetch }, li, { userId: viewer.userId, code, redirectUri: liRedirect });
    return html(c, renderSimple(c.get("nonce"), "LinkedIn connected", `<h1>LinkedIn connected</h1><p>Posting as ${escapeHtml(account.name ?? "you")}. You can close this tab and use "Post from Elemnt" on any public page.</p>`));
  });

  app.post("/api/pages/:id/linkedin", async (c) => {
    if (!li) throw new HttpError(400, "LinkedIn isn't configured.");
    const { viewer, page, space } = await pageWithAccess(c, "editor");
    if (space.visibility !== "public") throw new HttpError(400, "Only pages in public spaces can be posted to LinkedIn.");
    const { commentary } = z.object({ commentary: z.string().min(1).max(3000) }).parse(await c.req.json());
    const result = await linkedin.postToLinkedIn({ db: deps.db, box, fetch: doFetch }, li, {
      userId: viewer.userId,
      pageId: page.id,
      pageUrl: pageUrl(space, page.path),
      campaign: `${space.slug}/${page.path}`,
      title: page.title,
      commentary,
      ...(page.summary ? { description: page.summary } : {}),
    });
    return c.json(result, 201);
  });

  // ---------- reader ----------


  // ---------- AI: bring your own Anthropic key ----------

  async function aiKey(workspaceId: string): Promise<{ key: string; source: "workspace" | "server"; hint: string } | undefined> {
    const [ws] = await deps.db.select({ c: workspaces.aiKeyCiphertext, hint: workspaces.aiKeyHint }).from(workspaces).where(eq(workspaces.id, workspaceId));
    if (ws?.c) return { key: box.open(ws.c), source: "workspace", hint: ws.hint ?? "" };
    if (deps.config.anthropicApiKey) return { key: deps.config.anthropicApiKey, source: "server", hint: deps.config.anthropicApiKey.slice(-4) };
    return undefined;
  }

  async function aiClient(c: Context<Env>) {
    const k = await aiKey(c.get("workspaceId"));
    if (!k) throw new HttpError(400, "Claude isn't set up for this workspace yet. An admin can add an Anthropic API key in Settings.");
    return (deps.ai ?? anthropicProvider)(k.key);
  }

  app.get("/api/ai", async (c) => {
    requireRole(c, "editor");
    const k = await aiKey(c.get("workspaceId"));
    return c.json({ configured: Boolean(k), source: k?.source ?? null, hint: k ? `…${k.hint}` : null });
  });

  app.put("/api/ai/key", async (c) => {
    requireRole(c, "admin");
    const { apiKey } = z.object({ apiKey: z.string().trim().min(20).max(300) }).parse(await c.req.json());
    await deps.db.update(workspaces).set({ aiKeyCiphertext: box.seal(apiKey), aiKeyHint: apiKey.slice(-4) }).where(eq(workspaces.id, c.get("workspaceId")));
    return c.json({ configured: true, source: "workspace", hint: `…${apiKey.slice(-4)}` });
  });

  app.delete("/api/ai/key", async (c) => {
    requireRole(c, "admin");
    await deps.db.update(workspaces).set({ aiKeyCiphertext: null, aiKeyHint: null }).where(eq(workspaces.id, c.get("workspaceId")));
    return c.body(null, 204);
  });

  /**
   * ⌘I in the editor. Claude rewrites the selection (or the page) and the result
   * comes back as a suggestion to review, never as a direct edit.
   */
  app.post("/api/pages/:id/assist", async (c) => {
    const { viewer, page } = await pageWithAccess(c, "editor");
    const body = z
      .object({
        instruction: z.string().trim().min(1).max(2000),
        baseRevisionId: z.string(),
        selection: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional(),
      })
      .parse(await c.req.json());
    const head = pagesSvc.headRevisionId(page);
    if (head !== body.baseRevisionId) throw new HttpError(409, "Save your changes before asking Claude, so the suggestion lines up with them.", { currentRevisionId: head });
    const source = await pagesSvc.readRevision(deps, head, "source");
    const sel = body.selection && body.selection.to > body.selection.from && body.selection.to <= source.length ? body.selection : undefined;

    const ai = await aiClient(c);
    const out = await ai.json<{ replacement: string; summary: string }>({
      system: editorSystemPrompt(elemnt.authoringGuide()),
      prompt: assistPrompt({ source, instruction: body.instruction, ...(sel ? { selection: sel } : {}) }),
      schema: EDIT_SCHEMA,
    });
    const proposed = sel ? source.slice(0, sel.from) + out.replacement + source.slice(sel.to) : out.replacement;
    const created = await suggestionsSvc.createSuggestion(pageDeps, { pageId: page.id, baseRevisionId: head, proposed, origin: "assist", authorId: viewer.userId, summary: out.summary });
    return c.json({ ...created, ...(await suggestionsSvc.getSuggestion(pageDeps, created.id)) }, 201);
  });

  // ---------- suggestions ----------

  async function suggestionWithAccess(c: Context<Env>, role: "viewer" | "editor") {
    const s = await deps.db.query.suggestions.findFirst({ where: (t, { eq }) => eq(t.id, c.req.param("sid")!) });
    if (!s) throw new HttpError(404, "Suggestion not found.");
    return { ...(await pageWithAccess(c, role, s.pageId)), suggestion: s };
  }

  app.get("/api/pages/:id/suggestions", async (c) => {
    const { page } = await pageWithAccess(c, "viewer");
    return c.json(await suggestionsSvc.listSuggestions(deps, page.id, c.req.query("status") === "all" ? "all" : "open"));
  });

  app.get("/api/suggestions/:sid", async (c) => {
    const { suggestion } = await suggestionWithAccess(c, "viewer");
    return c.json(await suggestionsSvc.getSuggestion(pageDeps, suggestion.id));
  });

  app.post("/api/suggestions/:sid/accept", async (c) => {
    const { viewer, suggestion } = await suggestionWithAccess(c, "editor");
    const { hunks } = z.object({ hunks: z.array(z.number().int().min(0)).optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await suggestionsSvc.acceptSuggestion(pageDeps, { id: suggestion.id, userId: viewer.userId, ...(hunks ? { hunks } : {}) }));
  });

  app.post("/api/suggestions/:sid/reject", async (c) => {
    const { viewer, suggestion } = await suggestionWithAccess(c, "editor");
    await suggestionsSvc.rejectSuggestion(deps, { id: suggestion.id, userId: viewer.userId });
    return c.body(null, 204);
  });

  // ---------- MCP and its OAuth ----------

  const oauthMeta = oauth.metadata(deps.config.publicUrl);
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(oauthMeta.authorizationServer));
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(oauthMeta.protectedResource));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(oauthMeta.protectedResource));

  function oauthFail(c: Context<Env>, err: unknown) {
    if (err instanceof oauth.OAuthError) return c.json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }

  app.post("/oauth/register", async (c) => {
    try {
      return c.json(await oauth.registerClient(deps.db, await c.req.json()), 201);
    } catch (err) {
      return oauthFail(c, err);
    }
  });

  app.get("/oauth/authorize", async (c) => {
    let checked;
    try {
      checked = await oauth.checkAuthorize(deps.db, c.req.query());
    } catch (err) {
      // Never redirect to an unverified redirect_uri; show the problem instead.
      const msg = err instanceof oauth.OAuthError ? err.message : "Invalid request.";
      return html(c, renderSimple(c.get("nonce"), "Can't connect · Elemnt", `<h1>Can't connect</h1><p>${escapeHtml(msg)}</p>`));
    }
    const viewer = c.get("viewer");
    if (!viewer?.role) return c.redirect(`/login?next=${encodeURIComponent(c.req.url.slice(c.req.url.indexOf("/oauth/")))}`);
    const p = checked.params;
    const hidden = Object.entries({ client_id: p.clientId, redirect_uri: p.redirectUri, code_challenge: p.codeChallenge, code_challenge_method: "S256", response_type: "code", state: p.state ?? "" })
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
      .join("");
    const canWrite = hasRole(viewer, "editor");
    return html(
      c,
      renderSimple(
        c.get("nonce"),
        "Connect · Elemnt",
        `<h1>Connect ${escapeHtml(checked.clientName)} to Elemnt?</h1>
<p>It will act as <strong>${escapeHtml(viewer.email)}</strong> and can search and read this workspace's docs${canWrite ? ", create drafts, suggest edits and comment. Nothing it writes is published until a person reviews it" : " and comment"}.</p>
<p>Access lasts 30 days. It returns to <code>${escapeHtml(new URL(p.redirectUri).origin)}</code>.</p>
<form method="post" action="/oauth/authorize">${hidden}<p><button class="btn" type="submit" name="decision" value="allow">Allow</button> <button class="btn" type="submit" name="decision" value="deny">Cancel</button></p></form>`,
      ),
    );
  });

  app.post("/oauth/authorize", async (c) => {
    const viewer = c.get("viewer");
    if (!viewer?.role) throw new HttpError(401, "Sign in first.");
    const form = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
    let checked;
    try {
      checked = await oauth.checkAuthorize(deps.db, form);
    } catch (err) {
      return oauthFail(c, err);
    }
    const back = new URL(checked.params.redirectUri);
    if (checked.params.state) back.searchParams.set("state", checked.params.state);
    if (form.decision !== "allow") {
      back.searchParams.set("error", "access_denied");
      return c.redirect(back.toString());
    }
    back.searchParams.set("code", await oauth.issueCode(deps.db, checked.params, viewer.userId));
    back.searchParams.set("iss", deps.config.publicUrl);
    return c.redirect(back.toString());
  });

  app.post("/oauth/token", async (c) => {
    const form = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
    try {
      c.header("Cache-Control", "no-store");
      return c.json(await oauth.exchangeCode(deps.db, form));
    } catch (err) {
      return oauthFail(c, err);
    }
  });

  app.all("/mcp", async (c) => {
    const viewer = c.get("viewer");
    if (!viewer?.role) {
      c.header("WWW-Authenticate", `Bearer resource_metadata="${deps.config.publicUrl}/.well-known/oauth-protected-resource"`);
      return c.json({ error: "Connect with OAuth or send an Elemnt API token." }, 401);
    }
    return handleMcp(c.req.raw, { ...pageDeps, config: deps.config }, { viewer, workspaceId: c.get("workspaceId") });
  });

  app.get("/", async (c) => {
    const viewer = c.get("viewer");
    const all = await deps.db.query.spaces.findMany({ where: (s, { eq }) => eq(s.workspaceId, c.get("workspaceId")) });
    const list = all.filter((s) => canRead(viewer, s)).map((s) => `<li><a href="/s/${escapeHtml(s.slug)}">${escapeHtml(s.name)}</a> <small>${s.visibility}</small></li>`);
    const signIn = viewer ? `${viewer.role && viewer.role !== "viewer" ? `<p><a class="btn" href="/app">Open the editor</a></p>` : ""}<form method="post" action="/logout"><button class="btn" type="submit">Sign out ${escapeHtml(viewer.email)}</button></form>` : `<p><a href="/login">Sign in</a></p>`;
    return html(c, renderSimple(c.get("nonce"), "Elemnt", `<h1>Elemnt</h1>${list.length ? `<ul>${list.join("")}</ul>` : "<p>No spaces yet.</p>"}${signIn}`));
  });

  app.get("/s/:space/llms.txt", async (c) => {
    const space = await readableSpace(c, c.req.param("space"));
    const list = (await pagesSvc.listPages(deps.db, space.id)).filter((p) => p.published);
    const lines = list.map((p) => `- [${p.title}](${pageUrl(space, p.path)}.md)${p.summary ? `: ${p.summary}` : ""}`);
    return c.text(`# ${space.name}\n\n> ${list.length} page${list.length === 1 ? "" : "s"}. Each link is the Markdown version of the page. All pages in one file: ${deps.config.publicUrl}/s/${space.slug}/llms-full.txt\n\n## Pages\n\n${lines.join("\n")}\n`);
  });

  app.get("/s/:space/llms-full.txt", async (c) => {
    const space = await readableSpace(c, c.req.param("space"));
    const list = await deps.db.query.pages.findMany({ where: (p, { eq }) => eq(p.spaceId, space.id), orderBy: (p, { asc }) => asc(p.path) });
    const parts = await Promise.all(
      list.filter((p) => p.publishedRevisionId).map(async (p) => `<!-- source: ${pageUrl(space, p.path)} -->\n\n${await pagesSvc.readRevision(deps, p.publishedRevisionId!, "markdown")}`),
    );
    return c.text(parts.join("\n\n---\n\n"));
  });

  app.get("/s/:space", async (c) => {
    const space = await readableSpace(c, c.req.param("space"));
    const list = (await pagesSvc.listPages(deps.db, space.id)).filter((p) => p.published);
    const items = list.map((p) => {
      const depth = p.path.split("/").length - 1;
      return `<li style="margin-left:${depth * 20}px"><a href="/s/${escapeHtml(space.slug)}/${escapeHtml(p.path)}">${escapeHtml(p.title)}</a>${p.summary ? ` <small>${escapeHtml(p.summary)}</small>` : ""}</li>`;
    });
    return html(
      c,
      renderSimple(c.get("nonce"), space.name, `<p><a href="/">Elemnt</a></p><h1>${escapeHtml(space.name)}</h1>${items.length ? `<ul>${items.join("")}</ul>` : "<p>No pages yet.</p>"}<p><a href="/s/${escapeHtml(space.slug)}/llms.txt">llms.txt</a></p>`),
    );
  });

  app.get("/s/:space/*", async (c) => {
    const slug = c.req.param("space");
    let space: Space;
    try {
      space = await readableSpace(c, slug);
    } catch (err) {
      if (!c.get("viewer") && err instanceof HttpError && err.status === 404) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
      throw err;
    }
    const rest = decodeURIComponent(c.req.path.slice(`/s/${slug}/`.length));
    const asMarkdownFile = rest.endsWith(".md");
    let path: string;
    try {
      path = pagesSvc.normalizePath(asMarkdownFile ? rest.slice(0, -3) : rest);
    } catch {
      throw new HttpError(404, "Not found.");
    }
    const page = await pagesSvc.findPage(deps.db, space.id, path);
    if (!page?.publishedRevisionId) throw new HttpError(404, "Not found.");

    const url = new URL(c.req.url);
    const view = asMarkdownFile || wantsMarkdown(c) ? "file" : url.searchParams.get("view") === "markdown" ? "markdown" : "page";
    await recordView(deps.db, { pageId: page.id, format: view === "page" ? "html" : "markdown", url, referrer: c.req.header("referer") }).catch((err) =>
      console.error("recordView failed", err),
    );

    if (view === "file") return markdown(c, await pagesSvc.readRevision(deps, page.publishedRevisionId, "markdown"));

    const canonical = pageUrl(space, path);
    const isPublic = space.visibility === "public";
    const viewer = c.get("viewer");
    const stored = await pagesSvc.readRevision(deps, page.publishedRevisionId, view === "page" ? "html" : "markdown");
    const body = view === "page" ? await widgetsSvc.decorateWidgets(deps.db, stored) : stored;
    // Members and verified workspaces run widgets at once; other public readers click to run.
    const autorun = Boolean(viewer?.role) || !isPublic || (await widgetsSvc.widgetSettings(deps.db, c.get("workspaceId"))).verified;
    return html(
      c,
      renderShell({
        nonce: c.get("nonce"),
        title: page.title,
        summary: page.summary,
        canonicalUrl: canonical,
        markdownUrl: `${canonical}.md`,
        space,
        view,
        body,
        ...(sandboxUrl ? { sandboxUrl } : {}),
        autorun,
        ...(hasRole(viewer, "editor") ? { editUrl: `/app/${space.slug}/${path}` } : {}),
        ...(isPublic
          ? {
              share: {
                dialogUrl: linkedin.shareDialogUrl(linkedin.trackedUrl(canonical, `${space.slug}/${path}`)),
                canPost: Boolean(li && hasRole(viewer, "editor")),
                pageId: page.id,
              },
            }
          : {}),
      }),
    );
  });

  return app;
}
