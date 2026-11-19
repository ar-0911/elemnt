import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createHostedServer } from "./hosted.js";
import { connect } from "./db/connect.js";
import { blobStoreFromEnv, configFromEnv, loadEnv } from "./lib/config.js";
import { firstRun } from "./services/workspace.js";

const env = loadEnv();
const { db } = await connect(env.DATABASE_URL);
if (env.ELEMNT_OWNER_EMAIL && !env.ELEMNT_HOSTED_DOMAIN) {
  const made = await firstRun(db, { workspaceSlug: env.ELEMNT_WORKSPACE, email: env.ELEMNT_OWNER_EMAIL });
  if (made) console.log(`First run: created workspace "${made.workspace.slug}" owned by ${made.user.email}.\nAPI token (shown once; sign in at ${env.ELEMNT_PUBLIC_URL}/login, then make a new token in Settings and revoke this one): ${made.token}`);
}
if (!env.ELEMNT_HOSTED_DOMAIN && env.ELEMNT_SETUP_CODE && !(await db.query.workspaces.findFirst({ where: (w, { eq }) => eq(w.slug, env.ELEMNT_WORKSPACE) }))) {
  console.log(`Not set up yet. Create the owner account at this setup link: ${env.ELEMNT_PUBLIC_URL.replace(/\/$/, "")}/signup?setup=${env.ELEMNT_SETUP_CODE}`);
}
const hasEditor = existsSync(env.ELEMNT_WEB_DIR);
if (!hasEditor) console.warn(`Editor not found at ${env.ELEMNT_WEB_DIR}; build apps/web to enable /app.`);
const config = configFromEnv(env);
const deps = { db, blobs: await blobStoreFromEnv(env), config, ...(hasEditor ? { webDir: env.ELEMNT_WEB_DIR } : {}) };
// Hosted mode: many workspaces, each at <slug>.<ELEMNT_HOSTED_DOMAIN> (docs/hosted.md).
const app = config.hosted ? createHostedServer(deps) : createApp(deps);
if (config.hosted) console.log(`Hosted mode: workspaces at <name>.${config.hosted.domain}, accounts at ${config.publicUrl}. New workspaces ${config.hosted.approval ? "wait for approval" : "go live at once"}.${config.hosted.operators.length ? "" : " No ELEMNT_OPERATORS set, so nobody can open /admin."}`);

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`Elemnt listening on http://localhost:${port} (public URL ${config.publicUrl}${config.sandboxUrl ? `, sandbox ${config.sandboxUrl}` : ""})`);
});
