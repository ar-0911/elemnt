import { and, desc, eq, inArray } from "drizzle-orm";
import { slugify } from "@elemnt/core";
import { pageQuestions, spaces } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import type { AiClient } from "./ai.js";
import { EDIT_SCHEMA, editorSystemPrompt } from "./ai.js";
import { HttpError } from "./errors.js";
import { getPage, headRevisionId, readRevision, type PageDeps } from "./pages.js";
import { searchPages } from "./search.js";
import { createSuggestion } from "./suggestions.js";

/**
 * Ask the page. A reader's question is answered from the page and its
 * neighbours, in Elemnt source so the answer can use a diagram or steps.
 * Every question is kept: gaps become suggestions, and where questions
 * cluster feeds the confusion heatmap.
 */

export const ASK_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "The answer as Elemnt source (Markdown plus components). Short: a few sentences, plus a diagram, steps or a worked example only when it helps." },
    covered: { type: "boolean", description: "True if the page (or the related pages) contains what the answer needed. False if you had to say the docs don't cover it." },
    section: { type: ["string", "null"], description: "The id of the page section the question is about (from the section list), or null." },
    sources: { type: "array", items: { type: "string" }, description: "Paths of related pages you used, as given." },
  },
  required: ["answer", "covered", "section", "sources"],
  additionalProperties: false,
} as const;

export interface AskResult {
  answer: string;
  covered: boolean;
  section: string | null;
  sources: string[];
}

export function askSystemPrompt(guide: string): string {
  return `You answer readers' questions about one documentation page in Elemnt, in a panel beside the page.

Answer only from the page and the related pages you are given. If they don't contain the answer, say so plainly in one sentence ("This page doesn't cover …"), suggest where the reader might look, and set covered to false. Never invent commands, numbers, URLs or product behaviour.

Write the answer as Elemnt source: Markdown plus the components below. Keep it short. Use a component only when it makes the answer clearer: a :::diagram for a flow, :::steps for a procedure, a worked example in a code block, an :::explore with :var and :calc to show how a number changes. Don't use :::widget, :::runbook or :query. No frontmatter, no top-level heading.

${guide}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s);

export function askPrompt(input: { title: string; markdown: string; sections: { id: string; title: string }[]; related: { path: string; title: string; markdown: string }[]; question: string; quote?: string }): string {
  const related = input.related.map((r) => `<related path="${r.path}" title="${r.title}">\n${clip(r.markdown, 6000)}\n</related>`).join("\n");
  return `<page title="${input.title}">
${clip(input.markdown, 40_000)}
</page>

Sections (id: title):
${input.sections.map((s) => `${s.id}: ${s.title}`).join("\n") || "(none)"}

${related}

${input.quote ? `The reader selected this text: "${input.quote}"\n\n` : ""}Question: ${input.question}`;
}

/**
 * h2/h3 ids and titles from stored HTML. Revisions stored before headings had
 * ids get the same slugs the reader runtime gives them.
 */
export function sectionsOf(html: string): { id: string; title: string }[] {
  const seen = new Map<string, number>();
  return [...html.matchAll(/<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g)].map((m) => {
    const title = m[3]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
    const given = m[2]?.match(/\sid="([^"]+)"/)?.[1];
    if (given) return { id: given, title };
    const base = slugify(title);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n > 1 ? `${base}-${n}` : base, title };
  });
}

export async function askPage(
  deps: PageDeps,
  ai: AiClient,
  input: { pageId: string; question: string; quote?: string; source: string; askerId?: string; spaceIds: string[] },
) {
  const page = await getPage(deps.db, input.pageId);
  if (!page.publishedRevisionId) throw new HttpError(404, "This page isn't published.");
  const [markdown, html] = await Promise.all([readRevision(deps, page.publishedRevisionId, "markdown"), readRevision(deps, page.publishedRevisionId, "html")]);
  const sections = sectionsOf(html);
  const hits = (await searchPages(deps.db, { query: input.question.split(/\s+/).slice(0, 12).join(" OR "), spaceIds: input.spaceIds, limit: 4 }).catch(() => [])).filter((h) => h.pageId !== page.id).slice(0, 3);
  const related = await Promise.all(
    hits.map(async (h) => {
      const p = await getPage(deps.db, h.pageId);
      return { path: `${h.spaceSlug}/${h.path}`, title: h.title, markdown: await readRevision(deps, p.publishedRevisionId!, "markdown") };
    }),
  );
  const out = await ai.json<AskResult>({
    system: askSystemPrompt(deps.elemnt.authoringGuide()),
    prompt: askPrompt({ title: page.title, markdown, sections, related, question: input.question, ...(input.quote ? { quote: input.quote } : {}) }),
    schema: ASK_SCHEMA,
    effort: "low",
    maxTokens: 8000,
  });
  const section = out.section && sections.some((s) => s.id === out.section) ? out.section : null;
  const id = newId("q");
  await deps.db.insert(pageQuestions).values({
    id,
    pageId: page.id,
    revisionId: page.publishedRevisionId,
    question: input.question,
    quote: input.quote ?? null,
    section,
    answer: out.answer,
    gap: !out.covered,
    source: input.source,
    askerId: input.askerId ?? null,
  });
  return { id, html: renderAnswer(deps, out.answer), covered: out.covered, section, sources: out.sources.filter((s) => related.some((r) => r.path === s)) };
}

/** Compiles an answer for display; a broken answer falls back to escaped text. */
export function renderAnswer(deps: Pick<PageDeps, "elemnt">, answer: string): string {
  const r = deps.elemnt.compile(answer);
  if (r.ok) return r.html;
  return answer
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)}</p>`)
    .join("");
}

export async function listQuestions(deps: Pick<PageDeps, "db">, pageId: string, status: "open" | "all" = "open") {
  return deps.db
    .select({ id: pageQuestions.id, question: pageQuestions.question, quote: pageQuestions.quote, section: pageQuestions.section, answer: pageQuestions.answer, gap: pageQuestions.gap, source: pageQuestions.source, status: pageQuestions.status, createdAt: pageQuestions.createdAt })
    .from(pageQuestions)
    .where(status === "open" ? and(eq(pageQuestions.pageId, pageId), eq(pageQuestions.status, "open")) : eq(pageQuestions.pageId, pageId))
    .orderBy(desc(pageQuestions.createdAt))
    .limit(200);
}

export async function resolveQuestions(deps: Pick<PageDeps, "db">, pageId: string, ids: string[]) {
  if (ids.length) await deps.db.update(pageQuestions).set({ status: "resolved" }).where(and(eq(pageQuestions.pageId, pageId), inArray(pageQuestions.id, ids)));
}

/** Turns readers' questions into one suggested edit that answers them on the page itself. */
export async function suggestFromQuestions(deps: PageDeps, ai: AiClient, input: { pageId: string; ids: string[]; userId: string }) {
  const page = await getPage(deps.db, input.pageId);
  const head = headRevisionId(page);
  if (!head) throw new HttpError(400, "This page has no content yet.");
  const qs = (await listQuestions(deps, page.id, "all")).filter((q) => input.ids.includes(q.id));
  if (qs.length === 0) throw new HttpError(400, "Pick at least one question.");
  const source = await readRevision(deps, head, "source");
  const list = qs.map((q, i) => `${i + 1}. ${q.question}${q.quote ? ` (about: "${q.quote}")` : ""}\n   Answer readers were given: ${q.answer.replace(/\n+/g, " ").slice(0, 1500)}`).join("\n");
  const out = await ai.json<{ replacement: string; summary: string }>({
    system: editorSystemPrompt(deps.elemnt.authoringGuide()),
    prompt: `Readers of this page asked these questions:\n\n${list}\n\n<page>\n${source}\n</page>\n\nRevise the page so a reader finds these answers on the page itself, in the section where they'd look for them. Use the answers only where the page supports them; where the page lacked the facts, add a clearly marked TODO for the author instead of inventing them. Keep everything else as written. Return the complete page source as "replacement".`,
    schema: EDIT_SCHEMA,
  });
  const { id } = await createSuggestion(deps, { pageId: page.id, baseRevisionId: head, proposed: out.replacement, origin: "ask", authorId: input.userId, summary: `From ${qs.length} reader question${qs.length === 1 ? "" : "s"}: ${out.summary}` });
  await resolveQuestions(deps, page.id, qs.map((q) => q.id));
  return { suggestionId: id };
}

/** Spaces a reader can ground answers in: the page's own space, plus every space for members. */
export async function groundingSpaces(deps: Pick<PageDeps, "db">, workspaceId: string, pageSpaceId: string, isMember: boolean) {
  if (!isMember) return [pageSpaceId];
  const all = await deps.db.select({ id: spaces.id }).from(spaces).where(eq(spaces.workspaceId, workspaceId));
  return all.map((s) => s.id);
}
