# Hosting Elemnt for other people

Hosted mode runs one Elemnt server for many people. You buy one domain, say `elmnt.example`. Each person who signs up picks their own address, like `ann.elmnt.example`, and gets their own workspace there. They never touch DNS, servers, certificates or Docker.

| Address | What's there |
| --- | --- |
| `elmnt.example` | The front door: sign up, sign in, your workspaces, and `/admin` for operators |
| `<name>.elmnt.example` | One workspace: the editor, the reader, the API and `/mcp` for Claude |
| The sandbox | Widgets and runnable code for every workspace, on a separate origin |
| A custom domain | A workspace's website, for example `docs.rocket.dev` |

Run this as its **own** server, with its own database and file storage. Don't switch an existing single-workspace install over. Its workspace isn't reachable in hosted mode.

## How someone gets started

1. They open `elmnt.example` and click **Create your workspace**.
2. They fill in one form: workspace name, address, name, username, email and password. The address is checked as they type.
3. They land in their new workspace, already signed in. It has a starter space with a welcome page that walks them through the next steps:
   - add their Claude key
   - connect Claude Code
   - invite people
4. **All your workspaces** in the account menu takes them back to `elmnt.example`.

Each person can own up to 3 workspaces. Invite links work across workspaces. Someone who already has an account opens the link, clicks **Sign in to join**, and joins with the same username and password.

## Settings

Set these on top of the usual ones in [`.env.example`](../.env.example):

| Setting | Value |
| --- | --- |
| `ELEMNT_HOSTED_DOMAIN` | `elmnt.example` |
| `ELEMNT_PUBLIC_URL` | `https://elmnt.example` (the front door) |
| `ELEMNT_SANDBOX_URL` | A name on a **different** registrable domain. On Cloudflare, the Worker's `workers.dev` address works. |
| `ELEMNT_OPERATORS` | Your email, comma-separated for more than one. Operators get `/admin`. |
| `ELEMNT_HOSTED_APPROVAL` | `off` (the default) means new workspaces go live at once. `on` means they wait until an operator approves them on `/admin`. |

Leave these unset; hosted mode ignores them:

- `ELEMNT_OWNER_EMAIL`
- `ELEMNT_SETUP_CODE`
- `ELEMNT_SITES_DOMAIN`
- `ELEMNT_SIGNUP`

The server's own `ANTHROPIC_API_KEY` is never given to hosted workspaces. Each workspace adds its own key in Settings.

## What operators can do

`/admin` on the front door lists every workspace, with its owner, its size and when it was made.

- **Suspend** closes a workspace to everyone, its owners included, until you turn it back on. Nothing is deleted.
- With approval on, the waiting requests show at the top. Approve or decline each one, with an optional note.

## Running it on Cloudflare

This uses the same Worker and Container as [deploy/cloudflare](../deploy/cloudflare/README.md), deployed a second time under another name.

1. **Add the domain** to Cloudflare. Then add two proxied DNS records:
   - `elmnt.example`, AAAA `100::`
   - `*.elmnt.example`, AAAA `100::`

   Cloudflare's free certificate covers both the domain and one level of subdomains.
2. **Make a second database and bucket**, for example a new Neon project and the R2 bucket `elemnt-hosted`.
3. **Copy `deploy/cloudflare`** to a new folder, and in `wrangler.jsonc`:
   - Set `"name": "elemnt-hosted"`.
   - Set the routes:
     ```jsonc
     "routes": [
       { "pattern": "elmnt.example", "custom_domain": true },
       { "pattern": "*.elmnt.example/*", "zone_name": "elmnt.example" }
     ]
     ```
   - Set the vars from the table above, plus `ELEMNT_S3_BUCKET`.
   - Use `https://elemnt-hosted.<your-account>.workers.dev` as `ELEMNT_SANDBOX_URL`.
4. **Add the secrets** with `npx wrangler secret put`:
   - `DATABASE_URL`
   - `ELEMNT_SECRET_KEY`
   - `ELEMNT_S3_ENDPOINT`
   - `ELEMNT_S3_ACCESS_KEY_ID`
   - `ELEMNT_S3_SECRET_ACCESS_KEY`
5. **Deploy** with `npx wrangler deploy`. Then open `https://elmnt.example`, make your own account and workspace, and check that `/admin` opens for you.

### Websites on custom domains

Hosted workspaces publish websites on domains they own. In the site's settings they enter the hostname, for example `docs.rocket.dev`. Names under your hosted domain are refused.

On Cloudflare, those names reach your Worker through **Cloudflare for SaaS**:

1. Turn it on for the zone `elmnt.example`.
2. Set a fallback origin, for example `sites.elmnt.example`.
3. Add each customer's hostname under **Custom Hostnames**. Cloudflare issues the certificate.
4. The customer points a CNAME at the fallback origin.
5. Add the Worker route `*/*` on the zone, so custom hostnames reach the Worker.

Adding hostnames is a manual step for now.

## Running it with Docker

Use the [self-host kit](self-hosting.md) with the settings above in `.env`.

- Point both `elmnt.example` and `*.elmnt.example` at the server.
- Caddy gets a certificate for each workspace address the first time someone visits it. Before it does, it asks Elemnt, and Elemnt says yes only to:
  - the front door
  - the sandbox
  - workspaces that exist and aren't suspended
  - published custom-domain sites

## Not in this version

- Email verification and password reset by email
- Billing
- Deleting a workspace (suspend it instead)
- Site previews on hosted workspaces. Previews need a sites domain, which hosted mode doesn't use.
