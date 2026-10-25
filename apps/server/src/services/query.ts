import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { workspaces, type QuerySource } from "../db/schema.js";
import type { SecretBox } from "../lib/crypto.js";
import { HttpError } from "./errors.js";

/**
 * Live values for `:query`. Admins name JSON endpoints; readers ask for one
 * value by key (a dot path). The server fetches with the sealed headers, so
 * tokens never reach the browser, and caches each source for a minute.
 */

const TTL_MS = 60_000;
const MAX_BYTES = 1_000_000;

export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function pick(data: unknown, key: string): unknown {
  let cur = data;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function querySourceService(db: Db, box: SecretBox, doFetch: typeof fetch) {
  const cache = new Map<string, { at: number; data: unknown }>();

  async function sources(workspaceId: string) {
    const [ws] = await db.select({ q: workspaces.querySources }).from(workspaces).where(eq(workspaces.id, workspaceId));
    return ws?.q ?? {};
  }

  async function load(workspaceId: string, slug: string, src: QuerySource) {
    const hit = cache.get(`${workspaceId}/${slug}`);
    if (hit && Date.now() - hit.at < TTL_MS) return hit;
    const headers = src.headersCiphertext ? (JSON.parse(box.open(src.headersCiphertext)) as Record<string, string>) : {};
    const res = await doFetch(src.url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(5000), redirect: "error" }).catch(() => undefined);
    if (!res?.ok) throw new HttpError(502, `The ${slug} source didn't answer.`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new HttpError(502, `The ${slug} source returned more than 1 MB.`);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError(502, `The ${slug} source didn't return JSON.`);
    }
    const entry = { at: Date.now(), data };
    cache.set(`${workspaceId}/${slug}`, entry);
    return entry;
  }

  return {
    async list(workspaceId: string) {
      const all = await sources(workspaceId);
      return Object.entries(all).map(([slug, s]) => ({ slug, url: s.url, public: s.public, hasHeaders: Boolean(s.headersCiphertext) }));
    },

    async save(workspaceId: string, input: { slug: string; url: string; public: boolean; headers?: Record<string, string> | null }) {
      if (!SLUG.test(input.slug)) throw new HttpError(400, "Use lowercase letters, digits and dashes for the source name.");
      if (!/^https:\/\//.test(input.url)) throw new HttpError(400, "Sources must use https.");
      const all = await sources(workspaceId);
      const prev = all[input.slug];
      // headers: undefined keeps the stored ones, null clears them.
      const headersCiphertext = input.headers === undefined ? prev?.headersCiphertext : input.headers && Object.keys(input.headers).length ? box.seal(JSON.stringify(input.headers)) : undefined;
      all[input.slug] = { url: input.url, public: input.public, ...(headersCiphertext ? { headersCiphertext } : {}) };
      await db.update(workspaces).set({ querySources: all }).where(eq(workspaces.id, workspaceId));
      cache.delete(`${workspaceId}/${input.slug}`);
    },

    async remove(workspaceId: string, slug: string) {
      const all = await sources(workspaceId);
      delete all[slug];
      await db.update(workspaces).set({ querySources: all }).where(eq(workspaces.id, workspaceId));
      cache.delete(`${workspaceId}/${slug}`);
    },

    async value(workspaceId: string, slug: string, key: string, isMember: boolean) {
      const src = (await sources(workspaceId))[slug];
      if (!src || (!src.public && !isMember)) throw new HttpError(404, `No source named ${slug}.`);
      const { at, data } = await load(workspaceId, slug, src);
      const value = pick(data, key);
      if (value === undefined) throw new HttpError(404, `${slug} has no value at ${key}.`);
      if (value !== null && typeof value === "object") throw new HttpError(400, `${key} is an object; point at a number or text inside it.`);
      return { value, fetchedAt: new Date(at).toISOString() };
    },
  };
}
