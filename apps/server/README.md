# @elemnt/server

The Elemnt API, reader and LinkedIn integration. Hono on Node, Postgres through Drizzle, revision bodies in a content-addressed blob store.

## Run it

```sh
cp .env.example .env            # set ELEMNT_SECRET_KEY at least
docker compose up -d
```

Open http://localhost:8787 and sign up. The first account creates the workspace and owns it; later people join with an invite link from Settings → People (or anyone can, as a viewer, with `ELEMNT_SIGNUP=open`).

Or without Docker, against your own Postgres:

```sh
export DATABASE_URL=postgres://… ELEMNT_SECRET_KEY=$(openssl rand -base64 32)
pnpm --filter @elemnt/server dev
```

Claude features use the workspace's own Anthropic API key, set by an admin in the editor under Settings (or `ANTHROPIC_API_KEY` on the server as a fallback). Requests use `claude-opus-5-5`.

Passwords are hashed with scrypt; a browser session is a 30-day token in an httpOnly cookie. For scripts and CI, create an API token under Settings → Account and send it as `Authorization: Bearer …`. The bootstrap script (`node dist/bootstrap.js --email …`) still works for headless setups: it prints a token you can paste under "Sign in with an API token" at `/login`, then set a password in Settings.

The editor lives at `/app`. The server serves the built `apps/web/dist` (set `ELEMNT_WEB_DIR` to move it), so run `pnpm build` at the root first. For editor work with hot reload, run the server and `pnpm --filter @elemnt/web dev`, then open http://localhost:5173/app/.

## Try it

The quickest look: `pnpm --filter @elemnt/server seed:demo` (or `docker compose exec server node dist/seed-demo.js`) creates a public demo space with two sample pages and prints their URLs.

Or create your own:

```sh
TOKEN=elm_…
curl -X POST localhost:8787/api/spaces -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"slug":"docs","name":"Docs","visibility":"public"}'
curl -X POST localhost:8787/api/spaces/docs/pages -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"path":"hello","source":"---\ntitle: Hello\n---\n:::callout{type=tip}\nIt works.\n:::"}'
open http://localhost:8787/s/docs/hello
```

## Routes

| Route | What |
| --- | --- |
| `GET /s/:space/:path` | The page, with a Page / Markdown toggle (`?view=markdown`) |
| `GET /s/:space/:path.md` | Stored Markdown for agents; also on `Accept: text/markdown` |
| `GET /s/:space/llms.txt`, `llms-full.txt` | Agent index and all pages in one file |
| `POST /api/spaces` | Create a space (admin) |
| `GET /api/spaces/:space/tree` | Page tree |
| `POST /api/spaces/:space/pages` | Create a page `{path, source}`; 422 with diagnostics if the source has errors |
| `GET /api/pages/:id`, `PUT /api/pages/:id` | Read source; save `{source, baseRevisionId, publish?}` (409 if someone saved first). `publish: false` saves a draft, which may contain errors |
| `POST /api/pages/:id/publish`, `DELETE /api/pages/:id/draft` | Publish or discard the draft |
| `POST /api/pages/:id/restore`, `GET /api/pages/:id/diff?from&to` | Restore an old revision as a new one; unified diff |
| `POST`/`DELETE /api/pages/:id/lock` | One editor at a time (90 s lease, 423 when taken) |
| `GET`/`POST /api/pages/:id/comments`, `POST …/:cid/resolve`, `DELETE …/:cid` | Comments anchored to quoted text, one level of replies |
| `GET /api/search?q=&space=` | Full-text search over published pages, with highlighted snippets |
| `GET /api/ai`, `PUT`/`DELETE /api/ai/key` | The workspace's own Anthropic API key (admins), sealed with `ELEMNT_SECRET_KEY` |
| `POST /api/pages/:id/assist` | `{instruction, baseRevisionId, selection?}`: Claude's rewrite comes back as a suggestion |
| `GET /api/pages/:id/suggestions`, `GET /api/suggestions/:sid` | Open suggestions; one suggestion with its hunks and whether the page moved on |
| `POST /api/suggestions/:sid/accept` `{hunks?}`, `POST …/reject` | Apply some or all hunks as a draft (three-way merged if the page changed; 409 on overlap) |
| `POST /mcp` | MCP server (Streamable HTTP). See [integrations/claude-code](../../integrations/claude-code) |
| `/.well-known/oauth-*`, `/oauth/register`, `/oauth/authorize`, `/oauth/token` | OAuth 2.1 for MCP clients: dynamic registration, PKCE S256 |
| `GET /api/pages/:id/revisions`, `/api/revisions/:rev/{source,html,markdown}` | History and stored renditions |
| `GET /api/pages/:id/stats` | Views by format and source (e.g. `linkedin`) |
| `POST /mcp` tool `get_runbook` | Runbooks as structured steps (commands, expected output, approval gates) for Claude to run |
| `GET /assets/elements.js` | The reader runtime (`@elemnt/elements`) |
| `POST /api/widgets/preview` | Editor: register widget code so the sandbox can serve it; returns scan findings |
| `POST /api/widgets/:hash/report` | Anyone: report a widget (10 per hour per person) |
| `GET /api/widgets/reports`, `POST`/`DELETE /api/widgets/:hash/block` | Admins: review reports; block a widget everywhere at once |
| `GET`/`PUT /api/settings/widgets` | Admins: `{verified, hosts}`. Verified workspaces' widgets run without a click and may reach the listed hosts |
| `GET /api/query?source&key` | A live value for `:query`, read from an admin-configured JSON source (cached 60 s) |
| `GET /api/settings/query-sources`, `PUT`/`DELETE …/:slug` | Admins: `{url, public, headers?}`; headers are sealed and never returned |
| `GET`/`PUT`/`DELETE /api/pages/:id/repo` | Explainer pages: link a page to a GitHub repo `{repo, branch?, commit?, citedPaths?}`; returns the README badge |
| `POST /api/pages/:id/repo/check`, `POST …/repo/pin` | Run the drift check now; mark the page current at a commit |
| `POST /integrations/github/webhook` | GitHub push events (signed with `GITHUB_WEBHOOK_SECRET`) trigger drift checks for pages on that branch |
| `GET /r/:owner/:repo`, `…/badge.svg` | The README short link to a repo's explainer page, and its badge |
| `GET`/`PUT /api/settings/theme` | The organization theme `{theme}` (admins write; `null` removes it) |
| `GET`/`PUT /api/me/style` | Your own default page style `{style}` |
| `POST /mcp` tools `get_style_guide`, `save_my_style` | The style guide Claude reads before writing, and saving the style the user picked |
| `POST /api/preview` | Compile without saving, for the editor |
| `GET /integrations/linkedin/connect` | Connect a LinkedIn account |
| `POST /api/pages/:id/linkedin` | Post a public page to LinkedIn `{commentary}` |

## Repo explainers and the drift check

A page can be linked to a GitHub repo at a pinned commit. The page then shows "written against `a1b2c3d`, N commits behind". The check compares the pinned commit with the branch head. If a file the page cites has changed (cited means listed in `citedPaths` or linked from the page as `github.com/owner/repo/blob/...`), the check does one of two things:

- With a Claude key: Claude writes an updated page from the diffs, and it opens as a suggestion.
- Without a key: a comment lists the changed files.

Accepting a drift suggestion re-pins the page. Elemnt never writes to the repo.

GitHub access, in order of preference:

1. A GitHub App with read-only Contents and Metadata, subscribed to push events: set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET`, and point the webhook at `/integrations/github/webhook`.
2. A `GITHUB_TOKEN`.
3. Nothing, for public repos, with GitHub's low anonymous rate limit. Without the App there are no push events, so run checks from the editor's Repo panel or `POST /api/pages/:id/repo/check`.

## Page styles and themes

A page's look comes from three layers: a preset (`clean`, `aurora`, `editorial`, `terminal`, `blueprint`, `sunset`, `paper`), the organization theme, and the page's own `style:` frontmatter. A locked organization theme keeps its colours and fonts on every page. Styles are validated data (hex colours, font names, enums) compiled to CSS custom properties by `@elemnt/core`; each revision stores its validated style. Fonts load from Google Fonts unless `ELEMNT_FONTS=off`. The reader and present mode set light or dark before first paint from the reader's saved choice, else the style's `mode`.

## Storage and hosting

Postgres holds everything except page bodies. Page sources and rendered HTML are content-addressed blobs: on local disk at `ELEMNT_BLOB_DIR` by default, or in any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) when `ELEMNT_S3_BUCKET` is set. With S3 the server signs requests itself; it uses `ELEMNT_S3_ACCESS_KEY_ID` and `ELEMNT_S3_SECRET_ACCESS_KEY` when set, otherwise the AWS container role (App Runner, ECS) or the EC2 instance role.

`GET /healthz` returns 200 when the database answers. Where you can't run the bootstrap script, set `ELEMNT_OWNER_EMAIL`: the first start creates the workspace for that owner and prints their API token once. Ready-made targets live in [deploy/cloudflare](../../deploy/cloudflare/README.md) and [deploy/aws](../../deploy/aws/README.md). Run one instance: rate limits and render caches are in memory.

## Widgets and the sandbox

`:::widget` blocks hold an author's own HTML, CSS and JS. They never run on the app's origin. The same server answers a second hostname, `ELEMNT_SANDBOX_URL`, and on that hostname serves only `/w/*`:

- `/w/:hash` is the widget, content-addressed by the sha256 of its code. Its CSP forbids network (unless the workspace is verified and lists hosts), eval, WebAssembly, workers, forms and nested frames, and only the public URL may frame it.
- `/w/run/javascript` and `/w/run/python` (Pyodide from jsDelivr) run ```` ```js run ```` and ```` ```python run ```` blocks in throwaway frames.

The reader frames them with `sandbox="allow-scripts"` only, so they get an opaque origin with no cookies or storage. On top of that: a label outside the frame with the author's name, click-to-run for public pages of unverified workspaces, loading only on screen, a heartbeat watchdog that stops frames that hog the CPU or navigate away, links only through a "you're leaving" dialog, a scan on save that refuses miners, WebAssembly, password fields and obfuscated code, a Report button, and a block switch that disables a widget on every page at once.

Locally the sandbox defaults to `127.0.0.1` when the public URL is `localhost`. In production, point a separate domain at the server, a different registrable domain rather than a subdomain of the app (for example `acme.elemntusercontent.com` for `docs.acme.com`), and set `ELEMNT_SANDBOX_URL`; without one, widgets show their summary only.

Every save stores three bodies under their sha256: the source, the HTML and the Markdown.

## Tests

`pnpm test` runs against an in-process Postgres (PGlite), so no database is needed. LinkedIn is faked at the `fetch` boundary.
