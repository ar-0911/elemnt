import type { Elemnt } from "@elemnt/core";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, isNotNull, max, ne } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { pages, siteChangesets, siteReleases, sites, spaces, type SiteFileChange } from "../db/schema.js";
import type { BlobStore } from "../lib/blobs.js";
import { newId } from "../lib/ids.js";
import { siteRenderer, type Diagnostic, type DocPage, type SiteRef, type SiteSnapshot } from "../sites/render.js";
import { starterFiles } from "../sites/starter.js";
import { EMPTY_TREE, loadTree, normalizeFilePath, readFileText, saveTree, writeFiles, type Tree } from "../sites/tree.js";
import { HttpError } from "./errors.js";
import { readRevision } from "./pages.js";
import { decorateWidgets } from "./widgets.js";

export interface SitesDeps {
  db: Db;
  blobs: BlobStore;
  elemnt: Elemnt;
  /** e.g. "adityapoc.xyz": sites answer at <slug>.<domain>. */
  sitesDomain?: string;
  /** The app's public URL; its scheme and port carry over to site URLs. */
  publicUrl: string;
  sandboxUrl?: string;
}

export type Site = typeof sites.$inferSelect;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/;
/** Subdomains a site can't take: they're usually other services. */
const RESERVED = new Set(["app", "api", "docs", "admin", "mail", "smtp", "ftp", "cdn", "static", "assets", "sandbox", "preview", "status", "elemnt-sandbox"]);

export function checkSlug(slug: string) {
  if (!SLUG.test(slug) || slug.includes("--")) throw new HttpError(400, `"${slug}" can't be a site name: use lowercase letters, digits and single dashes, e.g. "elemnt".`);
  if (RESERVED.has(slug)) throw new HttpError(400, `"${slug}" is reserved; pick another site name.`);
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The frame-src entry that covers every site preview, for the editor's CSP. */
export function previewFrameSource(deps: Pick<SitesDeps, "sitesDomain" | "publicUrl">): string | undefined {
  if (!deps.sitesDomain) return undefined;
  const app = new URL(deps.publicUrl);
  return `${app.protocol}//*.${deps.sitesDomain}${app.port ? `:${app.port}` : ""}`;
}

/** The address a site is served at, or undefined when neither a domain nor a hostname is configured. */
export function siteUrl(deps: Pick<SitesDeps, "sitesDomain" | "publicUrl">, site: Pick<Site, "slug" | "hostname">, previewId?: string): string | undefined {
  const app = new URL(deps.publicUrl);
  if (site.hostname && !previewId) return `${app.protocol}//${site.hostname}`;
  if (!deps.sitesDomain) return undefined;
  return `${app.protocol}//${site.slug}${previewId ? `--${previewId}` : ""}.${deps.sitesDomain}${app.port ? `:${app.port}` : ""}`;
}

export async function listSites(deps: SitesDeps, workspaceId: string) {
  const rows = await deps.db.select().from(sites).where(eq(sites.workspaceId, workspaceId)).orderBy(sites.slug);
  return rows.map((s) => describe(deps, s));
}

export function describe(deps: Pick<SitesDeps, "sitesDomain" | "publicUrl">, s: Site) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    spaceId: s.spaceId,
    hostname: s.hostname,
    repo: s.repo,
    url: siteUrl(deps, s) ?? null,
    published: Boolean(s.publishedTree),
    publishedAt: s.publishedAt,
    unpublishedChanges: s.publishedTree !== s.draftTree,
    updatedAt: s.updatedAt,
  };
}

export async function findSite(db: Db, workspaceId: string, slug: string) {
  const [site] = await db.select().from(sites).where(and(eq(sites.workspaceId, workspaceId), eq(sites.slug, slug)));
  return site;
}

export async function requireSite(db: Db, workspaceId: string, slug: string) {
  const site = await findSite(db, workspaceId, slug);
  if (!site) throw new HttpError(404, `No site "${slug}".`);
  return site;
}

/**
 * Makes a site, its docs space (unless an existing one is given) and the
 * starter design, so it renders something good before anyone touches it.
 */
export async function createSite(
  deps: SitesDeps,
  workspaceId: string,
  input: { slug: string; name: string; spaceSlug?: string; repo?: string | null; tagline?: string; template?: "starter" | "blank" },
) {
  checkSlug(input.slug);
  if (await findSite(deps.db, workspaceId, input.slug)) throw new HttpError(409, `A site called "${input.slug}" already exists.`);
  let spaceId: string | null = null;
  if (input.spaceSlug) {
    const [space] = await deps.db.select().from(spaces).where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.slug, input.spaceSlug)));
    if (!space) throw new HttpError(404, `No space "${input.spaceSlug}" to use for the site's docs.`);
    if (space.visibility === "private") throw new HttpError(400, PRIVATE_DOCS);
    spaceId = space.id;
  }
  const files = input.template === "blank" ? {} : starterFiles({ name: input.name, tagline: input.tagline ?? `${input.name}, explained.`, repo: input.repo ?? null });
  const tree = await writeFiles(
    deps.blobs,
    EMPTY_TREE,
    Object.entries(files).map(([path, content]) => ({ path, content })),
  );
  const treeHash = await saveTree(deps.blobs, tree);
  const [site] = await deps.db
    .insert(sites)
    .values({ id: newId("site"), workspaceId, slug: input.slug, name: input.name, spaceId, repo: input.repo ?? null, draftTree: treeHash })
    .returning();
  return site!;
}

export async function updateSite(deps: SitesDeps, site: Site, input: { name?: string; spaceSlug?: string | null; hostname?: string | null; repo?: string | null }) {
  const patch: Partial<Site> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.repo !== undefined) patch.repo = input.repo;
  if (input.spaceSlug !== undefined) {
    if (input.spaceSlug === null) patch.spaceId = null;
    else {
      const [space] = await deps.db.select().from(spaces).where(and(eq(spaces.workspaceId, site.workspaceId), eq(spaces.slug, input.spaceSlug)));
      if (!space) throw new HttpError(404, `No space "${input.spaceSlug}".`);
      if (space.visibility === "private") throw new HttpError(400, PRIVATE_DOCS);
      patch.spaceId = space.id;
    }
  }
  if (input.hostname !== undefined) {
    const host = input.hostname?.trim().toLowerCase() || null;
    if (host && !HOSTNAME.test(host)) throw new HttpError(400, `"${host}" isn't a hostname, e.g. www.example.com.`);
    if (host) {
      const app = new URL(deps.publicUrl).hostname;
      const sandbox = deps.sandboxUrl ? new URL(deps.sandboxUrl).hostname : undefined;
      if (host === app || host === sandbox) throw new HttpError(400, "A site can't use the app's or the sandbox's hostname.");
      const [taken] = await deps.db.select({ id: sites.id }).from(sites).where(eq(sites.hostname, host));
      if (taken && taken.id !== site.id) throw new HttpError(409, `Another site already uses ${host}.`);
    }
    patch.hostname = host;
  }
  const [row] = await deps.db.update(sites).set(patch).where(eq(sites.id, site.id)).returning();
  hostCache.clear();
  return row!;
}

export async function deleteSite(deps: SitesDeps, site: Site) {
  await deps.db.delete(sites).where(eq(sites.id, site.id));
  hostCache.clear();
}

// ---------- files ----------

export async function listFiles(deps: SitesDeps, site: Site, which: "draft" | "published" = "draft") {
  const hash = which === "draft" ? site.draftTree : site.publishedTree;
  const tree = hash ? await loadTree(deps.blobs, hash) : EMPTY_TREE;
  return Object.entries(tree.files).map(([path, e]) => ({ path, size: e.size, encoding: e.encoding, hash: e.hash }));
}

export async function readFile(deps: SitesDeps, site: Site, path: string) {
  const tree = await loadTree(deps.blobs, site.draftTree);
  const clean = normalizeFilePath(path);
  const entry = tree.files[clean];
  if (!entry) throw new HttpError(404, `No file ${clean} in this site.`);
  return { path: clean, content: (await readFileText(deps.blobs, tree, clean))!, encoding: entry.encoding, hash: entry.hash };
}

/** Saves files straight into the draft (the studio, for editors). */
export async function saveFiles(deps: SitesDeps, site: Site, changes: { path: string; content: string | null; encoding?: "utf8" | "base64" }[]) {
  const tree = await writeFiles(deps.blobs, await loadTree(deps.blobs, site.draftTree), changes);
  const draftTree = await saveTree(deps.blobs, tree);
  const [row] = await deps.db.update(sites).set({ draftTree, updatedAt: new Date() }).where(eq(sites.id, site.id)).returning();
  return row!;
}

// ---------- changesets (Claude's proposals) ----------

export async function proposeChanges(
  deps: SitesDeps,
  site: Site,
  input: { summary: string; files: { path: string; content: string | null; encoding?: "utf8" | "base64" }[]; authorId: string; source?: string },
) {
  if (!input.files.length) throw new HttpError(400, "Propose at least one file change.");
  if (input.files.length > 120) throw new HttpError(400, "Propose at most 120 files at a time.");
  const tree = await loadTree(deps.blobs, site.draftTree);
  const changes: SiteFileChange[] = input.files.map((f) => {
    const path = normalizeFilePath(f.path);
    return { path, content: f.content, ...(f.encoding ? { encoding: f.encoding } : {}), baseHash: tree.files[path]?.hash ?? null };
  });
  // Check that it would apply (paths, sizes) before anyone reviews it.
  await writeFiles(deps.blobs, tree, changes);
  const [row] = await deps.db
    .insert(siteChangesets)
    .values({ id: newId("chg"), siteId: site.id, summary: input.summary.slice(0, 500), changes, authorId: input.authorId, source: input.source ?? "mcp" })
    .returning();
  return row!;
}

export async function listChangesets(deps: SitesDeps, site: Site, status?: "open" | "applied" | "dismissed") {
  const rows = await deps.db
    .select()
    .from(siteChangesets)
    .where(status ? and(eq(siteChangesets.siteId, site.id), eq(siteChangesets.status, status)) : eq(siteChangesets.siteId, site.id))
    .orderBy(desc(siteChangesets.createdAt))
    .limit(50);
  return rows;
}

/** A changeset with each file's current draft content, for the review screen. */
export async function changesetForReview(deps: SitesDeps, site: Site, id: string) {
  const [cs] = await deps.db.select().from(siteChangesets).where(and(eq(siteChangesets.id, id), eq(siteChangesets.siteId, site.id)));
  if (!cs) throw new HttpError(404, "No such change set.");
  const tree = await loadTree(deps.blobs, site.draftTree);
  const files = await Promise.all(
    cs.changes.map(async (c) => {
      const entry = tree.files[c.path];
      const current = entry && entry.encoding === "utf8" ? ((await readFileText(deps.blobs, tree, c.path)) ?? "") : entry ? null : "";
      return { ...c, current, binary: entry?.encoding === "base64" || c.encoding === "base64", conflict: (entry?.hash ?? null) !== c.baseHash };
    }),
  );
  return { ...cs, files };
}

/**
 * Applies a changeset to the draft. A file that changed since Claude read it
 * is a conflict: the whole set waits unless `force` (the reviewer saw the diff
 * against the current file and chose to overwrite). `only` applies a subset.
 */
export async function applyChangeset(deps: SitesDeps, site: Site, id: string, options: { force?: boolean; only?: string[] } = {}) {
  const review = await changesetForReview(deps, site, id);
  if (review.status !== "open") throw new HttpError(409, `This change set was already ${review.status}.`);
  const chosen = review.files.filter((f) => !options.only || options.only.includes(f.path));
  const conflicts = chosen.filter((f) => f.conflict).map((f) => f.path);
  if (conflicts.length && !options.force) throw new HttpError(409, `These files changed since Claude read them: ${conflicts.join(", ")}. Review the diff and apply anyway, or ask Claude to redo it on the latest files.`, { conflicts });
  const updated = await saveFiles(deps, site, chosen.map((f) => ({ path: f.path, content: f.content, ...(f.encoding ? { encoding: f.encoding } : {}) })));
  await deps.db.update(siteChangesets).set({ status: "applied", resolvedAt: new Date() }).where(eq(siteChangesets.id, id));
  return updated;
}

export async function dismissChangeset(deps: SitesDeps, site: Site, id: string) {
  const [row] = await deps.db
    .update(siteChangesets)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(and(eq(siteChangesets.id, id), eq(siteChangesets.siteId, site.id), eq(siteChangesets.status, "open")))
    .returning();
  if (!row) throw new HttpError(404, "No open change set with that id.");
  return row;
}

// ---------- rendering, preview, publish ----------

const PRIVATE_DOCS = "Websites are public, so they can't show a private space's docs. Pick a workspace or public space.";

async function docsFor(db: Db, spaceId: string | null): Promise<DocPage[]> {
  if (!spaceId) return [];
  // A space made private after it was linked stops feeding the site.
  const rows = await db
    .select({ id: pages.id, path: pages.path, title: pages.title, summary: pages.summary, position: pages.position, revisionId: pages.publishedRevisionId, updatedAt: pages.updatedAt })
    .from(pages)
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(and(eq(pages.spaceId, spaceId), isNotNull(pages.publishedRevisionId), ne(spaces.visibility, "private")));
  return rows.map((r) => ({ ...r, revisionId: r.revisionId!, updatedAt: new Date(r.updatedAt) }));
}

async function siteRefs(deps: SitesDeps, workspaceId: string): Promise<SiteRef[]> {
  const rows = await deps.db.select().from(sites).where(and(eq(sites.workspaceId, workspaceId), isNotNull(sites.publishedTree))).orderBy(sites.name);
  const out: SiteRef[] = [];
  for (const s of rows) {
    const url = siteUrl(deps, s);
    if (!url) continue;
    let tagline: string | undefined;
    try {
      const raw = await readFileText(deps.blobs, await loadTree(deps.blobs, s.publishedTree!), "site.json");
      tagline = raw ? (JSON.parse(raw) as { tagline?: string }).tagline : undefined;
    } catch {
      tagline = undefined;
    }
    out.push({ name: s.name, slug: s.slug, url, repo: s.repo, ...(tagline ? { tagline } : {}) });
  }
  return out;
}

/** What visitors (or a preview) see right now, keyed so renders can be cached. */
export async function snapshot(deps: SitesDeps, site: Site, treeHash: string, options: { preview?: string } = {}): Promise<SiteSnapshot> {
  const [tree, docs, refs, stamp, space] = await Promise.all([
    loadTree(deps.blobs, treeHash),
    docsFor(deps.db, site.spaceId),
    siteRefs(deps, site.workspaceId),
    deps.db.select({ at: max(sites.publishedAt), n: count() }).from(sites).where(eq(sites.workspaceId, site.workspaceId)),
    site.spaceId ? deps.db.query.spaces.findFirst({ where: (sp, { eq: is }) => is(sp.id, site.spaceId!) }) : undefined,
  ]);
  const url = siteUrl(deps, site, options.preview) ?? `${deps.publicUrl}/sites/${site.slug}`;
  const docsKey = docs.map((d) => `${d.path}@${d.revisionId}:${d.position}:${d.title}`).join("|");
  return {
    key: `${treeHash}|${options.preview ?? ""}|${docsKey}|${stamp[0]?.at?.toString() ?? ""}:${stamp[0]?.n ?? 0}|${site.name}|${site.repo ?? ""}`,
    site: { id: site.id, slug: site.slug, name: site.name, repo: site.repo },
    url,
    tree,
    docs,
    ...(space ? { spaceSlug: space.slug } : {}),
    sites: refs,
    ...(deps.sandboxUrl ? { sandboxUrl: deps.sandboxUrl } : {}),
    appUrl: deps.publicUrl,
    preview: Boolean(options.preview),
  };
}

export function rendererDeps(deps: SitesDeps) {
  return {
    blobs: deps.blobs,
    elemnt: deps.elemnt,
    readRevision: (id: string, kind: "html" | "markdown") => readRevision(deps, id, kind),
    decorateWidgets: (html: string) => decorateWidgets(deps.db, html),
  };
}

/** Renders every route of the draft and reports problems, without publishing. */
export async function checkSite(deps: SitesDeps, site: Site, treeHash = site.draftTree): Promise<Diagnostic[]> {
  const r = await siteRenderer(rendererDeps(deps), await snapshot(deps, site, treeHash, { preview: "check" }));
  return r.check();
}

/** A private, unguessable address showing the current draft. */
export async function preview(deps: SitesDeps, site: Site, userId: string) {
  const [release] = await deps.db.insert(siteReleases).values({ id: newPreviewId(), siteId: site.id, kind: "preview", tree: site.draftTree, createdBy: userId }).returning();
  const diagnostics = await checkSite(deps, site);
  return { id: release!.id, url: siteUrl(deps, site, release!.id) ?? null, diagnostics };
}

/** 16 hex characters: unguessable, and short enough that `<slug>--<id>` fits in one DNS label. */
/** A preview of the draft with a change set applied, so Claude (and the reviewer) can see it before it lands. */
export async function previewChangeset(deps: SitesDeps, site: Site, id: string, userId: string) {
  const [cs] = await deps.db.select().from(siteChangesets).where(and(eq(siteChangesets.id, id), eq(siteChangesets.siteId, site.id)));
  if (!cs) throw new HttpError(404, "No such change set.");
  const tree = await saveTree(deps.blobs, await writeFiles(deps.blobs, await loadTree(deps.blobs, site.draftTree), cs.changes));
  const [release] = await deps.db.insert(siteReleases).values({ id: newPreviewId(), siteId: site.id, kind: "preview", tree, createdBy: userId }).returning();
  const diagnostics = await checkSite(deps, site, tree);
  return { id: release!.id, url: siteUrl(deps, site, release!.id) ?? null, diagnostics };
}

const newPreviewId = () => randomBytes(8).toString("hex");

/** Publishes the draft (or an earlier release, to roll back). Blocks on template errors. */
export async function publish(deps: SitesDeps, site: Site, userId: string, options: { releaseId?: string; force?: boolean } = {}) {
  let tree = site.draftTree;
  if (options.releaseId) {
    const [rel] = await deps.db.select().from(siteReleases).where(and(eq(siteReleases.id, options.releaseId), eq(siteReleases.siteId, site.id)));
    if (!rel) throw new HttpError(404, "No such release.");
    tree = rel.tree;
  }
  const diagnostics = await checkSite(deps, site, tree);
  const errors = diagnostics.filter((d) => !/only its content shows/.test(d.message));
  if (errors.length && !options.force) throw new HttpError(422, "The site has errors, so it wasn't published. Fix them (or publish anyway).", { diagnostics });
  const [release] = await deps.db.insert(siteReleases).values({ id: newPreviewId(), siteId: site.id, kind: "publish", tree, createdBy: userId }).returning();
  const [row] = await deps.db.update(sites).set({ publishedTree: tree, publishedAt: new Date(), ...(options.releaseId ? { draftTree: tree } : {}) }).where(eq(sites.id, site.id)).returning();
  hostCache.clear();
  return { site: row!, release: release!, diagnostics };
}

export async function unpublish(deps: SitesDeps, site: Site) {
  const [row] = await deps.db.update(sites).set({ publishedTree: null, publishedAt: null }).where(eq(sites.id, site.id)).returning();
  hostCache.clear();
  return row!;
}

export async function releases(deps: SitesDeps, site: Site) {
  return deps.db.select().from(siteReleases).where(and(eq(siteReleases.siteId, site.id), eq(siteReleases.kind, "publish"))).orderBy(desc(siteReleases.createdAt)).limit(30);
}

// ---------- hostnames ----------

export interface HostMatch {
  site: Site;
  tree: string;
  preview?: string;
}

const hostCache = new Map<string, { at: number; match: HostMatch | null }>();

/**
 * Which site (and which version of it) a request's Host asks for:
 * `<slug>.<domain>` is the published site, `<slug>--<preview>.<domain>` a
 * preview, and a site's own hostname its published version.
 */
export async function matchHost(deps: SitesDeps, workspaceId: string | undefined, rawHost: string): Promise<HostMatch | undefined> {
  if (!workspaceId) return undefined;
  const host = rawHost.toLowerCase().replace(/:\d+$/, "");
  const cached = hostCache.get(host);
  if (cached && Date.now() - cached.at < 5000) return cached.match ?? undefined;
  const match = await lookup();
  if (hostCache.size > 1000) hostCache.clear();
  hostCache.set(host, { at: Date.now(), match: match ?? null });
  return match;

  async function lookup(): Promise<HostMatch | undefined> {
    const domain = deps.sitesDomain?.toLowerCase();
    if (domain && host.endsWith(`.${domain}`)) {
      const label = host.slice(0, -domain.length - 1);
      if (label.includes(".")) return undefined;
      const [slug, previewId] = label.split("--");
      const site = await findSite(deps.db, workspaceId!, slug!);
      if (!site) return undefined;
      if (previewId) {
        const [rel] = await deps.db.select().from(siteReleases).where(and(eq(siteReleases.id, previewId), eq(siteReleases.siteId, site.id)));
        return rel ? { site, tree: rel.tree, preview: rel.id } : undefined;
      }
      return site.publishedTree ? { site, tree: site.publishedTree } : undefined;
    }
    const [site] = await deps.db.select().from(sites).where(and(eq(sites.workspaceId, workspaceId!), eq(sites.hostname, host)));
    return site?.publishedTree ? { site, tree: site.publishedTree } : undefined;
  }
}

/** Origins sandboxed frames may be embedded in: every site host. */
export async function siteOrigins(deps: SitesDeps): Promise<string[]> {
  const app = new URL(deps.publicUrl);
  const out = deps.sitesDomain ? [`${app.protocol}//*.${deps.sitesDomain}${app.port ? `:${app.port}` : ""}`] : [];
  const rows = await deps.db.select({ hostname: sites.hostname }).from(sites).where(isNotNull(sites.hostname));
  for (const r of rows) out.push(`${app.protocol}//${r.hostname}`);
  return out;
}

export type { Tree };
