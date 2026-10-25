import { applyPatch, structuredPatch, type StructuredPatch } from "diff";
import { and, desc, eq } from "drizzle-orm";
import { suggestions, users } from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { HttpError } from "./errors.js";
import { getPage, headRevisionId, readRevision, updatePage, type PageDeps } from "./pages.js";

type Origin = (typeof suggestions.$inferSelect)["origin"];

export async function createSuggestion(
  deps: PageDeps,
  input: { pageId: string; baseRevisionId?: string; proposed: string; origin: Origin; authorId: string; summary: string },
) {
  const page = await getPage(deps.db, input.pageId);
  const base = input.baseRevisionId ?? headRevisionId(page);
  if (!base) throw new HttpError(400, "This page has no revisions yet.");
  const current = await readRevision(deps, base, "source");
  if (current === input.proposed) throw new HttpError(422, "The suggestion doesn't change anything.");
  const proposedHash = sha256(input.proposed);
  await deps.blobs.put(proposedHash, input.proposed);
  const id = newId("sug");
  await deps.db.insert(suggestions).values({ id, pageId: page.id, baseRevisionId: base, proposedHash, origin: input.origin, authorId: input.authorId, summary: input.summary.slice(0, 500) });
  return { id, check: deps.elemnt.compile(input.proposed).diagnostics };
}

export async function listSuggestions(deps: Pick<PageDeps, "db">, pageId: string, status: "open" | "all" = "open") {
  return deps.db
    .select({ id: suggestions.id, summary: suggestions.summary, origin: suggestions.origin, status: suggestions.status, baseRevisionId: suggestions.baseRevisionId, createdAt: suggestions.createdAt, authorName: users.name, authorEmail: users.email })
    .from(suggestions)
    .leftJoin(users, eq(users.id, suggestions.authorId))
    .where(status === "open" ? and(eq(suggestions.pageId, pageId), eq(suggestions.status, "open")) : eq(suggestions.pageId, pageId))
    .orderBy(desc(suggestions.createdAt));
}

async function load(deps: PageDeps, id: string) {
  const [s] = await deps.db.select().from(suggestions).where(eq(suggestions.id, id));
  if (!s) throw new HttpError(404, "Suggestion not found.");
  const base = await readRevision(deps, s.baseRevisionId, "source");
  const proposed = await deps.blobs.get(s.proposedHash);
  if (proposed === undefined) throw new Error(`Missing blob ${s.proposedHash}`);
  return { s, base, proposed, patch: structuredPatch("page.md", "page.md", base, proposed, "", "", { context: 3 }) };
}

/** The suggestion with its hunks, and whether the page moved on since it was written. */
export async function getSuggestion(deps: PageDeps, id: string) {
  const { s, patch } = await load(deps, id);
  const page = await getPage(deps.db, s.pageId);
  return {
    suggestion: s,
    stale: headRevisionId(page) !== s.baseRevisionId,
    hunks: patch.hunks.map((h, index) => ({ index, oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines: h.lines })),
  };
}

/**
 * Applies the chosen hunks (all by default) as a new draft. When the page has
 * changed since the suggestion was written, the chosen hunks are rebased onto
 * the current source: a three-way merge that refuses with 409 when the same
 * lines were edited on both sides.
 */
export async function acceptSuggestion(deps: PageDeps, input: { id: string; userId: string; hunks?: number[] }) {
  const { s, base, patch } = await load(deps, input.id);
  if (s.status !== "open") throw new HttpError(409, `This suggestion was already ${s.status}.`);
  const chosen: StructuredPatch = { ...patch, hunks: input.hunks ? patch.hunks.filter((_, i) => input.hunks!.includes(i)) : patch.hunks };
  if (chosen.hunks.length === 0) throw new HttpError(400, "Pick at least one change to apply.");

  const page = await getPage(deps.db, s.pageId);
  const head = headRevisionId(page)!;
  const target = head === s.baseRevisionId ? base : await readRevision(deps, head, "source");
  const merged = applyPatch(target, chosen);
  if (merged === false) {
    throw new HttpError(409, "The page changed in the same places since this suggestion was written. Ask for a fresh suggestion.", { currentRevisionId: head });
  }
  const saved = await updatePage(deps, { pageId: s.pageId, source: merged, baseRevisionId: head, authorId: input.userId, message: `Accepted suggestion: ${s.summary}`, publish: false });
  await deps.db
    .update(suggestions)
    .set({ status: "accepted", decidedBy: input.userId, decidedAt: new Date(), appliedRevisionId: saved.revisionId })
    .where(and(eq(suggestions.id, s.id), eq(suggestions.status, "open")));
  return { ...saved, source: merged, partial: chosen.hunks.length < patch.hunks.length };
}

export async function rejectSuggestion(deps: Pick<PageDeps, "db">, input: { id: string; userId: string }) {
  const updated = await deps.db
    .update(suggestions)
    .set({ status: "rejected", decidedBy: input.userId, decidedAt: new Date() })
    .where(and(eq(suggestions.id, input.id), eq(suggestions.status, "open")))
    .returning({ id: suggestions.id });
  if (updated.length === 0) throw new HttpError(409, "This suggestion isn't open.");
}

/** Replaces exact text spans; for agents that would rather not resend a whole page. */
export function applyEdits(source: string, edits: { find: string; replace: string }[]): string {
  let out = source;
  for (const [i, e] of edits.entries()) {
    const at = out.indexOf(e.find);
    if (e.find === "" || at < 0) throw new HttpError(422, `Edit ${i + 1}: the text to find isn't in the page.`);
    if (out.indexOf(e.find, at + 1) >= 0) throw new HttpError(422, `Edit ${i + 1}: the text to find appears more than once; include more context.`);
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return out;
}
