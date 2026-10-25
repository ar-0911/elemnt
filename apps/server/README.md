# @elemnt/server

The Elemnt API, reader and LinkedIn integration. Hono on Node, Postgres through Drizzle, revision bodies in a content-addressed blob store.

## Run it

```sh
cp .env.example .env            # set ELEMNT_SECRET_KEY at least
docker compose up -d
docker compose exec server node dist/bootstrap.js --email you@example.com
```

Or without Docker, against your own Postgres:

```sh
export DATABASE_URL=postgres://… ELEMNT_SECRET_KEY=$(openssl rand -base64 32)
pnpm --filter @elemnt/server bootstrap -- --email you@example.com
pnpm --filter @elemnt/server dev
```

Claude features use the workspace's own Anthropic API key, set by an admin in the editor under Settings (or `ANTHROPIC_API_KEY` on the server as a fallback). Requests use `claude-opus-5-5`.

Bootstrap prints an API token. Use it as `Authorization: Bearer …`, or paste it at `/login`.

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
| `POST /api/preview` | Compile without saving, for the editor |
| `GET /integrations/linkedin/connect` | Connect a LinkedIn account |
| `POST /api/pages/:id/linkedin` | Post a public page to LinkedIn `{commentary}` |

Every save stores three bodies under their sha256: the source, the HTML and the Markdown.

## Tests

`pnpm test` runs against an in-process Postgres (PGlite), so no database is needed. LinkedIn is faked at the `fetch` boundary.
