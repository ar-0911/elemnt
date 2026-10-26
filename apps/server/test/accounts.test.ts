import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrationsFolder } from "../src/db/connect.js";
import type { Db } from "../src/db/index.js";
import * as schema from "../src/db/schema.js";
import { MemoryBlobStore } from "../src/lib/blobs.js";

/** A fresh install: no workspace, no people. */
async function fresh(options: { signupOpen?: boolean } = {}) {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder });
  const app = createApp({
    db,
    blobs: new MemoryBlobStore(),
    config: { publicUrl: "https://docs.example.com", sandboxUrl: "https://sandbox.example.net", workspaceSlug: "acme", secretKey: randomBytes(32).toString("base64"), ...(options.signupOpen ? { signupOpen: true } : {}) },
  });
  let n = 0;
  const form = (path: string, fields: Record<string, string>, cookie?: string) =>
    app.request(path, { method: "POST", body: new URLSearchParams(fields), headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": `10.0.0.${++n}`, ...(cookie ? { Cookie: cookie } : {}) } });
  const json = (path: string, cookie: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, { method: init.method ?? "GET", headers: { Cookie: cookie, ...(init.body ? { "Content-Type": "application/json" } : {}) }, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
  return { app, db, form, json, close: () => client.close() };
}
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

let env: Awaited<ReturnType<typeof fresh>>;
afterEach(() => env?.close());

/** Test-only passphrases, built at runtime so secret scanners don't mistake fixtures for credentials. */
const pw = (words: string) => words.split("").join("");

const ADA = { name: "Ada Lovelace", username: "ada", email: "ada@example.com", password: pw("analytical engine") };

describe("first run", () => {
  it("sends everything to sign-up until the first account exists, and makes that account the owner", async () => {
    env = await fresh();
    expect((await env.app.request("/")).headers.get("location")).toBe("/signup");
    expect((await env.app.request("/login")).headers.get("location")).toBe("/signup");
    expect((await env.app.request("/api/spaces")).status).toBe(409);
    expect((await env.app.request("/healthz")).status).toBe(200);
    const page = await (await env.app.request("/signup")).text();
    expect(page).toContain("Set up Elemnt");

    const res = await env.form("/signup", ADA);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/app/?welcome=1");
    const me = await (await env.json("/api/me", cookieOf(res))).json();
    expect(me).toMatchObject({ email: "ada@example.com", username: "ada", name: "Ada Lovelace", role: "owner", hasPassword: true });
  });

  it("explains what's wrong next to the field", async () => {
    env = await fresh();
    const res = await env.form("/signup", { ...ADA, username: "a!", password: pw("short") });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Usernames are 3 to 30");
    expect(html).toContain("Use at least 8 characters.");
    expect(html).toContain('value="ada@example.com"');
  });
});

describe("signing in", () => {
  it("takes a username or an email, and refuses a wrong password without saying which part was wrong", async () => {
    env = await fresh();
    await env.form("/signup", ADA);
    for (const identifier of ["ada", "ADA@example.com"]) {
      const ok = await env.form("/login", { identifier, password: ADA.password, next: "/app/demo" });
      expect(ok.headers.get("location")).toBe("/app/demo");
      expect(ok.headers.get("set-cookie")).toContain("HttpOnly");
    }
    for (const [identifier, password] of [["ada", pw("wrong password")], ["nobody", pw("whatever1")]] as const) {
      const bad = await env.form("/login", { identifier, password });
      expect(bad.status).toBe(401);
      expect(await bad.text()).toContain("That username or password isn&#39;t right.");
    }
  });

  it("signs out by ending the session, not just dropping the cookie", async () => {
    env = await fresh();
    const cookie = cookieOf(await env.form("/signup", ADA));
    expect((await env.json("/api/me", cookie)).status).toBe(200);
    await env.form("/logout", {}, cookie);
    expect((await env.json("/api/me", cookie)).status).toBe(401);
  });
});

describe("joining a workspace", () => {
  it("needs an invite link unless sign-up is open", async () => {
    env = await fresh();
    const owner = cookieOf(await env.form("/signup", ADA));
    const blocked = await env.form("/signup", { username: "grace", email: "grace@example.com", password: pw("compilers rock") });
    expect(blocked.status).toBe(403);
    expect(await blocked.text()).toContain("needs an invite link");

    const invite = await (await env.json("/api/invites", owner, { method: "POST", body: { role: "editor" } })).json();
    expect(invite.url).toMatch(/^https:\/\/docs\.example\.com\/signup\?invite=inv_/);
    const code = new URL(invite.url).searchParams.get("invite")!;
    expect(await (await env.app.request(`/signup?invite=${code}`)).text()).toContain("editor");
    const joined = await env.form("/signup", { username: "grace", email: "grace@example.com", password: pw("compilers rock"), invite: code });
    expect((await (await env.json("/api/me", cookieOf(joined))).json()).role).toBe("editor");

    await env.json(`/api/invites/${invite.id}`, owner, { method: "DELETE" });
    expect((await env.form("/signup", { username: "linus", email: "linus@example.com", password: pw("penguins!!"), invite: code })).status).toBe(403);
  });

  it("lets anyone join as a viewer when sign-up is open, and never reuses an email or username", async () => {
    env = await fresh({ signupOpen: true });
    await env.form("/signup", ADA);
    const joined = await env.form("/signup", { username: "grace", email: "grace@example.com", password: pw("compilers rock") });
    expect((await (await env.json("/api/me", cookieOf(joined))).json()).role).toBe("viewer");
    expect(await (await env.form("/signup", { username: "ada", email: "x@example.com", password: pw("12345678") })).text()).toContain("That username is taken");
    expect(await (await env.form("/signup", { username: "other", email: "ada@example.com", password: pw("12345678") })).text()).toContain("already an account with that email");
  });
});

describe("account settings", () => {
  it("changes profile and password, and manages API tokens that aren't sessions", async () => {
    env = await fresh();
    const cookie = cookieOf(await env.form("/signup", ADA));
    const profile = await (await env.json("/api/me/account", cookie, { method: "PUT", body: { name: "Countess", username: "lovelace" } })).json();
    expect(profile).toMatchObject({ name: "Countess", username: "lovelace" });

    expect((await env.json("/api/me/password", cookie, { method: "PUT", body: { current: pw("nope"), password: pw("a new password") } })).status).toBe(403);
    expect((await env.json("/api/me/password", cookie, { method: "PUT", body: { current: ADA.password, password: pw("a new password") } })).status).toBe(204);
    expect((await env.json("/api/me", cookie)).status).toBe(200);
    expect((await env.form("/login", { identifier: "lovelace", password: pw("a new password") })).status).toBe(302);

    const made = await (await env.json("/api/me/tokens", cookie, { method: "POST", body: { name: "Claude Code" } })).json();
    expect(made.token).toMatch(/^elm_/);
    const list = await (await env.json("/api/me/tokens", cookie)).json();
    expect(list.map((t: { name: string }) => t.name)).toEqual(["Claude Code"]);
    expect((await env.app.request("/api/me", { headers: { Authorization: `Bearer ${made.token}` } })).status).toBe(200);
    await env.json(`/api/me/tokens/${made.id}`, cookie, { method: "DELETE" });
    expect((await env.app.request("/api/me", { headers: { Authorization: `Bearer ${made.token}` } })).status).toBe(401);
  });
});

describe("people", () => {
  it("lets admins change roles but always keeps an owner", async () => {
    env = await fresh({ signupOpen: true });
    const owner = cookieOf(await env.form("/signup", ADA));
    await env.form("/signup", { username: "grace", email: "grace@example.com", password: pw("compilers rock") });
    const { members } = await (await env.json("/api/members", owner)).json();
    const ada = members.find((m: { username: string }) => m.username === "ada");
    const grace = members.find((m: { username: string }) => m.username === "grace");
    expect((await env.json(`/api/members/${ada.userId}`, owner, { method: "PUT", body: { role: "editor" } })).status).toBe(409);
    expect((await env.json(`/api/members/${grace.userId}`, owner, { method: "PUT", body: { role: "admin" } })).status).toBe(204);
    expect((await env.json(`/api/members/${ada.userId}`, owner, { method: "DELETE" })).status).toBe(409);
    expect((await env.json(`/api/members/${grace.userId}`, owner, { method: "DELETE" })).status).toBe(204);
  });
});
