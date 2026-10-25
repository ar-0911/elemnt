import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { pageQuestions, sectionStats } from "../db/schema.js";
import { sectionsOf } from "./ask.js";

/**
 * The confusion heatmap. Readers' browsers report, once per visit, how long
 * each section was on screen and where they left; questions come from Ask
 * the page. Only per-section counters are stored, nothing about the reader.
 */

const MAX_SECTION_MS = 30 * 60 * 1000;

export interface Signals {
  sections: Record<string, number>;
  exit?: string | null;
  source?: string;
}

export async function recordSignals(db: Db, pageId: string, s: Signals) {
  const source = (s.source ?? "direct").replace(/[^a-z0-9_.-]/gi, "").slice(0, 64) || "direct";
  const entries = Object.entries(s.sections)
    .filter(([id, ms]) => /^[\p{L}\p{N}-]{1,90}$/u.test(id) && Number.isFinite(ms) && ms > 0)
    .slice(0, 60);
  if (s.exit && !entries.some(([id]) => id === s.exit) && /^[\p{L}\p{N}-]{1,90}$/u.test(s.exit)) entries.push([s.exit, 0]);
  for (const [section, ms] of entries) {
    const dwell = Math.min(MAX_SECTION_MS, Math.round(ms));
    // A section counts as read once it was on screen for a second.
    const viewed = dwell >= 1000 ? 1 : 0;
    const exited = s.exit === section ? 1 : 0;
    await db
      .insert(sectionStats)
      .values({ pageId, source, section, views: viewed, dwellMs: dwell, exits: exited })
      .onConflictDoUpdate({
        target: [sectionStats.pageId, sectionStats.source, sectionStats.section],
        set: { views: sql`${sectionStats.views} + ${viewed}`, dwellMs: sql`${sectionStats.dwellMs} + ${dwell}`, exits: sql`${sectionStats.exits} + ${exited}` },
      });
  }
}

export async function pageInsights(db: Db, input: { pageId: string; html: string; source?: string }) {
  const sections = sectionsOf(input.html);
  const statWhere = input.source ? and(eq(sectionStats.pageId, input.pageId), eq(sectionStats.source, input.source)) : eq(sectionStats.pageId, input.pageId);
  const stats = await db
    .select({ section: sectionStats.section, views: sql<number>`sum(${sectionStats.views})::int`, dwellMs: sql<number>`sum(${sectionStats.dwellMs})::bigint`, exits: sql<number>`sum(${sectionStats.exits})::int` })
    .from(sectionStats)
    .where(statWhere)
    .groupBy(sectionStats.section);
  const qWhere = input.source ? and(eq(pageQuestions.pageId, input.pageId), eq(pageQuestions.source, input.source)) : eq(pageQuestions.pageId, input.pageId);
  const qs = await db
    .select({ section: pageQuestions.section, questions: sql<number>`count(*)::int`, gaps: sql<number>`count(*) filter (where ${pageQuestions.gap})::int` })
    .from(pageQuestions)
    .where(qWhere)
    .groupBy(pageQuestions.section);
  const sources = await db.selectDistinct({ source: sectionStats.source }).from(sectionStats).where(eq(sectionStats.pageId, input.pageId));

  const byId = new Map(stats.map((r) => [r.section, r]));
  const qById = new Map(qs.map((r) => [r.section ?? "", r]));
  const readers = Math.max(1, ...stats.map((r) => Number(r.views)));
  const rows = sections.map((s) => {
    const st = byId.get(s.id);
    const q = qById.get(s.id);
    const views = Number(st?.views ?? 0);
    const exits = Number(st?.exits ?? 0);
    const questions = Number(q?.questions ?? 0);
    const gaps = Number(q?.gaps ?? 0);
    const avgSeconds = views ? Math.round(Number(st?.dwellMs ?? 0) / views / 1000) : 0;
    // Confusion: questions (gaps count double) and readers leaving here, relative to readers who got here.
    const confusion = (questions + gaps + exits) / Math.max(1, views);
    return { id: s.id, title: s.title, views, reach: views / readers, avgSeconds, exits, questions, gaps, confusion: Math.round(confusion * 100) / 100 };
  });
  const unplaced = qById.get("");
  return {
    sections: rows,
    questionsWithoutSection: Number(unplaced?.questions ?? 0),
    sources: sources.map((s) => s.source).sort(),
  };
}
