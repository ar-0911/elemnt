import { count, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { pageViews } from "../db/schema.js";

export async function recordView(db: Db, input: { pageId: string; format: "html" | "markdown"; url: URL; referrer: string | undefined }) {
  let referrerHost: string | null = null;
  try {
    referrerHost = input.referrer ? new URL(input.referrer).host : null;
  } catch {
    referrerHost = null;
  }
  await db.insert(pageViews).values({
    pageId: input.pageId,
    format: input.format,
    utmSource: input.url.searchParams.get("utm_source")?.slice(0, 64) ?? null,
    utmCampaign: input.url.searchParams.get("utm_campaign")?.slice(0, 128) ?? null,
    referrerHost,
  });
}

/** Views per format and source; `direct` when there was no UTM tag. */
export async function pageStats(db: Db, pageId: string) {
  const source = sql<string>`coalesce(${pageViews.utmSource}, 'direct')`;
  const rows = await db
    .select({ format: pageViews.format, source, views: count() })
    .from(pageViews)
    .where(eq(pageViews.pageId, pageId))
    .groupBy(pageViews.format, source);
  const total = rows.reduce((n, r) => n + Number(r.views), 0);
  return { total, breakdown: rows.map((r) => ({ ...r, views: Number(r.views) })) };
}
