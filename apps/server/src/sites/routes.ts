import type { Context, Hono } from "hono";
import { z } from "zod";
import { normalizeRepo } from "../services/github.js";
import * as sitesSvc from "../services/sites.js";
import type { Viewer } from "../services/workspace.js";

/**
 * The studio's API for project websites. Editors change files, preview and
 * publish; Claude (over MCP) only proposes change sets, which an editor
 * applies here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEnv = any;

export interface SiteRouteDeps extends sitesSvc.SitesDeps {
  requireRole(c: Context<AnyEnv>, role: "viewer" | "editor" | "admin"): Viewer;
  workspaceId(c: Context<AnyEnv>): string;
  /** Builds a change set from a repo with the workspace's Claude key (services/site-generate.ts). */
  generate?(c: Context<AnyEnv>, site: sitesSvc.Site, input: { repo?: string; brief?: string }, viewer: Viewer): Promise<unknown>;
}

const fileChange = z.object({ path: z.string().max(300), content: z.string().max(4_500_000).nullable(), encoding: z.enum(["utf8", "base64"]).optional() });
const repoField = z
  .string()
  .max(200)
  .nullable()
  .optional()
  .transform((r) => (r ? normalizeRepo(r) : r));

export function registerSiteRoutes(app: Hono<AnyEnv>, deps: SiteRouteDeps) {
  const site = async (c: Context<AnyEnv>) => sitesSvc.requireSite(deps.db, deps.workspaceId(c), c.req.param("slug")!);

  app.get("/api/sites", async (c) => {
    deps.requireRole(c, "viewer");
    return c.json({ sites: await sitesSvc.listSites(deps, deps.workspaceId(c)), domain: deps.sitesDomain ?? null });
  });

  app.post("/api/sites", async (c) => {
    deps.requireRole(c, "editor");
    const input = z
      .object({ slug: z.string(), name: z.string().min(1).max(120), space: z.string().optional(), repo: repoField, tagline: z.string().max(300).optional(), template: z.enum(["starter", "blank"]).optional() })
      .parse(await c.req.json());
    const row = await sitesSvc.createSite(deps, deps.workspaceId(c), { ...input, ...(input.space ? { spaceSlug: input.space } : {}) });
    return c.json(sitesSvc.describe(deps, row), 201);
  });

  app.get("/api/sites/:slug", async (c) => {
    deps.requireRole(c, "viewer");
    const s = await site(c);
    return c.json({ ...sitesSvc.describe(deps, s), files: await sitesSvc.listFiles(deps, s), changesets: (await sitesSvc.listChangesets(deps, s, "open")).map(({ changes, ...cs }) => ({ ...cs, files: changes.map((f) => f.path) })) });
  });

  app.patch("/api/sites/:slug", async (c) => {
    deps.requireRole(c, "editor");
    const input = z.object({ name: z.string().min(1).max(120).optional(), space: z.string().nullable().optional(), hostname: z.string().max(253).nullable().optional(), repo: repoField }).parse(await c.req.json());
    const row = await sitesSvc.updateSite(deps, await site(c), {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.space !== undefined ? { spaceSlug: input.space } : {}),
      ...(input.hostname !== undefined ? { hostname: input.hostname } : {}),
      ...(input.repo !== undefined ? { repo: input.repo } : {}),
    });
    return c.json(sitesSvc.describe(deps, row));
  });

  app.delete("/api/sites/:slug", async (c) => {
    deps.requireRole(c, "admin");
    await sitesSvc.deleteSite(deps, await site(c));
    return c.body(null, 204);
  });

  app.get("/api/sites/:slug/files/*", async (c) => {
    deps.requireRole(c, "viewer");
    const path = decodeURIComponent(c.req.path.slice(`/api/sites/${c.req.param("slug")}/files/`.length));
    return c.json(await sitesSvc.readFile(deps, await site(c), path));
  });

  app.put("/api/sites/:slug/files", async (c) => {
    deps.requireRole(c, "editor");
    const input = z.object({ files: z.array(fileChange).min(1).max(200) }).parse(await c.req.json());
    const row = await sitesSvc.saveFiles(deps, await site(c), input.files);
    return c.json({ ...sitesSvc.describe(deps, row), files: await sitesSvc.listFiles(deps, row) });
  });

  app.get("/api/sites/:slug/check", async (c) => {
    deps.requireRole(c, "editor");
    return c.json({ diagnostics: await sitesSvc.checkSite(deps, await site(c)) });
  });

  app.post("/api/sites/:slug/preview", async (c) => {
    const viewer = deps.requireRole(c, "editor");
    return c.json(await sitesSvc.preview(deps, await site(c), viewer.userId));
  });

  app.post("/api/sites/:slug/publish", async (c) => {
    const viewer = deps.requireRole(c, "editor");
    const input = z.object({ release: z.string().optional(), force: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    const out = await sitesSvc.publish(deps, await site(c), viewer.userId, { ...(input.release ? { releaseId: input.release } : {}), ...(input.force ? { force: true } : {}) });
    return c.json({ ...sitesSvc.describe(deps, out.site), release: out.release.id, diagnostics: out.diagnostics });
  });

  app.post("/api/sites/:slug/unpublish", async (c) => {
    deps.requireRole(c, "editor");
    return c.json(sitesSvc.describe(deps, await sitesSvc.unpublish(deps, await site(c))));
  });

  app.get("/api/sites/:slug/releases", async (c) => {
    deps.requireRole(c, "viewer");
    return c.json({ releases: await sitesSvc.releases(deps, await site(c)) });
  });

  app.get("/api/sites/:slug/changesets", async (c) => {
    deps.requireRole(c, "viewer");
    const status = z.enum(["open", "applied", "dismissed"]).optional().parse(c.req.query("status") || undefined);
    return c.json({ changesets: (await sitesSvc.listChangesets(deps, await site(c), status)).map(({ changes, ...cs }) => ({ ...cs, files: changes.map((f) => f.path) })) });
  });

  app.get("/api/sites/:slug/changesets/:id", async (c) => {
    deps.requireRole(c, "viewer");
    return c.json(await sitesSvc.changesetForReview(deps, await site(c), c.req.param("id")));
  });

  app.post("/api/sites/:slug/changesets", async (c) => {
    const viewer = deps.requireRole(c, "editor");
    const input = z.object({ summary: z.string().min(1).max(500), files: z.array(fileChange).min(1).max(120) }).parse(await c.req.json());
    const row = await sitesSvc.proposeChanges(deps, await site(c), { ...input, authorId: viewer.userId, source: "studio" });
    return c.json({ id: row.id }, 201);
  });

  app.post("/api/sites/:slug/changesets/:id/apply", async (c) => {
    deps.requireRole(c, "editor");
    const input = z.object({ force: z.boolean().optional(), only: z.array(z.string()).optional() }).parse(await c.req.json().catch(() => ({})));
    const row = await sitesSvc.applyChangeset(deps, await site(c), c.req.param("id"), input);
    return c.json({ ...sitesSvc.describe(deps, row), files: await sitesSvc.listFiles(deps, row) });
  });

  app.post("/api/sites/:slug/changesets/:id/dismiss", async (c) => {
    deps.requireRole(c, "editor");
    await sitesSvc.dismissChangeset(deps, await site(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/api/sites/:slug/generate", async (c) => {
    const viewer = deps.requireRole(c, "editor");
    if (!deps.generate) return c.json({ error: "Generating sites isn't available on this server." }, 501);
    const input = z.object({ repo: z.string().max(200).optional(), brief: z.string().max(4000).optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await deps.generate(c, await site(c), input, viewer), 201);
  });
}
