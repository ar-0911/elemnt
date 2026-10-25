import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { migrationsFolder } from "../src/db/connect.js";
import type { Db } from "../src/db/index.js";
import * as schema from "../src/db/schema.js";
import { MemoryBlobStore } from "../src/lib/blobs.js";
import type { Config } from "../src/lib/config.js";
import { bootstrap, issueToken } from "../src/services/workspace.js";
import { members, users } from "../src/db/schema.js";
import { newId } from "../src/lib/ids.js";

export const PUBLIC_URL = "https://docs.example.com";

export async function setup(options: { fetch?: typeof fetch; linkedin?: boolean } = {}) {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder });
  const { token: ownerToken } = await bootstrap(db, { workspaceSlug: "acme", email: "owner@example.com", name: "Owner" });

  const config: Config = {
    publicUrl: PUBLIC_URL,
    workspaceSlug: "acme",
    secretKey: randomBytes(32).toString("base64"),
    ...(options.linkedin ? { linkedin: { clientId: "cid", clientSecret: "secret", apiVersion: "202509" } } : {}),
  };
  const app = createApp({ db, blobs: new MemoryBlobStore(), config, ...(options.fetch ? { fetch: options.fetch } : {}) });

  const call = (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    if (init.json !== undefined) headers.set("Content-Type", "application/json");
    return app.request(path, { ...init, headers, ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) });
  };

  async function addMember(email: string, role: schema.Role) {
    const [ws] = await db.select().from(schema.workspaces);
    const [user] = await db.insert(users).values({ id: newId("usr"), email }).returning();
    await db.insert(members).values({ workspaceId: ws!.id, userId: user!.id, role });
    return issueToken(db, user!.id, "test");
  }

  return { app, db, call, ownerToken, addMember, close: () => client.close() };
}
