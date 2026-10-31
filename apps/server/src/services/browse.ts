import { resolveStyle, type OrgTheme } from "@elemnt/core";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { pages, repoLinks, revisions } from "../db/schema.js";

/**
 * What a reader needs to move between the published pages of a space: the
 * landing page's cards, the "Pages" menu, and "Keep reading" under each page.
 */

export interface BrowsePage {
  path: string;
  title: string;
  summary: string | null;
  updatedAt: Date;
  /** Rough reading time from the published text, at 220 words a minute. */
  minutes: number;
  /** "owner/name" for explainer pages linked to a GitHub repo. */
  repo?: string;
  /** The page's own accent colours, so each card looks like the page it opens. */
  accent: { light: [string, string]; dark: [string, string] };
}

export async function publishedPages(db: Db, spaceId: string, org: OrgTheme | null): Promise<BrowsePage[]> {
  const rows = await db
    .select({
      id: pages.id,
      path: pages.path,
      title: pages.title,
      summary: pages.summary,
      position: pages.position,
      updatedAt: pages.updatedAt,
      words: sql<number>`coalesce(array_length(regexp_split_to_array(trim(${pages.searchText}), '\\s+'), 1), 0)`,
      style: revisions.style,
    })
    .from(pages)
    .innerJoin(revisions, eq(revisions.id, pages.publishedRevisionId))
    .where(and(eq(pages.spaceId, spaceId), isNotNull(pages.publishedRevisionId)))
    .orderBy(asc(pages.position), asc(pages.path));
  if (!rows.length) return [];

  const links = await db.select({ pageId: repoLinks.pageId, repo: repoLinks.repo }).from(repoLinks).where(inArray(repoLinks.pageId, rows.map((r) => r.id)));
  const repoOf = new Map(links.map((l) => [l.pageId, l.repo]));

  return rows.map((r) => {
    const look = resolveStyle(org, r.style ?? null);
    const repo = repoOf.get(r.id);
    return {
      path: r.path,
      title: r.title,
      summary: r.summary,
      updatedAt: new Date(r.updatedAt),
      minutes: Math.max(1, Math.round(Number(r.words) / 220)),
      ...(repo ? { repo } : {}),
      accent: { light: [look.light.accent, look.light.accent2], dark: [look.dark.accent, look.dark.accent2] },
    };
  });
}

/** The pages before and after `path` in reading order, and up to `limit` others to read next. */
export function neighbours(list: BrowsePage[], path: string, limit = 4) {
  const i = list.findIndex((p) => p.path === path);
  if (i < 0) return { more: list.slice(0, limit) };
  // Start with the pages that follow this one, then wrap around, so each page suggests something different.
  const more = [...list.slice(i + 1), ...list.slice(0, i)].slice(0, limit);
  return { ...(i > 0 ? { prev: list[i - 1] } : {}), ...(i < list.length - 1 ? { next: list[i + 1] } : {}), more };
}
