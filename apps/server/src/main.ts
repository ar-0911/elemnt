import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { connect } from "./db/connect.js";
import { blobStoreFromEnv, configFromEnv, loadEnv } from "./lib/config.js";
import { firstRun } from "./services/workspace.js";

const env = loadEnv();
const { db } = await connect(env.DATABASE_URL);
if (env.ELEMNT_OWNER_EMAIL) {
  const made = await firstRun(db, { workspaceSlug: env.ELEMNT_WORKSPACE, email: env.ELEMNT_OWNER_EMAIL });
  if (made) console.log(`First run: created workspace "${made.workspace.slug}" owned by ${made.user.email}.\nAPI token (shown once; sign in at ${env.ELEMNT_PUBLIC_URL}/login, then make a new token in Settings and revoke this one): ${made.token}`);
}
const hasEditor = existsSync(env.ELEMNT_WEB_DIR);
if (!hasEditor) console.warn(`Editor not found at ${env.ELEMNT_WEB_DIR}; build apps/web to enable /app.`);
const config = configFromEnv(env);
const app = createApp({ db, blobs: await blobStoreFromEnv(env), config, ...(hasEditor ? { webDir: env.ELEMNT_WEB_DIR } : {}) });

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`Elemnt listening on http://localhost:${port} (public URL ${config.publicUrl}${config.sandboxUrl ? `, sandbox ${config.sandboxUrl}` : ""})`);
});
