import type { AiClient } from "./ai.js";
import { HttpError } from "./errors.js";
import { outline, pickFiles } from "./explain.js";
import type { GitHubClient } from "./github.js";
import { createPage, findPage, normalizePath, type PageDeps } from "./pages.js";
import * as sitesSvc from "./sites.js";
import { SITE_DESIGN_GUIDE } from "../sites/guide.js";

/**
 * "Build my site from this repo": Claude reads the repository and the site's
 * current files, then designs the whole site (layouts, home page, 3D scene,
 * styles) as one change set, and drafts the docs pages in the site's space.
 * Nothing goes live: a person reviews the change set and publishes.
 */

const MAX_FILE = 10_000;
const MAX_TOTAL = 120_000;
const MAX_SITE_FILE = 20_000;

export const GENERATE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One line for the reviewer describing the design." },
    files: {
      type: "array",
      description: "Complete site files to create or replace (site.json, layouts/, partials/, pages/, styles/, scripts/).",
      items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false },
    },
    docs: {
      type: "array",
      description: "Docs pages for the site's space, in Elemnt Markdown with frontmatter (title, summary). Paths are slugs like getting-started.",
      items: { type: "object", properties: { path: { type: "string" }, source: { type: "string" } }, required: ["path", "source"], additionalProperties: false },
    },
  },
  required: ["summary", "files", "docs"],
  additionalProperties: false,
} as const;

interface Generated {
  summary: string;
  files: { path: string; content: string }[];
  docs: { path: string; source: string }[];
}

export async function generateSite(
  deps: PageDeps & { sites: sitesSvc.SitesDeps },
  gh: GitHubClient,
  ai: AiClient,
  input: { site: sitesSvc.Site; repo?: string; brief?: string; userId: string },
) {
  const { site } = input;
  const repo = input.repo ?? site.repo;
  if (!repo) throw new HttpError(400, "Which repo is this site about? Set the site's repo or pass one.");

  const info = await gh.info(repo);
  const commit = await gh.head(repo, info.defaultBranch);
  const tree = await gh.tree(repo, commit);
  let total = 0;
  const repoFiles: string[] = [];
  for (const path of pickFiles(tree.entries)) {
    if (total >= MAX_TOTAL) break;
    const text = await gh.file(repo, commit, path).catch(() => undefined);
    if (!text || text.includes("\u0000")) continue;
    const cut = text.length > MAX_FILE ? `${text.slice(0, MAX_FILE)}\n… (truncated)` : text;
    repoFiles.push(`<file path="${path}">\n${cut}\n</file>`);
    total += cut.length;
  }

  const current = await sitesSvc.listFiles(deps.sites, site);
  const siteFiles: string[] = [];
  for (const f of current) {
    if (f.encoding !== "utf8" || f.size > MAX_SITE_FILE) {
      siteFiles.push(`<site-file path="${f.path}" binary="true" />`);
      continue;
    }
    siteFiles.push(`<site-file path="${f.path}">\n${(await sitesSvc.readFile(deps.sites, site, f.path)).content}\n</site-file>`);
  }
  const space = site.spaceId ? await deps.db.query.spaces.findFirst({ where: (s, { eq }) => eq(s.id, site.spaceId!) }) : undefined;
  const existingDocs = space ? await deps.db.query.pages.findMany({ where: (p, { eq }) => eq(p.spaceId, space.id) }) : [];

  const system = `You are a senior product designer and front-end engineer. You design immersive, interactive project websites in Elemnt and write their docs.\n\n${SITE_DESIGN_GUIDE}\n\nElemnt Markdown components for docs pages:\n\n${deps.elemnt.authoringGuide()}`;
  const prompt = `Design the website for ${repo} (${info.url}).${info.description ? ` Description: ${info.description}.` : ""}${info.homepage ? ` Homepage: ${info.homepage}.` : ""}

<brief>
${input.brief?.trim() || "Make it feel like a polished product site or portfolio for this project: dark by default, bold typography, an interactive three.js scene on the home page that shows what the project actually does, motion on scroll, and docs that are easy to scan."}
</brief>

<repo-tree>
${outline(tree.entries)}
</repo-tree>

${repoFiles.join("\n\n")}

These are the site's current files (the starter design unless someone changed it). Keep what works, replace what doesn't:

${siteFiles.join("\n\n")}

Existing docs pages in the site's space: ${existingDocs.map((p) => p.path).join(", ") || "none"}.

Return:
- "files": every site file you create or change, complete. At least site.json (with the real name, tagline, nav, data), the layouts, the home page, a showcase page, styles/site.css and a scripts/ file with a three.js scene specific to this project. Keep site.json valid JSON.
- "docs": 3 to 6 docs pages for the space that don't exist yet (getting-started first), each with frontmatter title and summary, using only facts from the repo files above. Use :::section only with partials you include in "files".
- "summary": one line.
Every fact must come from the repo files. Don't invent commands, numbers or URLs.`;

  const out = await ai.json<Generated>({ system, prompt, schema: GENERATE_SCHEMA, effort: "high", maxTokens: 64000 });
  const files = out.files.filter((f) => f.path && typeof f.content === "string");
  if (!files.length) throw new HttpError(422, "Claude didn't return any site files. Try again with a more specific brief.");
  const cs = await sitesSvc.proposeChanges(deps.sites, site, { summary: out.summary || `Site design for ${repo}`, files, authorId: input.userId, source: "generate" });

  const drafted: string[] = [];
  if (space) {
    for (const d of out.docs.slice(0, 8)) {
      let path: string;
      try {
        path = normalizePath(d.path);
      } catch {
        continue;
      }
      if (await findPage(deps.db, space.id, path)) continue;
      if (path.includes("/") && !(await findPage(deps.db, space.id, path.slice(0, path.lastIndexOf("/"))))) continue;
      await createPage(deps, { spaceId: space.id, path, source: d.source, authorId: input.userId, message: `Drafted by Claude for the ${site.name} site`, draft: true });
      drafted.push(path);
    }
  }
  const preview = await sitesSvc.previewChangeset(deps.sites, site, cs.id, input.userId);
  return { changeset: cs.id, summary: cs.summary, preview: preview.url, diagnostics: preview.diagnostics, docs: drafted, space: space?.slug ?? null, commit };
}
