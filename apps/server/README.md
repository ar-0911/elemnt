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

Bootstrap prints an API token. Use it as `Authorization: Bearer …`, or paste it at `/login`.

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
| `GET /api/pages/:id`, `PUT /api/pages/:id` | Read source; save `{source, baseRevisionId}` (409 if someone saved first) |
| `GET /api/pages/:id/revisions`, `/api/revisions/:rev/{source,html,markdown}` | History and stored renditions |
| `GET /api/pages/:id/stats` | Views by format and source (e.g. `linkedin`) |
| `POST /api/preview` | Compile without saving, for the editor |
| `GET /integrations/linkedin/connect` | Connect a LinkedIn account |
| `POST /api/pages/:id/linkedin` | Post a public page to LinkedIn `{commentary}` |

Every save stores three bodies under their sha256: the source, the HTML and the Markdown.

## Tests

`pnpm test` runs against an in-process Postgres (PGlite), so no database is needed. LinkedIn is faked at the `fetch` boundary.
