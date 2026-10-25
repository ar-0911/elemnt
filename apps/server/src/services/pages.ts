import type { Diagnostic, Elemnt } from "@elemnt/core";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { pages, revisions, spaces, type Visibility } from "../db/schema.js";
import type { BlobStore } from "../lib/blobs.js";
import { sha256 } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { HttpError, InvalidSourceError } from "./errors.js";

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function normalizePath(path: string): string {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length === 0 || parts.length > 8 || parts.some((p) => !SLUG.test(p))) {
    throw new HttpError(400, `"${path}" is not a valid page path. Use lowercase slugs separated by /, e.g. guides/deploy.`);
  }
  return parts.join("/");
}

export interface PageDeps {
  db: Db;
  blobs: BlobStore;
  elemnt: Elemnt;
}

async function store(blobs: BlobStore, body: string): Promise<string> {
  const hash = sha256(body);
  await blobs.put(hash, body);
  return hash;
}

/**
 * Compiles source and stores all three bodies. Elemnt keeps the HTML and the
 * Markdown for every revision, so readers and agents never wait on a render.
 */
async function compileAndStore({ blobs, elemnt }: PageDeps, source: string) {
  const result = elemnt.compile(source);
  if (!result.ok) throw new InvalidSourceError(result.diagnostics);
  const [sourceHash, htmlHash, markdownHash] = await Promise.all([store(blobs, source), store(blobs, result.html), store(blobs, result.markdown)]);
  return { result, sourceHash, htmlHash, markdownHash };
}

export async function createSpace(db: Db, workspaceId: string, input: { slug: string; name: string; visibility: Visibility }) {
  if (!SLUG.test(input.slug)) throw new HttpError(400, `"${input.slug}" is not a valid space slug.`);
  const existing = await findSpace(db, workspaceId, input.slug);
  if (existing) throw new HttpError(409, `Space "${input.slug}" already exists.`);
  const [space] = await db.insert(spaces).values({ id: newId("spc"), workspaceId, ...input }).returning();
  return space!;
}

export async function findSpace(db: Db, workspaceId: string, slug: string) {
  const [space] = await db.select().from(spaces).where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.slug, slug)));
  return space;
}

export async function listPages(db: Db, spaceId: string) {
  return db
    .select({ id: pages.id, path: pages.path, title: pages.title, summary: pages.summary, parentId: pages.parentId, position: pages.position })
    .from(pages)
    .where(eq(pages.spaceId, spaceId))
    .orderBy(asc(pages.path));
}

export async function findPage(db: Db, spaceId: string, path: string) {
  const [page] = await db.select().from(pages).where(and(eq(pages.spaceId, spaceId), eq(pages.path, path)));
  return page;
}

export async function getPage(db: Db, pageId: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId));
  if (!page) throw new HttpError(404, "Page not found.");
  return page;
}

export async function createPage(deps: PageDeps, input: { spaceId: string; path: string; source: string; authorId: string; message?: string }) {
  const path = normalizePath(input.path);
  if (await findPage(deps.db, input.spaceId, path)) throw new HttpError(409, `A page already exists at ${path}.`);

  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
  const parent = parentPath ? await findPage(deps.db, input.spaceId, parentPath) : undefined;
  if (parentPath && !parent) throw new HttpError(400, `Create the parent page ${parentPath} first.`);

  const { result, ...hashes } = await compileAndStore(deps, input.source);
  const pageId = newId("pg");
  const revisionId = newId("rev");
  const title = result.frontmatter.title ?? path.split("/").pop()!;

  await deps.db.transaction(async (tx) => {
    await tx.insert(pages).values({ id: pageId, spaceId: input.spaceId, parentId: parent?.id ?? null, path, title, summary: result.frontmatter.summary ?? null });
    await tx.insert(revisions).values({ id: revisionId, pageId, parentRevisionId: null, ...hashes, authorId: input.authorId, message: input.message ?? null });
    await tx.update(pages).set({ publishedRevisionId: revisionId }).where(eq(pages.id, pageId));
  });
  return { pageId, revisionId, diagnostics: result.diagnostics };
}

/**
 * Saves a new revision. `baseRevisionId` is the revision the editor started
 * from; if someone saved in between, this is a 409 rather than a silent
 * overwrite. (Three-way merge arrives with suggestions in M4.)
 */
export async function updatePage(deps: PageDeps, input: { pageId: string; source: string; baseRevisionId: string; authorId: string; message?: string }) {
  const page = await getPage(deps.db, input.pageId);
  if (page.publishedRevisionId !== input.baseRevisionId) {
    throw new HttpError(409, "This page changed since you opened it. Reload to get the latest version.", { currentRevisionId: page.publishedRevisionId });
  }
  const { result, ...hashes } = await compileAndStore(deps, input.source);
  const revisionId = newId("rev");

  await deps.db.transaction(async (tx) => {
    await tx.insert(revisions).values({ id: revisionId, pageId: page.id, parentRevisionId: input.baseRevisionId, ...hashes, authorId: input.authorId, message: input.message ?? null });
    // Conditional on the base so two concurrent saves can't both win.
    const updated = await tx
      .update(pages)
      .set({ publishedRevisionId: revisionId, title: result.frontmatter.title ?? page.title, summary: result.frontmatter.summary ?? null, updatedAt: new Date() })
      .where(and(eq(pages.id, page.id), eq(pages.publishedRevisionId, input.baseRevisionId)))
      .returning({ id: pages.id });
    if (updated.length === 0) throw new HttpError(409, "This page changed since you opened it. Reload to get the latest version.");
  });
  return { pageId: page.id, revisionId, diagnostics: result.diagnostics };
}

export async function listRevisions(db: Db, pageId: string) {
  return db
    .select({ id: revisions.id, parentRevisionId: revisions.parentRevisionId, authorId: revisions.authorId, message: revisions.message, createdAt: revisions.createdAt })
    .from(revisions)
    .where(eq(revisions.pageId, pageId))
    .orderBy(desc(revisions.createdAt));
}

export type Rendition = "source" | "html" | "markdown";

export async function readRevision(deps: Pick<PageDeps, "db" | "blobs">, revisionId: string, rendition: Rendition): Promise<string> {
  const [rev] = await deps.db.select().from(revisions).where(eq(revisions.id, revisionId));
  if (!rev) throw new HttpError(404, "Revision not found.");
  const hash = rendition === "source" ? rev.sourceHash : rendition === "html" ? rev.htmlHash : rev.markdownHash;
  const body = await deps.blobs.get(hash);
  if (body === undefined) throw new Error(`Blob ${hash} for revision ${revisionId} is missing`);
  return body;
}

export type { Diagnostic };
