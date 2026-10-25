import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { connect } from "./db/connect.js";
import { FsBlobStore } from "./lib/blobs.js";
import { configFromEnv, loadEnv } from "./lib/config.js";
import { editorApp } from "./web.js";

const env = loadEnv();
const { db } = await connect(env.DATABASE_URL);
const api = createApp({ db, blobs: new FsBlobStore(env.ELEMNT_BLOB_DIR), config: configFromEnv(env) });

const app = new Hono();
if (existsSync(env.ELEMNT_WEB_DIR)) app.route("/app", editorApp(env.ELEMNT_WEB_DIR));
else console.warn(`Editor not found at ${env.ELEMNT_WEB_DIR}; build apps/web to enable /app.`);
app.route("/", api);

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`Elemnt listening on http://localhost:${port} (public URL ${env.ELEMNT_PUBLIC_URL})`);
});
