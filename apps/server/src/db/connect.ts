import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type { Db } from "./index.js";
import * as schema from "./schema.js";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Connects to Postgres and applies pending migrations. */
export async function connect(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.end() };
}
