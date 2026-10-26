# Elemnt

Docs that are written once in Markdown, read by people as interactive pages, and read by agents as plain Markdown.

Every Elemnt page has one source file: CommonMark + GFM plus directive components such as `:::callout`, `::::tabs` and `:::diagram`. On save, Elemnt compiles that source into two stored versions:

- **HTML for people**, with interactive components (tabs, steps, diagrams, and later sliders, quizzes and sandboxed widgets).
- **Markdown for agents**, with every component turned into plain text, served at `page.md`, through `llms.txt`, and over the MCP server.

Readers switch between the two with a Page / Markdown toggle. Docs live only in Elemnt; Claude reads and suggests edits through MCP, and AI changes are always suggestions a person approves.

## Packages

| Package | What it does |
| --- | --- |
| [`@elemnt/core`](packages/core) | Parser, component contract, validation, HTML and agent-Markdown compilers, built-in components |
| [`@elemnt/server`](apps/server) | API, reader, search, comments, LinkedIn; serves the editor at `/app` |
| [`@elemnt/web`](apps/web) | The split-view editor: CodeMirror source, live preview, drafts, history, comments, ⌘K search |

## Develop

```sh
pnpm install
pnpm test        # vitest, including snapshot tests of both outputs
pnpm typecheck
pnpm build
```

Requires Node 22+ and pnpm 10.

## Debugging

[`docs/field-guide.html`](docs/field-guide.html) maps the codebase (every package and file), traces how saves, reads, ⌘I and MCP requests flow through it, and gives a routine for when something breaks: health check, where the logs are, error codes, known weak spots and how to target tests. Open it in a browser after cloning. It was written against `feat/m7-deploy`, so it also covers the code in PRs #9–#11.
