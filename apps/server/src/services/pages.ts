import type { Diagnostic, Elemnt } from "@elemnt/core";
import { createTwoFilesPatch, structuredPatch } from "diff";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { pages, revisions, spaces, users, type Visibility } from "../db/schema.js";
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

/**
 * Text indexed for search. Postgres' text parser treats anything that looks
 * like an HTML tag (for example a literal <script> in prose) as markup and can
 * skip the text after it, so tags are blanked out first.
 */
function searchTextFrom(markdown: string): string {
  return markdown.replace(/<[^>]*>/g, " ");
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
async function compileAndStore({ blobs, elemnt }: PageDeps, source: string, options: { allowErrors?: boolean } = {}) {
  const result = elemnt.compile(source);
  // Drafts may be mid-edit and broken; only publishing requires a clean page.
  if (!result.ok && !options.allowErrors) throw new InvalidSourceError(result.diagnostics);
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
    .select({
      id: pages.id,
      path: pages.path,
      title: pages.title,
      summary: pages.summary,
      parentId: pages.parentId,
      position: pages.position,
      published: sql<boolean>`${pages.publishedRevisionId} is not null`,
      hasDraft: sql<boolean>`${pages.draftRevisionId} is not null`,
    })
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

export async function createPage(deps: PageDeps, input: { spaceId: string; path: string; source: string; authorId: string; message?: string; draft?: boolean }) {
  const path = normalizePath(input.path);
  if (await findPage(deps.db, input.spaceId, path)) throw new HttpError(409, `A page already exists at ${path}.`);

  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
  const parent = parentPath ? await findPage(deps.db, input.spaceId, parentPath) : undefined;
  if (parentPath && !parent) throw new HttpError(400, `Create the parent page ${parentPath} first.`);

  const { result, ...hashes } = await compileAndStore(deps, input.source, { allowErrors: input.draft });
  const pageId = newId("pg");
  const revisionId = newId("rev");
  const title = result.frontmatter.title ?? path.split("/").pop()!;
  const summary = result.frontmatter.summary ?? null;

  await deps.db.transaction(async (tx) => {
    await tx.insert(pages).values({ id: pageId, spaceId: input.spaceId, parentId: parent?.id ?? null, path, title, summary });
    await tx.insert(revisions).values({ id: revisionId, pageId, parentRevisionId: null, ...hashes, title, summary, authorId: input.authorId, message: input.message ?? null });
    await tx
      .update(pages)
      .set(input.draft ? { draftRevisionId: revisionId } : { publishedRevisionId: revisionId, searchText: searchTextFrom(result.markdown) })
      .where(eq(pages.id, pageId));
  });
  return { pageId, revisionId, published: !input.draft, ok: result.ok, diagnostics: result.diagnostics };
}

/** The revision an editor should start from: the draft if there is one, else the published one. */
export function headRevisionId(page: { draftRevisionId: string | null; publishedRevisionId: string | null }): string | null {
  return page.draftRevisionId ?? page.publishedRevisionId;
}

const headSql = sql`coalesce(${pages.draftRevisionId}, ${pages.publishedRevisionId})`;

function assertNotLockedByOther(page: typeof pages.$inferSelect, userId: string) {
  if (page.lockedBy && page.lockedBy !== userId && page.lockedUntil && page.lockedUntil.getTime() > Date.now()) {
    throw new HttpError(423, "Someone else is editing this page right now.", { lockedBy: page.lockedBy, lockedUntil: page.lockedUntil });
  }
}

const STALE = "This page changed since you opened it. Reload to get the latest version.";

/**
 * Saves a new revision. `publish: false` keeps it as the page's draft (autosave);
 * `publish: true` makes it live. `baseRevisionId` must be the current head
 * (draft or published), so two editors can't silently overwrite each other.
 */
export async function updatePage(
  deps: PageDeps,
  input: { pageId: string; source: string; baseRevisionId: string; authorId: string; message?: string; publish?: boolean },
) {
  const page = await getPage(deps.db, input.pageId);
  assertNotLockedByOther(page, input.authorId);
  if (headRevisionId(page) !== input.baseRevisionId) throw new HttpError(409, STALE, { currentRevisionId: headRevisionId(page) });

  const publish = input.publish ?? true;
  const { result, ...hashes } = await compileAndStore(deps, input.source, { allowErrors: !publish });
  const revisionId = newId("rev");
  const title = result.frontmatter.title ?? page.path.split("/").pop()!;
  const summary = result.frontmatter.summary ?? null;

  await deps.db.transaction(async (tx) => {
    await tx.insert(revisions).values({ id: revisionId, pageId: page.id, parentRevisionId: input.baseRevisionId, ...hashes, title, summary, authorId: input.authorId, message: input.message ?? null });
    const set = publish
      ? { publishedRevisionId: revisionId, draftRevisionId: null, title, summary, searchText: searchTextFrom(result.markdown), updatedAt: new Date() }
      : { draftRevisionId: revisionId, updatedAt: new Date() };
    // Conditional on the base so two concurrent saves can't both win.
    const updated = await tx.update(pages).set(set).where(and(eq(pages.id, page.id), eq(headSql, input.baseRevisionId))).returning({ id: pages.id });
    if (updated.length === 0) throw new HttpError(409, STALE);
  });
  return { pageId: page.id, revisionId, published: publish, ok: result.ok, diagnostics: result.diagnostics };
}

/** Makes the current draft live. */
export async function publishDraft(deps: PageDeps, input: { pageId: string; userId: string }) {
  const page = await getPage(deps.db, input.pageId);
  assertNotLockedByOther(page, input.userId);
  if (!page.draftRevisionId) throw new HttpError(400, "There is no draft to publish.");
  const check = deps.elemnt.compile(await readRevision(deps, page.draftRevisionId, "source"));
  if (!check.ok) throw new InvalidSourceError(check.diagnostics);
  const [rev] = await deps.db.select().from(revisions).where(eq(revisions.id, page.draftRevisionId));
  const markdown = await readRevision(deps, page.draftRevisionId, "markdown");
  await deps.db
    .update(pages)
    .set({ publishedRevisionId: page.draftRevisionId, draftRevisionId: null, title: rev?.title ?? page.title, summary: rev?.summary ?? null, searchText: searchTextFrom(markdown), updatedAt: new Date() })
    .where(and(eq(pages.id, page.id), eq(pages.draftRevisionId, page.draftRevisionId)));
  return { pageId: page.id, revisionId: page.draftRevisionId };
}

/** Throws the draft away; the page goes back to its published revision. */
export async function discardDraft(db: Db, input: { pageId: string; userId: string }) {
  const page = await getPage(db, input.pageId);
  assertNotLockedByOther(page, input.userId);
  if (!page.publishedRevisionId) throw new HttpError(400, "This page has never been published, so its draft can't be discarded.");
  await db.update(pages).set({ draftRevisionId: null }).where(eq(pages.id, page.id));
}

/** Restoring creates a new revision with the old content; history is never rewritten. */
export async function restoreRevision(deps: PageDeps, input: { pageId: string; revisionId: string; userId: string }) {
  const page = await getPage(deps.db, input.pageId);
  const [rev] = await deps.db.select().from(revisions).where(and(eq(revisions.id, input.revisionId), eq(revisions.pageId, page.id)));
  if (!rev) throw new HttpError(404, "Revision not found on this page.");
  const source = await readRevision(deps, rev.id, "source");
  return updatePage(deps, { pageId: page.id, source, baseRevisionId: headRevisionId(page)!, authorId: input.userId, message: `Restored ${rev.id}`, publish: true });
}

export async function diffRevisions(deps: Pick<PageDeps, "db" | "blobs">, input: { pageId: string; from: string; to: string }) {
  const owned = await deps.db
    .select({ id: revisions.id })
    .from(revisions)
    .where(and(eq(revisions.pageId, input.pageId), inArray(revisions.id, [input.from, input.to])));
  if (new Set(owned.map((r) => r.id)).size !== new Set([input.from, input.to]).size) throw new HttpError(404, "Revision not found on this page.");
  const [a, b] = await Promise.all([readRevision(deps, input.from, "source"), readRevision(deps, input.to, "source")]);
  const patch = structuredPatch(input.from, input.to, a, b, "", "", { context: 3 });
  return { from: input.from, to: input.to, unified: createTwoFilesPatch(input.from, input.to, a, b, "", "", { context: 3 }), hunks: patch.hunks };
}

const LOCK_SECONDS = 90;

/** Takes or renews the edit lock. Editors renew it every 30 seconds while open. */
export async function acquireLock(db: Db, input: { pageId: string; userId: string }) {
  const until = new Date(Date.now() + LOCK_SECONDS * 1000);
  const [row] = await db
    .update(pages)
    .set({ lockedBy: input.userId, lockedUntil: until })
    .where(and(eq(pages.id, input.pageId), or(isNull(pages.lockedBy), eq(pages.lockedBy, input.userId), lt(pages.lockedUntil, new Date()))))
    .returning({ lockedUntil: pages.lockedUntil });
  if (row) return { lockedBy: input.userId, lockedUntil: row.lockedUntil };
  const page = await getPage(db, input.pageId);
  const [holder] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, page.lockedBy!));
  throw new HttpError(423, `${holder?.name ?? holder?.email ?? "Someone"} is editing this page.`, { lockedBy: holder?.email, lockedUntil: page.lockedUntil });
}

export async function releaseLock(db: Db, input: { pageId: string; userId: string }) {
  await db.update(pages).set({ lockedBy: null, lockedUntil: null }).where(and(eq(pages.id, input.pageId), eq(pages.lockedBy, input.userId)));
}

export async function listRevisions(db: Db, pageId: string) {
  return db
    .select({
      id: revisions.id,
      parentRevisionId: revisions.parentRevisionId,
      title: revisions.title,
      authorId: revisions.authorId,
      authorEmail: users.email,
      authorName: users.name,
      message: revisions.message,
      createdAt: revisions.createdAt,
    })
    .from(revisions)
    .leftJoin(users, eq(users.id, revisions.authorId))
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
