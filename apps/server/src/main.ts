import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { connect } from "./db/connect.js";
import { FsBlobStore } from "./lib/blobs.js";
import { configFromEnv, loadEnv } from "./lib/config.js";

const env = loadEnv();
const { db } = await connect(env.DATABASE_URL);
const app = createApp({ db, blobs: new FsBlobStore(env.ELEMNT_BLOB_DIR), config: configFromEnv(env) });

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`Elemnt listening on http://localhost:${port} (public URL ${env.ELEMNT_PUBLIC_URL})`);
});
