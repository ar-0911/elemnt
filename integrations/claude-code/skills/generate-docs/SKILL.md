---
name: generate-docs
description: Write or update documentation in Elemnt for the code in this repository. Use when the user says "generate docs", "document this", "write a doc for…", or asks to explain a project, module, API or runbook in Elemnt.
---

# Generate docs in Elemnt

Docs live in Elemnt, not in this repository. Never write documentation files into the repo; use the `elemnt` MCP tools. Everything you write lands as a draft or a suggestion that a person reviews and publishes.

## Steps

1. **Find the home for the doc.** Call `list_spaces`. If the user named a space, use it; otherwise pick the one that matches this project and say which you chose. Call `search` for the topic to find an existing page before creating a new one.
2. **Learn the syntax once.** Call `get_authoring_guide`. Elemnt pages are Markdown plus directives such as `:::callout`, `:::tabs`, `:::steps`, `:::details`, `:::diagram` (Mermaid) and `:::runbook`.
3. **Read the code, not your memory.** Read the files that matter: entry points, public APIs, config, scripts, README, tests. Every command, flag, path and version you write must come from the repository. Where something is unknown, write a visible `TODO:` rather than guessing.
4. **Write for a new teammate.** Open with why the thing exists and what it does, in two or three sentences. Then:
   - a `:::steps` block for any procedure (setup, deploy, release)
   - `:::tabs` when there are alternatives (npm / pnpm, macOS / Linux)
   - a `:::callout{type=warn}` only for real hazards
   - a `:::diagram` with Mermaid when there is a flow or architecture worth seeing
   - code blocks with the exact commands
   - frontmatter with `title` and a one-line `summary`
   Keep paragraphs short. Prefer one focused page per topic over one huge page.
5. **Validate.** Call `validate` with the full source and fix every error.
6. **Save.**
   - New page: `create_draft` with a path like `getting-started` or `architecture` (parent pages must already exist).
   - Existing page: read it with `get_page` (`format: "source"`), then `suggest_edit` with small `edits` (exact `find` / `replace` pairs) or the full new `source`, and a one-sentence `summary` of what changed and why.
7. **Report back.** Give the user the review link(s) the tools returned and a two-line summary of what you wrote. Remind them that it needs their review before it goes live.

## Updating docs after a code change

When the user asks to update docs for a change: diff the change (`git diff`, the PR), `search` Elemnt for pages that mention the touched commands, config keys or modules, and `suggest_edit` each affected page. Don't rewrite pages wholesale; change only what the code change made wrong.

## Linking from the README

If the user wants the repo's README to point at the doc, add a single line such as `📖 Docs: <published page URL>`. That link is the only docs content that belongs in the repository.
