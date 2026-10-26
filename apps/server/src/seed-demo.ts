/**
 * Fills a public "demo" space with sample pages so there's something to look at.
 *   pnpm --filter @elemnt/server seed:demo
 */
import { createElemnt } from "@elemnt/core";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { connect } from "./db/connect.js";
import { blobStoreFromEnv, loadEnv } from "./lib/config.js";
import { createPage, createSpace, findPage, findSpace } from "./services/pages.js";
import { getWorkspace } from "./services/workspace.js";

const env = loadEnv();
const { db, close } = await connect(env.DATABASE_URL);
const ws = await getWorkspace(db, env.ELEMNT_WORKSPACE);
const owner = await db.query.members.findFirst({ where: (m, { eq }) => eq(m.workspaceId, ws.id) });
if (!owner) throw new Error("Run bootstrap first.");

const space = (await findSpace(db, ws.id, "demo")) ?? (await createSpace(db, ws.id, { slug: "demo", name: "Elemnt demo", visibility: "public" }));
const deps = { db, blobs: await blobStoreFromEnv(env), elemnt: createElemnt() };

for (const name of ["tour", "deploying", "rotate-key", "postmortem", "cli"]) {
  if (await findPage(db, space.id, name)) continue;
  const source = await readFile(fileURLToPath(new URL(`../demo/${name}.md`, import.meta.url)), "utf8");
  await createPage(deps, { spaceId: space.id, path: name, source, authorId: owner.userId, message: "Demo page" });
  console.log(`${env.ELEMNT_PUBLIC_URL}/s/demo/${name}`);
}
await close();
