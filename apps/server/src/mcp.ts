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
import { hasRole, type Viewer } from "./services/workspace.js";

interface McpDeps extends pagesSvc.PageDeps {
  config: Config;
  github: GitHubClient;
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
    if (!s) throw new HttpError(404, `No space "${slug}". Call list_spaces to see what exists.`);
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
      const all = await deps.db.query.spaces.findMany({ where: (s, { eq }) => eq(s.workspaceId, ctx.workspaceId) });
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
      const all = await deps.db.query.spaces.findMany({ where: (s, { eq }) => eq(s.workspaceId, ctx.workspaceId) });
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
    "get_authoring_guide",
    { title: "Authoring guide", description: "The Elemnt source syntax: Markdown plus directives such as :::callout, :::tabs and :::steps, with an example of each. Read it before writing pages.", annotations: { readOnlyHint: true } },
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
          "Marks a page as the explainer for a GitHub repo, written against a commit (default: the branch head now). Elemnt then watches the files the page cites (its github.com links plus cited_paths) and suggests edits when they change. Read-only toward the repo. Returns the README badge and short URL.",
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
        return text({ repo, pinnedCommit: link.pinnedCommit, branch: link.branch, readmeBadge: `[![Explained on Elemnt](${short}/badge.svg)](${short})`, shortUrl: short });
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

First search for an existing page on this; if one exists, improve it with suggest_edit instead of creating a duplicate. Call get_authoring_guide, then write for a new teammate: why it matters, then specifics, using steps, tabs, callouts and diagrams where they help. Use only facts from this conversation and from the docs you read; mark anything unknown as TODO. Validate, save with create_draft or suggest_edit, and give me the review link.`,
          },
        },
      ],
    }),
  );

  return server;
}

const INSTRUCTIONS = `Elemnt hosts this team's documentation. Pages are written in Markdown with directives for rich components; people see a rendered page and you get Markdown.

To answer questions, use search, then get_page. To write docs, call get_authoring_guide once, then create_draft for new pages or suggest_edit for existing ones, and validate first if unsure. Your writes are drafts and suggestions that a person reviews before anything is published; share the review link you get back.`;

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
