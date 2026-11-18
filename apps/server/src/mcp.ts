import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Config } from "./lib/config.js";
import { addComment } from "./services/comments.js";
import { HttpError } from "./services/errors.js";
import * as pagesSvc from "./services/pages.js";
import { searchPages } from "./services/search.js";
import { applyEdits, createSuggestion } from "./services/suggestions.js";
import type { GitHubClient } from "./services/github.js";
import { normalizeRepo } from "./services/github.js";
import * as reposSvc from "./services/repos.js";
import * as levelsSvc from "./services/levels.js";
import { libraryGuide, listComponents } from "./services/library.js";
import { canReadSpace, hasRole, type Viewer } from "./services/workspace.js";
import * as themeSvc from "./services/theme.js";
import * as sitesSvc from "./services/sites.js";
import { SITE_DESIGN_GUIDE } from "./sites/guide.js";

/** Components the style guide explains; the rest are in the authoring guide. */
const LAYOUT = ["hero", "cards", "stats", "timeline", "band", "badge", "quote", "graphic", "widget"];

interface McpDeps extends pagesSvc.PageDeps {
  config: Config;
  github: GitHubClient;
  sites?: sitesSvc.SitesDeps;
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/**
 * Elemnt as an MCP server. Claude reads pages as Markdown, learns the component
 * syntax, and writes back only as drafts and suggestions that a person reviews:
 * nothing an agent does goes live on its own.
 */
export function buildMcpServer(deps: McpDeps, ctx: { viewer: Viewer; workspaceId: string }) {
  const server = new McpServer({ name: "elemnt", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const { viewer } = ctx;
  const canEdit = hasRole(viewer, "editor");

  async function space(slug: string) {
    const s = await pagesSvc.findSpace(deps.db, ctx.workspaceId, slug);
    if (!s || !canReadSpace(viewer, s)) throw new HttpError(404, `No space "${slug}". Call list_spaces to see what exists.`);
    return s;
  }
  async function page(spaceSlug: string, path: string) {
    const s = await space(spaceSlug);
    const p = await pagesSvc.findPage(deps.db, s.id, pagesSvc.normalizePath(path));
    if (!p) throw new HttpError(404, `No page "${path}" in ${spaceSlug}. Call list_pages or search.`);
    return { space: s, page: p };
  }
  const reviewUrl = (spaceSlug: string, path: string, suggestion?: string) =>
    `${deps.config.publicUrl}/app/${spaceSlug}/${path}${suggestion ? `?suggestion=${suggestion}` : ""}`;

  /** Turns service errors into tool errors the model can read and act on. */
  const tool =
    <A,>(fn: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await fn(args);
      } catch (err) {
        if (err instanceof HttpError) return fail(err.details?.diagnostics ? `${err.message}\n${JSON.stringify(err.details.diagnostics, null, 2)}` : err.message);
        throw err;
      }
    };

  server.registerTool(
    "list_spaces",
    { title: "List spaces", description: "Lists the documentation spaces in this workspace.", annotations: { readOnlyHint: true } },
    tool(async () => {
      const all = (await deps.db.query.spaces.findMany({ where: (s, { eq }) => eq(s.workspaceId, ctx.workspaceId) })).filter((s) => canReadSpace(viewer, s));
      return text(all.map((s) => ({ slug: s.slug, name: s.name, visibility: s.visibility })));
    }),
  );

  server.registerTool(
    "list_pages",
    { title: "List pages", description: "Lists every page in a space with its path, title, summary and whether it is published or has a pending draft.", inputSchema: { space: z.string() }, annotations: { readOnlyHint: true } },
    tool(async ({ space: slug }: { space: string }) => {
      const s = await space(slug);
      return text(await pagesSvc.listPages(deps.db, s.id));
    }),
  );

  server.registerTool(
    "search",
    {
      title: "Search docs",
      description: "Full-text search over published pages. Supports quoted phrases, OR and -exclusions. Pass a GitHub repo URL or owner/name to find the explainer page for that repo.",
      inputSchema: { query: z.string().max(200), space: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ query, space: slug }: { query: string; space?: string }) => {
      const all = (await deps.db.query.spaces.findMany({ where: (s, { eq }) => eq(s.workspaceId, ctx.workspaceId) })).filter((s) => canReadSpace(viewer, s));
      const ids = all.filter((s) => !slug || s.slug === slug).map((s) => s.id);
      const hits = await searchPages(deps.db, { query, spaceIds: ids, limit: 10 });
      // A repo URL or owner/name finds that repo's explainer pages first.
      let repo: string | undefined;
      try {
        repo = /github\.com\/|^[\w.-]+\/[\w.-]+$/.test(query.trim()) ? normalizeRepo(query) : undefined;
      } catch {
        repo = undefined;
      }
      const linked = repo ? (await reposSvc.pagesForRepo(deps, repo)).filter((p) => p.published && all.some((s) => s.slug === p.spaceSlug && ids.includes(s.id))) : [];
      if (linked.length) {
        return text([
          ...linked.map((p) => ({ space: p.spaceSlug, path: p.path, title: p.title, explains: repo })),
          ...hits.filter((h) => !linked.some((l) => l.path === h.path && l.spaceSlug === h.spaceSlug)).map((h) => ({ space: h.spaceSlug, path: h.path, title: h.title, summary: h.summary })),
        ]);
      }
      return text(hits.map((h) => ({ space: h.spaceSlug, path: h.path, title: h.title, summary: h.summary, snippet: h.snippetHtml?.replace(/<\/?mark>/g, "**") })));
    }),
  );

  server.registerTool(
    "get_page",
    {
      title: "Read a page",
      description:
        'Reads a page. format "markdown" (default) is the published page as plain Markdown, best for answering questions. format "source" is the editable source with Elemnt directives, including any unpublished draft; read it before suggest_edit. level picks an approved rewrite for a newcomer, an engineer or an executive, when the page has one (markdown only).',
      inputSchema: { space: z.string(), path: z.string(), format: z.enum(["markdown", "source"]).default("markdown"), level: z.enum(["newcomer", "engineer", "exec"]).optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ space: slug, path, format, level }: { space: string; path: string; format: "markdown" | "source"; level?: "newcomer" | "engineer" | "exec" }) => {
      const { page: p } = await page(slug, path);
      if (level && format === "markdown") {
        const lv = await levelsSvc.getLevel(deps, p.id, level, false);
        if (!lv) {
          const have = (await levelsSvc.approvedLevels(deps, p.id)).map((l) => l.level);
          return fail(`No approved ${level} version of this page. Available: ${have.join(", ") || "none"}.`);
        }
        return text(`<!-- elemnt: ${slug}/${p.path} reading level ${level}${lv.stale ? " (written for an older revision)" : ""} -->\n${lv.markdown}`);
      }
      const rev = format === "source" ? pagesSvc.headRevisionId(p) : p.publishedRevisionId;
      if (!rev) return fail(format === "markdown" ? "This page isn't published yet. Read it with format \"source\"." : "This page has no content.");
      const body = await pagesSvc.readRevision(deps, rev, format === "source" ? "source" : "markdown");
      return text(`<!-- elemnt: ${slug}/${p.path} revision ${rev}${format === "source" && p.draftRevisionId ? " (draft)" : ""} -->\n${body}`);
    }),
  );

  server.registerTool(
    "get_style_guide",
    {
      title: "Style guide",
      description:
        "How to make a page look and read great: the organization's theme (follow it; if it's locked, don't ask about colours or fonts), the user's saved style, the style presets, frontmatter style options, and the layout components (hero, cards, stats, timeline, graphics). Call it before writing or restyling any page, then ask the user what style and fonts they want unless the theme or their saved style already decides it.",
      annotations: { readOnlyHint: true },
    },
    tool(async () => {
      const [org, mine, library] = await Promise.all([
        themeSvc.getOrgTheme(deps.db, ctx.workspaceId),
        themeSvc.getUserStyle(deps.db, viewer.userId),
        listComponents(deps.db, ctx.workspaceId),
      ]);
      const layoutDocs = LAYOUT.map((name) => deps.elemnt.components.get(name))
        .filter((c) => c !== undefined)
        .map((c) => `### ${c.name}\n\n${c.authoring.doc}\n\n~~~~md\n${c.authoring.snippet}\n~~~~`)
        .join("\n\n");
      return text(themeSvc.styleGuide({ org, mine, layoutDocs, library: libraryGuide(library) }));
    }),
  );

  server.registerTool(
    "save_my_style",
    {
      title: "Save my style",
      description:
        "Saves the style the user picked as their default, so get_style_guide offers it next time and you don't have to ask again. Same keys as the frontmatter style: block (preset, accent, accent2, headingFont, bodyFont, monoFont, background, headings, radius, width, mode). Only do this when the user agrees.",
      inputSchema: { style: z.record(z.string(), z.unknown()).describe("e.g. { preset: \"aurora\", headingFont: \"Space Grotesk\" }") },
    },
    tool(async ({ style }: { style: Record<string, unknown> }) => {
      const saved = await themeSvc.setUserStyle(deps.db, viewer.userId, themeSvc.toPageStyle(style));
      return text({ saved });
    }),
  );

  server.registerTool(
    "get_authoring_guide",
    { title: "Authoring guide", description: "The Elemnt source syntax: Markdown plus directives such as :::callout, :::tabs and :::steps, with an example of each. Read it before writing pages, together with get_style_guide.", annotations: { readOnlyHint: true } },
    tool(async () => text(deps.elemnt.authoringGuide() + libraryGuide(await listComponents(deps.db, ctx.workspaceId)))),
  );

  server.registerTool(
    "validate",
    { title: "Validate source", description: "Checks Elemnt source and returns errors and warnings with line numbers. Nothing is saved.", inputSchema: { source: z.string() }, annotations: { readOnlyHint: true } },
    tool(async ({ source }: { source: string }) => {
      const r = deps.elemnt.compile(source);
      return text({ ok: r.ok, diagnostics: r.diagnostics });
    }),
  );

  server.registerTool(
    "get_runbook",
    {
      title: "Get a runbook",
      description:
        "Reads the runbooks on a page as structured steps (title, commands, expected output, approval gate) so you can run them in order. Before any step with gate \"approve\", stop and ask the user. If output doesn't match expect, stop and report it.",
      inputSchema: { space: z.string(), path: z.string(), id: z.string().optional().describe("Runbook id; omit to list every runbook on the page") },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ space: slug, path, id }: { space: string; path: string; id?: string }) => {
      const { page: p } = await page(slug, path);
      if (!p.publishedRevisionId) return fail("This page isn't published yet; runbooks run from published pages only.");
      const books = deps.elemnt.runbooks(await pagesSvc.readRevision(deps, p.publishedRevisionId, "source"));
      if (!id) return text(books.length ? books : "This page has no runbooks.");
      const book = books.find((b) => b.id === id);
      return book ? text(book) : fail(`No runbook "${id}" here. Runbooks on this page: ${books.map((b) => b.id).join(", ") || "none"}.`);
    }),
  );

  if (canEdit) {
    server.registerTool(
      "create_draft",
      {
        title: "Create a page draft",
        description: "Creates a new page as an unpublished draft. A person reviews and publishes it in Elemnt. Fails if the path is taken; use suggest_edit for existing pages. Start the source with frontmatter (title, summary).",
        inputSchema: { space: z.string(), path: z.string().describe("e.g. deploying, or guides/deploying when the page guides exists"), source: z.string(), message: z.string().optional() },
      },
      tool(async ({ space: slug, path, source, message }: { space: string; path: string; source: string; message?: string }) => {
        const s = await space(slug);
        const created = await pagesSvc.createPage(deps, { spaceId: s.id, path, source, authorId: viewer.userId, message: message ?? "Drafted by Claude", draft: true });
        const p = pagesSvc.normalizePath(path);
        const check = deps.elemnt.compile(source);
        return text({ pageId: created.pageId, status: "draft", review: reviewUrl(slug, p), diagnostics: check.diagnostics });
      }),
    );

    server.registerTool(
      "link_repo",
      {
        title: "Link a repo to a page",
        description:
          "Marks a page as the explainer for a GitHub repo, written against a commit (default: the branch head now). Elemnt then watches the files the page cites (its github.com links plus cited_paths) and suggests edits when they change. Read-only toward the repo. Returns a README card (image with the page title and summary, linking to the page), a small badge and the short URL.",
        inputSchema: {
          space: z.string(),
          path: z.string(),
          repo: z.string().describe("owner/name or a github.com URL"),
          commit: z.string().optional().describe("The commit SHA you read while writing the page"),
          branch: z.string().optional(),
          cited_paths: z.array(z.string()).optional().describe("Repo files or folders the page explains, e.g. src/server/"),
        },
      },
      tool(async (args: { space: string; path: string; repo: string; commit?: string; branch?: string; cited_paths?: string[] }) => {
        const { page: p } = await page(args.space, args.path);
        const repo = normalizeRepo(args.repo);
        const link = await reposSvc.linkRepo(deps, deps.github, { pageId: p.id, repo, userId: viewer.userId, ...(args.commit ? { commit: args.commit } : {}), ...(args.branch ? { branch: args.branch } : {}), ...(args.cited_paths ? { citedPaths: args.cited_paths } : {}) });
        const short = `${deps.config.publicUrl}/r/${repo}`;
        const readmeCard = `<a href="${short}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${short}/card.svg?theme=dark">\n    <img alt="${repo}, explained on Elemnt" src="${short}/card.svg">\n  </picture>\n</a>`;
        return text({ repo, pinnedCommit: link.pinnedCommit, branch: link.branch, readmeCard, readmeBadge: `[![Explained on Elemnt](${short}/badge.svg)](${short})`, shortUrl: short });
      }),
    );

    server.registerTool(
      "suggest_edit",
      {
        title: "Suggest an edit",
        description:
          "Proposes a change to an existing page. It is never applied directly: a person reviews it hunk by hunk. Send either the complete new source, or edits that replace exact text from the current source (read it with get_page format \"source\" first).",
        inputSchema: {
          space: z.string(),
          path: z.string(),
          summary: z.string().describe("One sentence for the reviewer: what changed and why."),
          source: z.string().optional(),
          edits: z.array(z.object({ find: z.string(), replace: z.string() })).optional(),
        },
      },
      tool(async (args: { space: string; path: string; summary: string; source?: string; edits?: { find: string; replace: string }[] }) => {
        if (!args.source === !args.edits) return fail("Send exactly one of source or edits.");
        const { page: p } = await page(args.space, args.path);
        const base = pagesSvc.headRevisionId(p);
        if (!base) return fail("This page has no content yet.");
        const proposed = args.source ?? applyEdits(await pagesSvc.readRevision(deps, base, "source"), args.edits!);
        const { id, check } = await createSuggestion(deps, { pageId: p.id, baseRevisionId: base, proposed, origin: "mcp", authorId: viewer.userId, summary: args.summary });
        return text({ suggestionId: id, review: reviewUrl(args.space, p.path, id), diagnostics: check });
      }),
    );
  }

  server.registerTool(
    "add_comment",
    {
      title: "Comment on a page",
      description: "Adds a comment to a page, optionally anchored to a quote from it. Use for questions or problems you can't fix with an edit.",
      inputSchema: { space: z.string(), path: z.string(), body: z.string().max(5000), quote: z.string().max(500).optional() },
    },
    tool(async ({ space: slug, path, body, quote }: { space: string; path: string; body: string; quote?: string }) => {
      const { page: p } = await page(slug, path);
      const c = await addComment(deps.db, { pageId: p.id, authorId: viewer.userId, body, ...(quote ? { anchor: { exact: quote } } : {}), revisionId: pagesSvc.headRevisionId(p) });
      return text({ commentId: c.id });
    }),
  );


  // ---------- project websites ----------
  const sitesDeps = deps.sites;
  if (sitesDeps) {
    const siteReview = (slug: string, changeset?: string) => `${deps.config.publicUrl}/app/sites/${slug}${changeset ? `?changeset=${changeset}` : ""}`;
    const requireSite = (slug: string) => sitesSvc.requireSite(deps.db, ctx.workspaceId, slug).catch(() => {
      throw new HttpError(404, `No site "${slug}". Call list_sites, or create_site.`);
    });

    server.registerTool(
      "list_sites",
      { title: "List project websites", description: "Lists the workspace's project websites: name, address, linked docs space, repo, and whether they're published.", annotations: { readOnlyHint: true } },
      tool(async () => {
        const all = await sitesSvc.listSites(sitesDeps, ctx.workspaceId);
        const spaceSlugs = new Map((await deps.db.query.spaces.findMany({ where: (s, { eq }) => eq(s.workspaceId, ctx.workspaceId) })).map((s) => [s.id, s.slug]));
        return text(all.map((s) => ({ site: s.slug, name: s.name, url: s.url, docsSpace: s.spaceId ? spaceSlugs.get(s.spaceId) : null, repo: s.repo, published: s.published, unpublishedChanges: s.unpublishedChanges })));
      }),
    );

    server.registerTool(
      "get_site_design_guide",
      {
        title: "Site design guide",
        description: "How project websites work: the files (site.json, Liquid layouts, partials, pages, styles, scripts, assets), template variables, :::section for design inside Markdown, the built-in helpers (search, reveals, tilt, theme toggle) and how to build 3D scenes with three.js. Read it before designing or changing a site.",
        annotations: { readOnlyHint: true },
      },
      tool(async () => text(SITE_DESIGN_GUIDE)),
    );

    server.registerTool(
      "get_site",
      {
        title: "Read a project website",
        description: "A site's settings (site.json), every file with its size, its docs space and pages, open change sets, and its address. Read files with read_site_file.",
        inputSchema: { site: z.string() },
        annotations: { readOnlyHint: true },
      },
      tool(async ({ site }: { site: string }) => {
        const s = await requireSite(site);
        const files = await sitesSvc.listFiles(sitesDeps, s);
        const config = files.some((f) => f.path === "site.json") ? (await sitesSvc.readFile(sitesDeps, s, "site.json")).content : null;
        const space = s.spaceId ? await deps.db.query.spaces.findFirst({ where: (x, { eq }) => eq(x.id, s.spaceId!) }) : undefined;
        const docs = space && canReadSpace(viewer, space) ? (await pagesSvc.listPages(deps.db, space.id)).map((p) => ({ path: p.path, title: p.title, published: p.published })) : [];
        const open = await sitesSvc.listChangesets(sitesDeps, s, "open");
        return text({
          ...sitesSvc.describe(sitesDeps, s),
          docsSpace: space?.slug ?? null,
          docs,
          siteJson: config,
          files: files.map((f) => ({ path: f.path, size: f.size, binary: f.encoding === "base64" })),
          openChangeSets: open.map((c) => ({ id: c.id, summary: c.summary, files: c.changes.map((f) => f.path), review: siteReview(s.slug, c.id) })),
        });
      }),
    );

    server.registerTool(
      "read_site_file",
      { title: "Read a site file", description: "Reads one file of a site's current draft (binary files come back base64).", inputSchema: { site: z.string(), path: z.string() }, annotations: { readOnlyHint: true } },
      tool(async ({ site, path }: { site: string; path: string }) => {
        const f = await sitesSvc.readFile(sitesDeps, await requireSite(site), path);
        return text(f.encoding === "base64" ? { path: f.path, encoding: "base64", content: f.content } : `<!-- elemnt site file: ${f.path} -->\n${f.content}`);
      }),
    );

    if (canEdit) {
      server.registerTool(
        "create_site",
        {
          title: "Create a project website",
          description:
            "Creates a new project website from the starter design (multi-page with top nav, docs layout, 3D hero), unpublished. `space` is the docs space whose pages become /docs; create one first if needed. The site's address is <site>.<sites domain>. Then restyle it with propose_site_changes.",
          inputSchema: {
            site: z.string().describe('Lowercase name, also the subdomain, e.g. "rocket"'),
            name: z.string(),
            space: z.string().optional(),
            repo: z.string().optional().describe("owner/name of the repo the site is about"),
            tagline: z.string().optional(),
            template: z.enum(["starter", "blank"]).default("starter"),
          },
        },
        tool(async (args: { site: string; name: string; space?: string; repo?: string; tagline?: string; template: "starter" | "blank" }) => {
          const created = await sitesSvc.createSite(sitesDeps, ctx.workspaceId, {
            slug: args.site,
            name: args.name,
            template: args.template,
            ...(args.space ? { spaceSlug: args.space } : {}),
            ...(args.repo ? { repo: normalizeRepo(args.repo) } : {}),
            ...(args.tagline ? { tagline: args.tagline } : {}),
          });
          const prev = await sitesSvc.preview(sitesDeps, created, viewer.userId);
          return text({ site: created.slug, status: "unpublished", preview: prev.url, studio: siteReview(created.slug), files: (await sitesSvc.listFiles(sitesDeps, created)).map((f) => f.path) });
        }),
      );

      server.registerTool(
        "propose_site_changes",
        {
          title: "Propose site changes",
          description:
            "Proposes whole-file changes to a site (create, replace, or delete with content null). Nothing changes until a person applies it in the studio. Returns a preview URL showing the site with these changes, plus any template errors to fix. Read files first with read_site_file; send complete file contents.",
          inputSchema: {
            site: z.string(),
            summary: z.string().describe("One line for the reviewer: what changed and why."),
            files: z
              .array(z.object({ path: z.string(), content: z.string().nullable(), encoding: z.enum(["utf8", "base64"]).optional() }))
              .min(1)
              .max(120),
          },
        },
        tool(async (args: { site: string; summary: string; files: { path: string; content: string | null; encoding?: "utf8" | "base64" }[] }) => {
          const s = await requireSite(args.site);
          const cs = await sitesSvc.proposeChanges(sitesDeps, s, { summary: args.summary, files: args.files, authorId: viewer.userId, source: "mcp" });
          const prev = await sitesSvc.previewChangeset(sitesDeps, s, cs.id, viewer.userId);
          return text({ changeSet: cs.id, review: siteReview(s.slug, cs.id), preview: prev.url, diagnostics: prev.diagnostics });
        }),
      );

      server.registerTool(
        "preview_site",
        {
          title: "Preview a site",
          description: "Makes a private preview URL of the site's current draft (with the latest docs) and reports template errors.",
          inputSchema: { site: z.string() },
        },
        tool(async ({ site }: { site: string }) => {
          const s = await requireSite(site);
          const prev = await sitesSvc.preview(sitesDeps, s, viewer.userId);
          return text({ preview: prev.url, diagnostics: prev.diagnostics });
        }),
      );
    }

    server.registerPrompt(
      "design_site",
      {
        title: "Design a project website",
        description: "Design (or redesign) an immersive website for a project: its own look, 3D, and the project's docs inside.",
        argsSchema: { project: z.string().describe("The project, e.g. a repo URL or name"), site: z.string().optional().describe("Existing site to restyle") },
      },
      ({ project, site }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Design a project website for ${project} in Elemnt.${site ? ` Restyle the existing site "${site}".` : " Check list_sites first; create one with create_site if it doesn't exist (and a docs space if needed)."}

Read get_site_design_guide. Learn the project (its repo and README, and its docs with list_pages/get_page). Ask me, in one short message with options, about mood, colours, fonts, how much motion, and what the 3D should show, unless I've already said. Then design it like a polished product site or portfolio for this project: a home page with an interactive 3D scene about what the project actually does, sections that explain it with motion and real details, a showcase, and a docs layout with sidebar, search and table of contents. Keep the words exact and scannable. Propose the files with propose_site_changes, open the preview URL it returns, fix any errors, and give me the review link.`,
            },
          },
        ],
      }),
    );
  }

  server.registerPrompt(
    "generate_docs",
    {
      title: "Generate docs",
      description: "Write an Elemnt page about a topic from this conversation, as a draft for review.",
      argsSchema: { topic: z.string().describe("What the page should explain"), space: z.string().optional().describe("Space slug; defaults to the best match") },
    },
    ({ topic, space: slug }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Write Elemnt documentation about: ${topic}.${slug ? ` Put it in the "${slug}" space.` : " Pick the best space with list_spaces, and say which."}

First search for an existing page on this; if one exists, improve it with suggest_edit instead of creating a duplicate. Call get_style_guide and get_authoring_guide. Unless the organization theme or my saved style already decides it, ask me what style and fonts I'd like before you write. Then write a page that pulls a new teammate in and stays clear: a hero with the promise, a visual near the top of each section, why it matters, then specifics, using steps, tabs, callouts, cards and diagrams where they help. Use only facts from this conversation and from the docs you read; mark anything unknown as TODO. Validate, save with create_draft or suggest_edit, and give me the review link.`,
          },
        },
      ],
    }),
  );

  return server;
}

const INSTRUCTIONS = `Elemnt hosts this team's documentation. Pages are written in Markdown with directives for rich components; people see a rendered page and you get Markdown.

To answer questions, use search, then get_page. To write docs, call get_style_guide and get_authoring_guide once. Follow the organization theme if there is one; otherwise ask the user what style and fonts they'd like (or use their saved style). Pages should look like a designed web page and pull the reader in, while staying exact and easy to scan. Then use create_draft for new pages or suggest_edit for existing ones, and validate first. Your writes are drafts and suggestions that a person reviews before anything is published; share the review link you get back.

Projects can also have their own website (list_sites): a fully designed multi-page site, with 3D and motion, around the project's docs. To build or restyle one, read get_site_design_guide, then use create_site and propose_site_changes; a person applies and publishes.`;

/** Handles one stateless MCP request (Streamable HTTP, JSON responses). */
export async function handleMcp(req: Request, deps: McpDeps, ctx: { viewer: Viewer; workspaceId: string }): Promise<Response> {
  const server = buildMcpServer(deps, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}
