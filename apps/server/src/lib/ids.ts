import { randomBytes } from "node:crypto";

/** Prefixed, URL-safe ids such as `pg_3kq9…` so a stray id says what it is. */
export function newId(prefix: "usr" | "ws" | "tok" | "spc" | "pg" | "rev" | "lip"): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}
