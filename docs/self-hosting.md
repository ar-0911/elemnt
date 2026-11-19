# Self-hosting Elemnt

Elemnt runs as one container next to Postgres. You can install it with one command on any machine that has Docker. That can be a laptop, a home server or a small VPS. If you add a domain, Caddy serves it over HTTPS and gets certificates for you.

## What you need

- **Docker:** Docker Engine 24 or newer with Compose v2, so that `docker compose` works.
- **Memory:** 1 GB of RAM. Elemnt and Postgres run comfortably in that.
- **For a public install:** a domain, and DNS records you can edit. Ports 80 and 443 must be open to the internet.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/ar-0911/elemnt/main/deploy/selfhost/install.sh | sh
```

The script asks for a domain. Leave it empty to run on this machine only, at http://localhost:8787. With a domain it asks for two more names:

| Name | Example | What it's for |
| --- | --- | --- |
| The app | `docs.example.com` | The editor, the reader and the API, plus `/mcp` for Claude |
| The widget sandbox | `sandbox.docs.example.com` | Custom widgets and runnable code run here, on a separate origin, so they can't touch your session |
| Websites (optional) | `example.com` | Project websites live at `<site>.example.com`. This needs a wildcard DNS record `*.example.com` |

The script does the following:

1. Writes `compose.yml`, `Caddyfile` and `.env` into `./elemnt`.
2. Generates the database password and the encryption key in `.env`.
3. Generates a one-time **setup code**.
4. Pulls the images and starts the stack.
5. Prints a setup link.

Open the setup link to create the owner account. Until that account exists, the setup link is the only way in. This stops a stranger who finds your server first from claiming it. If you lose the link, print it again:

```sh
cd elemnt && docker compose logs server | grep setup
```

For a script or CI, skip the questions:

```sh
sh install.sh --yes --domain docs.example.com --sites example.com
```

### DNS

Point each name at the server's public IP with A and/or AAAA records:

```
docs.example.com          A     203.0.113.10
sandbox.docs.example.com  A     203.0.113.10
*.example.com             A     203.0.113.10   # only for project websites
```

Caddy gets a certificate the first time someone visits each name. Before it requests one, it asks Elemnt whether it serves that name. Elemnt says yes only to:

- the app's name
- the sandbox's name
- published websites
- custom hostnames you've given a site

So nobody can make your server request certificates for names it doesn't serve.

**On Cloudflare DNS,** use DNS-only (grey cloud) records, so Caddy's certificates reach visitors directly. If you'd rather keep the proxy on, set SSL/TLS to **Full (strict)** and check that `/.well-known/acme-challenge/` reaches the server over plain HTTP.

## After installing

1. **Add a Claude key** under **Settings → Claude API key**. Every workspace brings its own key. You can also set `ANTHROPIC_API_KEY` in `.env` for the whole server.
2. **Invite people** from **Settings → People**. Each invite link carries a role and lasts 7 days. To let anyone join as a viewer, set `ELEMNT_SIGNUP=open` in `.env`.
3. **Connect Claude Code:**
   ```sh
   claude mcp add --transport http elemnt https://docs.example.com/mcp
   ```
4. **Let Claude publish (optional).** Open a space's ⋯ menu and turn on **Let Claude publish**. Claude can then publish its own pages and edits in that space, plus the websites that show it. It's off by default, and Claude never publishes over a person's draft.

## Changing settings

Edit `.env`, then run:

```sh
docker compose up -d
```

Every setting is described in [`.env.example`](../.env.example). The ones people change most:

| Setting | What it does |
| --- | --- |
| `ELEMNT_SIGNUP=open` | Anyone can join as a viewer. The default is invite links only. |
| `ANTHROPIC_API_KEY` | A Claude key for the whole server. |
| `GITHUB_TOKEN` or the `GITHUB_APP_*` settings | Read-only access to private repos for explainer pages. |
| `ELEMNT_FONTS=off` | Never load fonts from Google Fonts. |
| `ELEMNT_S3_*` | Store files in S3, R2 or MinIO instead of the `blobs` volume. |

## Upgrading

```sh
cd elemnt
docker compose pull
docker compose up -d
```

Database migrations run automatically when the server starts. `ELEMNT_VERSION` in `.env` picks the image tag:

| Tag | What you get |
| --- | --- |
| `latest` (the default) | The newest release. |
| A version, for example `0.2.0` | Stays on that release. |
| `edge` | Follows `main`. |

## Backups

Everything lives in two places, so back up both. Also keep a copy of `.env`. Without `ELEMNT_SECRET_KEY`, stored API keys can't be decrypted.

```sh
# Records: pages, revisions, people, settings
docker compose exec -T postgres pg_dump -U elemnt elemnt | gzip > elemnt-$(date +%F).sql.gz

# Files: page sources, rendered HTML, site files (named by SHA-256, never changed)
docker run --rm -v elemnt_blobs:/data -v "$PWD":/out alpine tar czf /out/blobs-$(date +%F).tgz -C /data .
```

To restore, start a fresh install with the same `.env`, then:

```sh
gunzip -c elemnt-DATE.sql.gz | docker compose exec -T postgres psql -U elemnt elemnt
docker run --rm -v elemnt_blobs:/data -v "$PWD":/in alpine tar xzf /in/blobs-DATE.tgz -C /data
```

If files go to S3 or R2 (`ELEMNT_S3_*`), turn on versioning on the bucket instead of the tar step.

## Other ways to run it

- **Without the script:** copy [`deploy/selfhost`](../deploy/selfhost) and write `.env` yourself from `.env.example`. Then run `docker compose up -d`.
- **From source:** clone the repo and run `docker compose up -d` at its root. This builds the image locally.
- **Cloudflare Containers with R2 and Neon:** see [deploy/cloudflare](../deploy/cloudflare/README.md). This is how docs.adityapoc.xyz runs.
- **AWS App Runner with RDS and S3:** see [deploy/aws](../deploy/aws/README.md).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| The setup link says "isn't set up yet" | The `setup` code in the link must match `ELEMNT_SETUP_CODE` in `.env`. |
| The browser warns about the certificate | DNS must point at this server, and ports 80 and 443 must be open. Then check `docker compose logs caddy`. |
| Widgets don't load | The sandbox name needs its own DNS record. |
| A website shows "There's no website here yet" | The site isn't published yet, or the wildcard record is missing. |
| The server keeps restarting with "password authentication failed" | An old database volume is still there from an earlier install. Use that install's `.env`, or remove the volumes with `docker compose down -v`. This deletes the data. |
