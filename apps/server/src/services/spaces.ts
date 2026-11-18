/**
 * Moving pages between spaces, and deleting spaces (to a 30-day trash).
 *
 * A move takes a page and everything under it. Revisions, comments,
 * suggestions, repo links and stats are keyed by page id, so they come along
 * untouched; only `space_id`, `path` and the root's `parent_id` change. Every
 * old address is kept in `page_redirects` so shared links still land.
 */
import { and, count, eq, inArray, isNotNull, isNull, lt, max, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { pageRedirects, pages, sites, spaces, type Visibility } from "../db/schema.js";
import type { BlobStore } from "../lib/blobs.js";
import { loadTree, readFileText } from "../sites/tree.js";
import { HttpError } from "./errors.js";
import { normalizePath } from "./pages.js";

export const TRASH_DAYS = 30;
const DAY = 86_400_000;

type Space = typeof spaces.$inferSelect;
type PageRow = typeof pages.$inferSelect;

export interface MoveRequest {
  /** The page to move; everything under it comes too. */
  pageId: string;
  to: Space;
  /** Path of the new parent in the target space; null or "" for the top level. */
  parentPath?: string | null;
  /** New last segment of the path. Defaults to the current one. */
  slug?: string;
  userId: string;
}

export interface MovePlan {
  from: { slug: string; name: string; visibility: Visibility };
  to: { slug: string; name: string; visibility: Visibility };
  /** Old path → new path, root first. */
  moves: { id: string; title: string; from: string; to: string }[];
  /** New addresses already taken in the target space. */
  conflicts: string[];
  /** Pages in the subtree someone else is editing right now. */
  locked: string[];
  /** Websites that show the old space and will lose these pages. */
  sites: { slug: string; name: string; root: string | null }[];
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** The page and its descendants, root first. */
async function subtree(db: Db, page: PageRow) {
  const all = await db.select().from(pages).where(eq(pages.spaceId, page.spaceId));
  return all.filter((p) => under(p.path, page.path)).sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
}

/** docs.root from a site's site.json (published if it has one, else the draft), or null for "the whole space". */
async function docsRoot(blobs: BlobStore, site: typeof sites.$inferSelect): Promise<string | null> {
  try {
    const raw = await readFileText(blobs, await loadTree(blobs, site.publishedTree ?? site.draftTree), "site.json");
    const root = raw ? (JSON.parse(raw) as { docs?: { root?: unknown } }).docs?.root : undefined;
    return typeof root === "string" && root ? root : null;
  } catch {
    return null;
  }
}

/** Websites showing pages in `paths` of `space`. */
async function sitesShowing(db: Db, blobs: BlobStore, spaceId: string, roots: string[] | "all") {
  const linked = await db.select().from(sites).where(eq(sites.spaceId, spaceId));
  const out: MovePlan["sites"] = [];
  for (const s of linked) {
    const root = await docsRoot(blobs, s);
    // A site shows the whole space (root null), or one subtree. It's affected if that overlaps what moves.
    if (roots === "all" || root === null || roots.some((r) => under(root, r) || under(r, root))) out.push({ slug: s.slug, name: s.name, root });
  }
  return out;
}

type FullPlan = MovePlan & { page: PageRow; source: Space; parentId: string | null };

export async function planMove(db: Db, blobs: BlobStore, req: MoveRequest): Promise<FullPlan> {
  const [page] = await db.select().from(pages).where(eq(pages.id, req.pageId));
  if (!page) throw new HttpError(404, "Page not found.");
  const [from] = await db.select().from(spaces).where(eq(spaces.id, page.spaceId));
  if (!from) throw new HttpError(404, "Page not found.");
  if (from.workspaceId !== req.to.workspaceId) throw new HttpError(400, "Pages can only move between spaces in the same workspace.");

  const parentPath = req.parentPath ? normalizePath(req.parentPath) : null;
  const leaf = normalizePath(req.slug ?? page.path.split("/").pop()!);
  if (leaf.includes("/")) throw new HttpError(400, "The new name is one slug, without slashes. Pick the parent separately.");
  const newRoot = parentPath ? `${parentPath}/${leaf}` : leaf;
  if (newRoot.split("/").length > 8) throw new HttpError(400, "That would nest pages more than 8 levels deep.");

  const sameSpace = from.id === req.to.id;
  if (sameSpace && parentPath && under(parentPath, page.path)) throw new HttpError(400, "A page can't move inside itself.");
  if (sameSpace && newRoot === page.path) throw new HttpError(400, "The page is already there.");

  let parentId: string | null = null;
  if (parentPath) {
    const [parent] = await db.select({ id: pages.id }).from(pages).where(and(eq(pages.spaceId, req.to.id), eq(pages.path, parentPath)));
    if (!parent) throw new HttpError(400, `There's no page at ${parentPath} in ${req.to.name}.`);
    parentId = parent.id;
  }

  const tree = await subtree(db, page);
  const ids = new Set(tree.map((p) => p.id));
  const moves = tree.map((p) => ({ id: p.id, title: p.title, from: p.path, to: newRoot + p.path.slice(page.path.length) }));
  if (moves.some((m) => m.to.split("/").length > 8)) throw new HttpError(400, "That would nest some sub-pages more than 8 levels deep.");

  const targets = moves.map((m) => m.to);
  const taken = await db.select({ id: pages.id, path: pages.path }).from(pages).where(and(eq(pages.spaceId, req.to.id), inArray(pages.path, targets)));
  const conflicts = taken.filter((t) => !ids.has(t.id)).map((t) => t.path);

  const now = Date.now();
  const locked = tree.filter((p) => p.lockedBy && p.lockedBy !== req.userId && p.lockedUntil && p.lockedUntil.getTime() > now).map((p) => p.path);
  const affected = sameSpace ? [] : await sitesShowing(db, blobs, from.id, [page.path]);

  return {
    page,
    source: from,
    parentId,
    from: { slug: from.slug, name: from.name, visibility: from.visibility },
    to: { slug: req.to.slug, name: req.to.name, visibility: req.to.visibility },
    moves,
    conflicts,
    locked,
    sites: affected,
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function applyMove(tx: Tx, plan: FullPlan, to: Space) {
  const [{ pos } = { pos: null }] = await tx
    .select({ pos: max(pages.position) })
    .from(pages)
    .where(and(eq(pages.spaceId, to.id), plan.parentId ? eq(pages.parentId, plan.parentId) : isNull(pages.parentId)));
  for (const m of plan.moves) {
    const isRoot = m.id === plan.page.id;
    await tx
      .update(pages)
      .set({ spaceId: to.id, path: m.to, ...(isRoot ? { parentId: plan.parentId, position: (pos ?? -1) + 1 } : {}) })
      .where(eq(pages.id, m.id));
  }
  const ws = to.workspaceId;
  // The new addresses now have live pages; any redirect parked there is dead.
  await tx.delete(pageRedirects).where(and(eq(pageRedirects.workspaceId, ws), eq(pageRedirects.spaceSlug, to.slug), inArray(pageRedirects.path, plan.moves.map((m) => m.to))));
  // Old addresses point at the page itself, so a later move needs no chain.
  for (const m of plan.moves) {
    await tx
      .insert(pageRedirects)
      .values({ workspaceId: ws, spaceSlug: plan.source.slug, path: m.from, pageId: m.id })
      .onConflictDoUpdate({ target: [pageRedirects.workspaceId, pageRedirects.spaceSlug, pageRedirects.path], set: { pageId: m.id, createdAt: new Date() } });
  }
}

function assertMovable(plan: MovePlan) {
  if (plan.conflicts.length) throw new HttpError(409, `${plan.to.name} already has ${plan.conflicts.length === 1 ? "a page" : "pages"} at ${plan.conflicts.join(", ")}. Pick another name or parent.`);
  if (plan.locked.length) throw new HttpError(409, `Someone is editing ${plan.locked.join(", ")} right now. Try again when they're done.`);
}

export async function movePage(db: Db, blobs: BlobStore, req: MoveRequest) {
  const plan = await planMove(db, blobs, req);
  assertMovable(plan);
  await db.transaction((tx) => applyMove(tx, plan, req.to));
  return { space: req.to.slug, path: plan.moves[0]!.to, moved: plan.moves.length, sites: plan.sites };
}

/** Where an old address points now, if the page moved. */
export async function resolveRedirect(db: Db, workspaceId: string, spaceSlug: string, path: string) {
  const [row] = await db
    .select({ page: pages, space: spaces })
    .from(pageRedirects)
    .innerJoin(pages, eq(pages.id, pageRedirects.pageId))
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(and(eq(pageRedirects.workspaceId, workspaceId), eq(pageRedirects.spaceSlug, spaceSlug), eq(pageRedirects.path, path), isNull(spaces.deletedAt)));
  return row;
}

// ---------- deleting spaces ----------

export async function deleteCheck(db: Db, blobs: BlobStore, space: Space) {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(pages).where(eq(pages.spaceId, space.id));
  return { pages: n, sites: await sitesShowing(db, blobs, space.id, "all") };
}

export async function trashSpace(
  db: Db,
  blobs: BlobStore,
  input: { space: Space; userId: string; confirm: string; moveTo?: Space; parentPath?: string | null },
) {
  const { space } = input;
  if (input.confirm.trim() !== space.name.trim()) throw new HttpError(400, `Type the space's name, "${space.name}", to confirm.`);
  const check = await deleteCheck(db, blobs, space);
  if (check.sites.length) {
    throw new HttpError(409, `The website${check.sites.length > 1 ? "s" : ""} ${check.sites.map((s) => s.name).join(", ")} show${check.sites.length > 1 ? "" : "s"} this space's docs. Point ${check.sites.length > 1 ? "them" : "it"} at another space in Websites first.`);
  }

  let moved = 0;
  const plans: FullPlan[] = [];
  if (input.moveTo) {
    if (input.moveTo.id === space.id) throw new HttpError(400, "Pick a different space to move the pages to.");
    const roots = await db.select({ id: pages.id }).from(pages).where(and(eq(pages.spaceId, space.id), isNull(pages.parentId)));
    for (const r of roots) plans.push(await planMove(db, blobs, { pageId: r.id, to: input.moveTo, parentPath: input.parentPath ?? null, userId: input.userId }));
    const conflicts = plans.flatMap((p) => p.conflicts);
    const locked = plans.flatMap((p) => p.locked);
    if (conflicts.length || locked.length) assertMovable({ ...plans[0]!, conflicts, locked });
  }

  await db.transaction(async (tx) => {
    for (const plan of plans) {
      await applyMove(tx, plan, input.moveTo!);
      moved += plan.moves.length;
    }
    await tx.update(spaces).set({ deletedAt: new Date(), deletedBy: input.userId }).where(eq(spaces.id, space.id));
  });
  return { moved, purgeAt: new Date(Date.now() + TRASH_DAYS * DAY) };
}

export async function listTrash(db: Db, workspaceId: string) {
  const rows = await db
    .select({ id: spaces.id, slug: spaces.slug, name: spaces.name, visibility: spaces.visibility, deletedAt: spaces.deletedAt, pages: sql<number>`(select count(*)::int from "pages" p where p.space_id = "spaces"."id")` })
    .from(spaces)
    .where(and(eq(spaces.workspaceId, workspaceId), isNotNull(spaces.deletedAt)))
    .orderBy(spaces.deletedAt);
  return rows.map((r) => ({ ...r, purgeAt: new Date(r.deletedAt!.getTime() + TRASH_DAYS * DAY) }));
}

async function trashed(db: Db, workspaceId: string, id: string) {
  const [space] = await db.select().from(spaces).where(and(eq(spaces.id, id), eq(spaces.workspaceId, workspaceId), isNotNull(spaces.deletedAt)));
  if (!space) throw new HttpError(404, "That space isn't in the trash.");
  return space;
}

export async function restoreSpace(db: Db, workspaceId: string, id: string) {
  const space = await trashed(db, workspaceId, id);
  const [row] = await db.update(spaces).set({ deletedAt: null, deletedBy: null }).where(eq(spaces.id, space.id)).returning();
  return row!;
}

/** Deletes a trashed space for good: its pages, history, comments, suggestions and members go with it. */
export async function purgeSpace(db: Db, workspaceId: string, id: string) {
  const space = await trashed(db, workspaceId, id);
  await db.delete(spaces).where(eq(spaces.id, space.id));
}

/** Empties trash older than TRASH_DAYS. Cheap; called lazily from requests. */
export async function purgeExpired(db: Db, workspaceId: string, now = Date.now()) {
  await db.delete(spaces).where(and(eq(spaces.workspaceId, workspaceId), isNotNull(spaces.deletedAt), lt(spaces.deletedAt, new Date(now - TRASH_DAYS * DAY))));
}

/** What the API returns for a preview: the plan without internal rows. */
export function publicPlan(plan: FullPlan): MovePlan {
  const { page: _p, source: _s, parentId: _id, ...rest } = plan;
  return rest;
}
