import { and, eq } from "drizzle-orm";
import { pageLevels, readingLevels, type ReadingLevel } from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import type { AiClient } from "./ai.js";
import { editorSystemPrompt } from "./ai.js";
import { HttpError } from "./errors.js";
import { getPage, readRevision, type PageDeps } from "./pages.js";

/**
 * Reading levels: one page, rewritten for a newcomer, an engineer or an
 * executive. Claude writes each version from the published page, an editor
 * approves it, and readers pick a level. The original stays the default.
 */

export const LEVELS: Record<ReadingLevel, { label: string; brief: string }> = {
  newcomer: {
    label: "New here",
    brief: "someone new to the team or the field. Define every term on first use (a :term works well), explain why before how, add a short analogy or a diagram where the concept is abstract, and keep the steps complete. Longer than the original is fine.",
  },
  engineer: {
    label: "Engineer",
    brief: "an engineer who already knows the domain and wants to act. Lead with the commands, interfaces, limits and edge cases. Cut background and motivation to a sentence. Keep every code block, value and caveat exact.",
  },
  exec: {
    label: "Exec",
    brief: "an executive deciding or approving something. Open with the bottom line in two sentences, then what it costs, the risks, and what is being asked of them. Under 250 words. No code, commands or jargon; keep the numbers.",
  },
};

export const LEVEL_SCHEMA = {
  type: "object",
  properties: { source: { type: "string", description: "The complete rewritten page source, starting with the same frontmatter title." } },
  required: ["source"],
  additionalProperties: false,
} as const;

export const isLevel = (s: string): s is ReadingLevel => (readingLevels as readonly string[]).includes(s);

async function store(deps: Pick<PageDeps, "blobs">, body: string) {
  const hash = sha256(body);
  await deps.blobs.put(hash, body);
  return hash;
}

export async function saveLevel(deps: PageDeps, input: { pageId: string; level: ReadingLevel; source: string; baseRevisionId: string; userId: string }) {
  const result = deps.elemnt.compile(input.source);
  if (!result.ok) throw new HttpError(422, "This version has errors.", { diagnostics: result.diagnostics });
  if (result.widgets.length) throw new HttpError(422, "Reading levels can't contain widgets; describe them instead.");
  const [sourceHash, htmlHash, markdownHash] = await Promise.all([store(deps, input.source), store(deps, result.html), store(deps, result.markdown)]);
  const values = { baseRevisionId: input.baseRevisionId, sourceHash, htmlHash, markdownHash, status: "pending" as const, createdBy: input.userId, approvedBy: null, updatedAt: new Date() };
  await deps.db.insert(pageLevels).values({ pageId: input.pageId, level: input.level, ...values }).onConflictDoUpdate({ target: [pageLevels.pageId, pageLevels.level], set: values });
}

export async function generateLevel(deps: PageDeps, ai: AiClient, input: { pageId: string; level: ReadingLevel; userId: string }) {
  const page = await getPage(deps.db, input.pageId);
  if (!page.publishedRevisionId) throw new HttpError(400, "Publish the page first; reading levels are written from the published version.");
  const source = await readRevision(deps, page.publishedRevisionId, "source");
  const system = editorSystemPrompt(deps.elemnt.authoringGuide());
  const ask = (extra = "") =>
    ai.json<{ source: string }>({
      system,
      prompt: `<page>\n${source}\n</page>\n\nRewrite this page for ${LEVELS[input.level].brief}\n\nKeep every fact accurate to the original and add none. Keep the frontmatter title; you may change the summary. Don't use :::widget. Return the complete page source as "source".${extra}`,
      schema: LEVEL_SCHEMA,
    });
  let out = await ask();
  const check = deps.elemnt.compile(out.source);
  if (!check.ok) {
    const errs = check.diagnostics.filter((d) => d.severity === "error").map((d) => `line ${d.line}: ${d.message}`).join("\n");
    out = await ask(`\n\nYour previous version had these errors; avoid them:\n${errs}`);
  }
  await saveLevel(deps, { pageId: page.id, level: input.level, source: out.source, baseRevisionId: page.publishedRevisionId, userId: input.userId });
  return getLevel(deps, page.id, input.level, true);
}

export async function listLevels(deps: Pick<PageDeps, "db">, pageId: string) {
  const page = await getPage(deps.db, pageId);
  const rows = await deps.db.select().from(pageLevels).where(eq(pageLevels.pageId, pageId));
  return rows.map((r) => ({ level: r.level, label: LEVELS[r.level].label, status: r.status, stale: r.baseRevisionId !== page.publishedRevisionId, updatedAt: r.updatedAt }));
}

export async function getLevel(deps: PageDeps, pageId: string, level: ReadingLevel, includePending: boolean) {
  const [row] = await deps.db.select().from(pageLevels).where(and(eq(pageLevels.pageId, pageId), eq(pageLevels.level, level)));
  if (!row || (row.status !== "approved" && !includePending)) return undefined;
  const page = await getPage(deps.db, pageId);
  const read = async (h: string) => (await deps.blobs.get(h)) ?? "";
  return {
    level,
    label: LEVELS[level].label,
    status: row.status,
    stale: row.baseRevisionId !== page.publishedRevisionId,
    source: await read(row.sourceHash),
    html: await read(row.htmlHash),
    markdown: await read(row.markdownHash),
  };
}

export async function approveLevel(deps: Pick<PageDeps, "db">, pageId: string, level: ReadingLevel, userId: string) {
  const res = await deps.db.update(pageLevels).set({ status: "approved", approvedBy: userId, updatedAt: new Date() }).where(and(eq(pageLevels.pageId, pageId), eq(pageLevels.level, level))).returning();
  if (!res.length) throw new HttpError(404, "Generate this level first.");
}

export async function deleteLevel(deps: Pick<PageDeps, "db">, pageId: string, level: ReadingLevel) {
  await deps.db.delete(pageLevels).where(and(eq(pageLevels.pageId, pageId), eq(pageLevels.level, level)));
}

/** Approved levels readers can switch to. */
export async function approvedLevels(deps: Pick<PageDeps, "db">, pageId: string) {
  const rows = await deps.db.select({ level: pageLevels.level }).from(pageLevels).where(and(eq(pageLevels.pageId, pageId), eq(pageLevels.status, "approved")));
  return readingLevels.filter((l) => rows.some((r) => r.level === l)).map((l) => ({ level: l, label: LEVELS[l].label }));
}
