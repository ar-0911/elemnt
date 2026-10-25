/**
 * First-run setup: creates the workspace, an owner and an API token.
 *   pnpm --filter @elemnt/server bootstrap -- --email you@example.com [--name "Your Name"]
 */
import { parseArgs } from "node:util";
import { connect } from "./db/connect.js";
import { loadEnv } from "./lib/config.js";
import { bootstrap } from "./services/workspace.js";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
if (!values.email) {
  console.error("Usage: bootstrap --email you@example.com [--name \"Your Name\"]");
  process.exit(1);
}

const env = loadEnv();
const { db, close } = await connect(env.DATABASE_URL);
const { workspace, user, token } = await bootstrap(db, { workspaceSlug: env.ELEMNT_WORKSPACE, email: values.email, ...(values.name ? { name: values.name } : {}) });
console.log(`Workspace: ${workspace.slug}\nOwner:     ${user.email}\nAPI token: ${token}\n\nSave the token now; it isn't shown again. Sign in at ${env.ELEMNT_PUBLIC_URL}/login`);
await close();
