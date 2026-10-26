# Elemnt on Cloudflare

A Worker in front of one [Cloudflare Container](https://developers.cloudflare.com/containers/) that runs the same server image as `docker compose`. Page sources and rendered HTML go to **R2**; the database is any **Postgres** the container can reach over TLS ([Neon](https://neon.tech), Supabase, RDS and so on).

```
reader ─▶ docs.example.com ─┐
                            ├─▶ Worker ─▶ Container (Elemnt server :8787) ─▶ Postgres
widget ─▶ usercontent.net ──┘                         └─▶ R2 (S3 API)
```

> This target is written against wrangler 4.148 and `@cloudflare/containers` 0.3.7 and passes `wrangler deploy --dry-run`, but it hasn't been deployed end to end yet. Tell us what breaks.

## What you need

- A Cloudflare account on the Workers Paid plan (Containers need it).
- Docker running on the machine you deploy from: wrangler builds the image locally.
- Two hostnames on Cloudflare, on **different registrable domains**: one for Elemnt (`docs.example.com`) and one for sandboxed widgets and runnable code (`example-usercontent.net`). A subdomain of the first is not enough; browsers would treat it as the same site.
- A Postgres database. Postgres 15 or later.

## Deploy

1. **Database.** Create one and copy its connection string, with `?sslmode=require` on the end.
2. **Blob bucket.**
   ```sh
   npx wrangler r2 bucket create elemnt-blobs
   ```
   Then, in the dashboard under R2 → Manage API tokens, create a token with **Object Read & Write** on that bucket only. Note its access key ID, secret access key and the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`).
3. **Settings.** Edit `wrangler.jsonc`: the two `routes`, `ELEMNT_PUBLIC_URL`, `ELEMNT_SANDBOX_URL`, `ELEMNT_OWNER_EMAIL`, and uncomment `ELEMNT_S3_ENDPOINT` with your endpoint.
4. **Secrets.**
   ```sh
   npm install
   npx wrangler secret put DATABASE_URL
   openssl rand -base64 32 | npx wrangler secret put ELEMNT_SECRET_KEY
   npx wrangler secret put ELEMNT_S3_ACCESS_KEY_ID
   npx wrangler secret put ELEMNT_S3_SECRET_ACCESS_KEY
   # optional: ANTHROPIC_API_KEY, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET,
   # GITHUB_TOKEN, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
   ```
   Keep a copy of `ELEMNT_SECRET_KEY`: it encrypts stored API keys and LinkedIn tokens, and changing it makes them unreadable.
5. **Ship it.**
   ```sh
   npx wrangler deploy
   npx wrangler tail          # in another terminal
   ```
   The first request starts the container (give it a minute the first time). It runs the database migrations, creates the workspace for `ELEMNT_OWNER_EMAIL` and prints that owner's API token once in the logs. Sign in at `https://docs.example.com/login`, make a fresh token in Settings and revoke the bootstrap one.

To load the sample pages, run the seed script from your machine against the same database and bucket:

```sh
cd ../../apps/server && pnpm build
DATABASE_URL=… ELEMNT_SECRET_KEY=… ELEMNT_S3_BUCKET=elemnt-blobs ELEMNT_S3_REGION=auto \
ELEMNT_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
ELEMNT_S3_ACCESS_KEY_ID=… ELEMNT_S3_SECRET_ACCESS_KEY=… node dist/seed-demo.js
```

## How it runs

- `src/index.ts` sends every request, for both hostnames, to one container named `main`. The server tells the two origins apart by `Host`, the same as behind any reverse proxy.
- `max_instances` is 1: the server keeps rate limits and render caches in memory, so more than one instance would let them drift. A `standard-1` instance is plenty for a team; pick a larger `instance_type` if renders get slow.
- The container sleeps after 30 minutes without traffic and wakes on the next request; the first request after a sleep takes a few seconds. Raise `sleepAfter` in `src/index.ts` if that bothers you.
- The container's disk is thrown away when it sleeps. Nothing lives there: data is in Postgres and blobs are in R2.
- Variables go to the container through `envVars` in `src/index.ts`. A new server setting has to be added to the `PASSED` list there.
