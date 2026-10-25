import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
