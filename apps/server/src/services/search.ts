import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { pages, spaces } from "../db/schema.js";

/**
 * Full-text search over published pages in the given spaces. Postgres
 * `websearch_to_tsquery` accepts what people type ("deploy -staging", quotes).
 * Semantic search with pgvector comes later on the same table.
 */
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** ts_headline doesn't escape, so highlight with sentinel marks, escape, then swap in <mark>. */
function safeSnippet(raw: string): string {
  return escape(raw).replaceAll("\u00ab\u00ab", "<mark>").replaceAll("\u00bb\u00bb", "</mark>");
}

export async function searchPages(db: Db, input: { query: string; spaceIds: string[]; limit?: number }) {
  if (input.spaceIds.length === 0 || !input.query.trim()) return [];
  const rows = await runSearch(db, input);
  return rows.map((r) => ({ ...r, snippetHtml: safeSnippet(r.snippet), snippet: undefined }));
}

async function runSearch(db: Db, input: { query: string; spaceIds: string[]; limit?: number }) {
  const doc = sql`to_tsvector('english', ${pages.title} || ' ' || ${pages.searchText})`;
  const q = sql`websearch_to_tsquery('english', ${input.query})`;
  const rank = sql<number>`ts_rank(${doc}, ${q})`;
  return db
    .select({
      pageId: pages.id,
      title: pages.title,
      path: pages.path,
      summary: pages.summary,
      spaceSlug: spaces.slug,
      spaceName: spaces.name,
      rank,
      snippet: sql<string>`ts_headline('english', ${pages.searchText}, ${q}, 'StartSel=««, StopSel=»», MaxWords=30, MinWords=10, MaxFragments=2')`,
    })
    .from(pages)
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(and(inArray(pages.spaceId, input.spaceIds), isNotNull(pages.publishedRevisionId), sql`${doc} @@ ${q}`))
    .orderBy(desc(rank))
    .limit(input.limit ?? 20);
}
