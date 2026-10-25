# Elemnt for Claude Code and Claude

Elemnt is an MCP server. Claude reads pages as Markdown, learns the component syntax, and writes back only as drafts and suggestions that a person reviews.

## Connect

**Claude Code**

```sh
claude mcp add --transport http elemnt https://YOUR-ELEMNT-HOST/mcp
```

The first time Claude Code uses it, it opens a browser to sign in to Elemnt and approve access (OAuth with PKCE; access lasts 30 days). For scripts or CI you can instead send an API token:

```sh
claude mcp add --transport http elemnt https://YOUR-ELEMNT-HOST/mcp --header "Authorization: Bearer elm_…"
```

**Claude (claude.ai and the apps)**: Settings → Connectors → Add custom connector, with the URL `https://YOUR-ELEMNT-HOST/mcp`. Elemnt must be reachable from the internet for this.

## Tools

| Tool | What it does |
| --- | --- |
| `list_spaces`, `list_pages` | Browse what exists |
| `search` | Full-text search over published pages |
| `get_page` | A page as Markdown (published) or source (including drafts) |
| `get_style_guide` | The organization theme (and whether it's locked), the user's saved style, the style presets and the layout components, plus how to write pages that pull readers in |
| `save_my_style` | Remember the style the user picked, so Claude doesn't ask again |
| `get_authoring_guide` | The source syntax with an example per component |
| `validate` | Check source without saving |
| `create_draft` | New page as an unpublished draft (editors) |
| `suggest_edit` | Propose a change to a page, reviewed hunk by hunk (editors) |
| `add_comment` | Comment on a page, optionally on a quote |
| `get_runbook` | A page's runbooks as structured steps to run, with approval gates |
| `link_repo` | Make a page the explainer for a GitHub repo, pinned to a commit; returns a README badge (editors) |

`search` also takes a GitHub repo URL and returns that repo's explainer page first, so Claude Code working in a repo can find its docs without any files in the repo.

Viewers only get the read tools and comments.

## The elemnt-docs-style skill

Copy `skills/elemnt-docs-style` into `.claude/skills/` alongside the others. Before Claude writes or restyles a page it calls `get_style_guide`: if your organization has a locked theme it follows it without asking; otherwise it asks what style and fonts you'd like (or uses the style you saved), then writes an "extravagant but understandable" page: a hero, big numbers, inline SVG graphics, cards and timelines, in that style. The MCP server's instructions and the `generate_docs` prompt point Claude at the style guide too, so connectors without the skill file get the same behaviour.

## The generate-docs skill

Copy `skills/generate-docs` into your project's `.claude/skills/` (or `~/.claude/skills/` for every project). Then "generate docs for the billing service" in Claude Code reads the code and writes Elemnt pages through the tools above. In Claude, the `generate_docs` prompt from the connector does the same from a conversation.

## The repo-explainer skill

Copy `skills/repo-explainer` the same way. "Generate an explainer for this repo" writes one rich page (what it is, an architecture diagram, a quickstart, a tour of the code, a live demo where it fits), links it to the repo at the commit Claude read, and offers the README badge. When cited files change on the default branch, Elemnt suggests an edit to the page.
