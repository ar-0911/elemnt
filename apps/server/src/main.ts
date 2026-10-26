import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { connect } from "./db/connect.js";
import { FsBlobStore } from "./lib/blobs.js";
import { configFromEnv, loadEnv } from "./lib/config.js";

const env = loadEnv();
const { db } = await connect(env.DATABASE_URL);
const hasEditor = existsSync(env.ELEMNT_WEB_DIR);
if (!hasEditor) console.warn(`Editor not found at ${env.ELEMNT_WEB_DIR}; build apps/web to enable /app.`);
const config = configFromEnv(env);
const app = createApp({ db, blobs: new FsBlobStore(env.ELEMNT_BLOB_DIR), config, ...(hasEditor ? { webDir: env.ELEMNT_WEB_DIR } : {}) });

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`Elemnt listening on http://localhost:${port} (public URL ${config.publicUrl}${config.sandboxUrl ? `, sandbox ${config.sandboxUrl}` : ""})`);
});
