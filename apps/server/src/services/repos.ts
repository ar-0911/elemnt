import { and, eq } from "drizzle-orm";
import { pages, repoLinks, spaces, suggestions } from "../db/schema.js";
import type { AiClient } from "./ai.js";
import { EDIT_SCHEMA, editorSystemPrompt } from "./ai.js";
import { addComment } from "./comments.js";
import { HttpError } from "./errors.js";
import type { GitHubClient } from "./github.js";
import { getPage, headRevisionId, readRevision, type PageDeps } from "./pages.js";
import { createSuggestion } from "./suggestions.js";

export type RepoLink = typeof repoLinks.$inferSelect;

const MAX_PATCH = 8_000;
const MAX_DIFF = 60_000;

/** Repo paths a page cites through github.com links into the same repo. */
export function citedInSource(source: string, repo: string): string[] {
  const esc = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`github\\.com/${esc}/(?:blob|tree)/[^/\\s)]+/([^\\s)#?"'\\]]+)`, "gi");
  const linked = [...source.matchAll(re)].map((m) => decodeURIComponent(m[1]!));
  // ::snippet and ::filetree name their repo and path as attributes.
  const directives = [...source.matchAll(/::(?:snippet|filetree)(?:\[[^\]]*\])?\{([^}]*)\}/g)].flatMap((m) => {
    const attrs = Object.fromEntries([...m[1]!.matchAll(/([a-z]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    return attrs.repo?.toLowerCase() === repo && attrs.path ? [attrs.path.replace(/^\/+/, "")] : [];
  });
  return [...new Set([...linked, ...directives])];
}

/** A changed file matters if it is a cited path or sits under a cited folder. Nothing cited means everything matters. */
export function relevant(changed: string, cited: string[]): boolean {
  return cited.length === 0 || cited.some((c) => changed === c || changed.startsWith(c.endsWith("/") ? c : `${c}/`));
}

export async function getLink(deps: Pick<PageDeps, "db">, pageId: string) {
  const [link] = await deps.db.select().from(repoLinks).where(eq(repoLinks.pageId, pageId));
  return link;
}

export async function linkRepo(
  deps: Pick<PageDeps, "db">,
  gh: GitHubClient,
  input: { pageId: string; repo: string; branch?: string; commit?: string; citedPaths?: string[]; userId: string },
) {
  const branch = input.branch ?? (await gh.defaultBranch(input.repo));
  const commit = input.commit ?? (await gh.head(input.repo, branch));
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new HttpError(400, "commit must be a commit SHA.");
  const cited = (input.citedPaths ?? []).map((p) => p.replace(/^\/+/, "")).filter(Boolean);
  const values = { repo: input.repo, branch, pinnedCommit: commit, citedPaths: cited, linkedBy: input.userId, checkedCommit: commit, behindBy: 0, changedPaths: [], checkedAt: new Date() };
  await deps.db.insert(repoLinks).values({ pageId: input.pageId, ...values }).onConflictDoUpdate({ target: repoLinks.pageId, set: values });
  return (await getLink(deps, input.pageId))!;
}

export async function unlinkRepo(deps: Pick<PageDeps, "db">, pageId: string) {
  await deps.db.delete(repoLinks).where(eq(repoLinks.pageId, pageId));
}

/** Marks the page current as of `commit` (default: the head seen at the last check). */
export async function pin(deps: Pick<PageDeps, "db">, pageId: string, commit?: string) {
  const link = await getLink(deps, pageId);
  if (!link) throw new HttpError(404, "This page isn't linked to a repo.");
  const to = commit ?? link.checkedCommit ?? link.pinnedCommit;
  await deps.db.update(repoLinks).set({ pinnedCommit: to, checkedCommit: to, behindBy: 0, changedPaths: [] }).where(eq(repoLinks.pageId, pageId));
  return (await getLink(deps, pageId))!;
}

export function driftPrompt(input: { repo: string; from: string; to: string; source: string; diffs: string }): string {
  return `This page explains the repository ${input.repo}. It was written against commit ${input.from}. Since then, files the page covers changed (up to ${input.to}):

<diffs>
${input.diffs}
</diffs>

<page>
${input.source}
</page>

Update the page so it is accurate for ${input.to}. Change only what these diffs make wrong or incomplete, and keep everything else exactly as written. Update github.com links that pin ${input.from} to ${input.to}. If nothing on the page is affected, return the page unchanged. Return the complete page source as "replacement".`;
}

export type DriftOutcome =
  | { status: "current"; behindBy: number }
  | { status: "unchanged"; behindBy: number; changedPaths: string[] }
  | { status: "suggested"; behindBy: number; changedPaths: string[]; suggestionId: string }
  | { status: "commented"; behindBy: number; changedPaths: string[] };

/**
 * The drift check: compare the pinned commit with the branch head and, when
 * cited files changed, open one suggestion on the page (or a comment when the
 * workspace has no Claude key). Read-only toward the repo, and never opens a
 * second drift suggestion while one is still open.
 */
export async function checkDrift(deps: PageDeps, gh: GitHubClient, pageId: string, ai?: AiClient): Promise<DriftOutcome> {
  const link = await getLink(deps, pageId);
  if (!link) throw new HttpError(404, "This page isn't linked to a repo.");
  const page = await getPage(deps.db, pageId);
  const head = headRevisionId(page);
  const source = head ? await readRevision(deps, head, "source") : "";
  const cited = [...new Set([...link.citedPaths, ...citedInSource(source, link.repo)])];

  const cmp = await gh.compare(link.repo, link.pinnedCommit, link.branch);
  const changed = cmp.files.filter((f) => relevant(f.filename, cited) || (f.previousFilename && relevant(f.previousFilename, cited)));
  const changedPaths = changed.map((f) => f.filename);
  const seenBefore = link.checkedCommit === cmp.headSha && link.checkedAt !== null && link.changedPaths.length === changedPaths.length;
  await deps.db.update(repoLinks).set({ checkedCommit: cmp.headSha, behindBy: cmp.aheadBy, changedPaths, checkedAt: new Date() }).where(eq(repoLinks.pageId, pageId));

  if (changed.length === 0 || !head) return { status: "current", behindBy: cmp.aheadBy };
  const open = await deps.db
    .select({ id: suggestions.id })
    .from(suggestions)
    .where(and(eq(suggestions.pageId, pageId), eq(suggestions.origin, "drift"), eq(suggestions.status, "open")));
  if (open.length > 0 || seenBefore) return { status: "unchanged", behindBy: cmp.aheadBy, changedPaths };

  // Drift suggestions are filed under whoever linked the repo.
  const authorId = link.linkedBy;
  if (!authorId) return { status: "unchanged", behindBy: cmp.aheadBy, changedPaths };
  const short = (s: string) => s.slice(0, 7);
  if (!ai) {
    const list = changedPaths.slice(0, 20).map((p) => `- ${p}`).join("\n");
    await addComment(deps.db, {
      pageId,
      authorId,
      revisionId: head,
      body: `Files this page covers changed in ${link.repo} since ${short(link.pinnedCommit)} (now ${short(cmp.headSha)}, ${cmp.aheadBy} commits):\n${list}\n\nAdd a Claude key in Settings to get these as a suggested edit.`,
    });
    return { status: "commented", behindBy: cmp.aheadBy, changedPaths };
  }

  let budget = MAX_DIFF;
  const diffs = changed
    .map((f) => {
      const patch = (f.patch ?? "(binary or too large to show)").slice(0, MAX_PATCH);
      const block = `--- ${f.previousFilename ?? f.filename} (${f.status})\n+++ ${f.filename}\n${patch}`;
      if (budget <= 0) return `--- ${f.filename} (${f.status}, diff omitted)`;
      budget -= block.length;
      return block;
    })
    .join("\n\n");
  const out = await ai.json<{ replacement: string; summary: string }>({
    system: editorSystemPrompt(deps.elemnt.authoringGuide()),
    prompt: driftPrompt({ repo: link.repo, from: link.pinnedCommit, to: cmp.headSha, source, diffs }),
    schema: EDIT_SCHEMA,
  });
  if (out.replacement.trim() === source.trim()) return { status: "unchanged", behindBy: cmp.aheadBy, changedPaths };
  const { id } = await createSuggestion(deps, {
    pageId,
    baseRevisionId: head,
    proposed: out.replacement,
    origin: "drift",
    authorId,
    summary: `${link.repo} ${short(link.pinnedCommit)}→${short(cmp.headSha)}: ${out.summary}`,
  });
  return { status: "suggested", behindBy: cmp.aheadBy, changedPaths, suggestionId: id };
}

/** Pages linked to a repo, for push webhooks, /r/owner/repo and agent search. */
export async function pagesForRepo(deps: Pick<PageDeps, "db">, repo: string) {
  return deps.db
    .select({ pageId: repoLinks.pageId, branch: repoLinks.branch, path: pages.path, title: pages.title, summary: pages.summary, published: pages.publishedRevisionId, spaceSlug: spaces.slug, visibility: spaces.visibility })
    .from(repoLinks)
    .innerJoin(pages, eq(pages.id, repoLinks.pageId))
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(eq(repoLinks.repo, repo));
}
