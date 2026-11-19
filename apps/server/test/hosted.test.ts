import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationsFolder } from "../src/db/connect.js";
import type { Db } from "../src/db/index.js";
import * as schema from "../src/db/schema.js";
import { createHostedServer } from "../src/hosted.js";
import { MemoryBlobStore } from "../src/lib/blobs.js";
import type { Config } from "../src/lib/config.js";
import { handoffCode, STARTER_PAGE } from "../src/services/hosted.js";
import { createElemnt } from "@elemnt/core";

const DOMAIN = "hosted.test";
const HOME = `https://${DOMAIN}`;
const COOKIE = "__Host-elemnt_token";

let client: PGlite;
let server: ReturnType<typeof createHostedServer>;
let config: Config;

async function start(approval = false) {
  client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder });
  config = {
    publicUrl: HOME,
    sandboxUrl: `https://sandbox.${DOMAIN}`,
    workspaceSlug: "unused",
    secretKey: randomBytes(32).toString("base64"),
    anthropicApiKey: "server-key-never-shared",
    hosted: { domain: DOMAIN, operators: ["oper@example.com"], home: HOME, approval },
  };
  server = createHostedServer({ db, blobs: new MemoryBlobStore(), config });
  return db;
}

/** A browser: one cookie per host, no redirects followed. */
function browser() {
  const jar = new Map<string, string>();
  return async (url: string, init: RequestInit & { form?: Record<string, string>; json?: unknown } = {}) => {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    const cookie = jar.get(u.host);
    if (cookie) headers.set("Cookie", `${COOKIE}=${cookie}`);
    let body = init.body;
    if (init.form) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      headers.set("Origin", u.origin);
      body = new URLSearchParams(init.form).toString();
    }
    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
      headers.set("Origin", u.origin);
      body = JSON.stringify(init.json);
    }
    const res = await server.fetch(new Request(url, { ...init, method: init.method ?? (body ? "POST" : "GET"), headers, ...(body ? { body } : {}) }));
    const set = res.headers.get("set-cookie")?.match(new RegExp(`${COOKIE}=([^;]*)`));
    if (set) set[1] ? jar.set(u.host, set[1]) : jar.delete(u.host);
    return res;
  };
}

const person = (n: string) => ({ name: n, username: n, email: `${n}@example.com`, password: "correct horse battery" });

/** Signs up at the main address and follows the hand-off into the new workspace. */
async function signUp(b: ReturnType<typeof browser>, who: string, slug: string, extra: Record<string, string> = {}) {
  const res = await b(`${HOME}/signup`, { form: { ...person(who), wsname: `${who}'s docs`, slug, ...extra } });
  return res;
}

async function enter(b: ReturnType<typeof browser>, slug: string) {
  const go = await b(`${HOME}/go/${slug}`);
  expect(go.status).toBe(302);
  const to = go.headers.get("location")!;
  expect(to.startsWith(`https://${slug}.${DOMAIN}/hosted/enter?code=`)).toBe(true);
  return b(to);
}

afterEach(() => client.close());

describe("hosted mode, instant workspaces", () => {
  let db: Db;
  beforeEach(async () => {
    db = await start();
  });

  it("signs up, picks an address and lands in the workspace signed in, with a starter page", async () => {
    const b = browser();
    expect(await (await b(`${HOME}/`)).text()).toContain("Create your workspace");
    const res = await signUp(b, "ann", "ann");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/go/ann?welcome=1");
    const entered = await enter(b, "ann");
    expect(entered.status).toBe(302);
    expect(entered.headers.get("location")).toBe("/app/");

    const me = (await (await b(`https://ann.${DOMAIN}/api/me`)).json()) as { role: string; hostedHome: string };
    expect(me.role).toBe("owner");
    expect(me.hostedHome).toBe(HOME);
    const tree = (await (await b(`https://ann.${DOMAIN}/api/spaces/docs/tree`)).json()) as { pages: { path: string }[] };
    expect(tree.pages.map((p) => p.path)).toEqual(["welcome"]);

    // The dashboard lists it.
    expect(await (await b(`${HOME}/`)).text()).toContain(`ann.${DOMAIN}`);
  });

  it("starter page compiles cleanly", () => {
    expect(createElemnt().compile(STARTER_PAGE).ok).toBe(true);
  });

  it("checks addresses as you type", async () => {
    const b = browser();
    await signUp(b, "ann", "ann");
    const check = async (slug: string) => (await (await b(`${HOME}/api/check-address?slug=${slug}`)).json()) as { ok: boolean; reason?: string; address?: string };
    expect(await check("bob")).toEqual({ ok: true, address: `bob.${DOMAIN}` });
    expect((await check("ann")).reason).toContain("taken");
    expect((await check("admin")).reason).toContain("reserved");
    expect((await check("a")).ok).toBe(false);
    expect((await check("a--b")).ok).toBe(false);
  });

  it("refuses a taken address without making the account", async () => {
    await signUp(browser(), "ann", "ann");
    const res = await signUp(browser(), "bob", "ann");
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("taken");
    const bobs = await db.query.users.findMany({ where: (u, { eq }) => eq(u.username, "bob") });
    expect(bobs).toHaveLength(0);
  });

  it("hand-off codes work once, for that workspace and that person only", async () => {
    const b = browser();
    await signUp(b, "ann", "ann");
    await signUp(browser(), "bob", "bobs");
    const go = await b(`${HOME}/go/ann`);
    const to = go.headers.get("location")!;
    expect((await browser()(to)).headers.get("location")).toBe("/app/");
    expect((await browser()(to)).headers.get("location")).toBe("/login");
    // Ann isn't in bob's workspace: no hand-off, and a forged one for that host doesn't sign her in.
    expect((await b(`${HOME}/go/bobs`)).headers.get("location")).toBe("/");
    const [ann] = await db.select().from(schema.users).where((await import("drizzle-orm")).eq(schema.users.username, "ann"));
    const forged = handoffCode(config.secretKey, ann!.id, "bobs");
    expect((await browser()(`https://bobs.${DOMAIN}/hosted/enter?code=${encodeURIComponent(forged)}`)).headers.get("location")).toBe("/login");
    expect((await browser()(`https://ann.${DOMAIN}/hosted/enter?code=${encodeURIComponent(forged)}`)).headers.get("location")).toBe("/login");
  });

  it("an invited person with an account signs in to join", async () => {
    const ann = browser();
    await signUp(ann, "ann", "ann");
    await enter(ann, "ann");
    const invite = (await (await ann(`https://ann.${DOMAIN}/api/invites`, { json: { role: "editor" } })).json()) as { url: string };
    expect(invite.url.startsWith(`https://ann.${DOMAIN}/signup?invite=`)).toBe(true);
    const code = new URL(invite.url).searchParams.get("invite")!;

    const bob = browser();
    await signUp(bob, "bob", "bobs");
    expect(await (await bob(`https://ann.${DOMAIN}/login?invite=${encodeURIComponent(code)}`)).text()).toContain("join as");
    const res = await bob(`https://ann.${DOMAIN}/login`, { form: { identifier: "bob", password: person("bob").password, invite: code, next: "/app/" } });
    expect(res.status).toBe(302);
    const me = (await (await bob(`https://ann.${DOMAIN}/api/me`)).json()) as { role: string };
    expect(me.role).toBe("editor");
    // Both now show on bob's dashboard.
    const dash = await (await bob(`${HOME}/`)).text();
    expect(dash).toContain(`ann.${DOMAIN}`);
    expect(dash).toContain(`bobs.${DOMAIN}`);
  });

  it("caps each person at three workspaces", async () => {
    const b = browser();
    await signUp(b, "ann", "ann-one");
    for (const slug of ["ann-two", "ann-three"]) expect((await b(`${HOME}/workspaces`, { form: { wsname: slug, slug } })).status).toBe(302);
    const fourth = await b(`${HOME}/workspaces`, { form: { wsname: "four", slug: "ann-four" } });
    expect(fourth.status).toBe(409);
    expect(await fourth.text()).toContain("the most one person can have");
    expect((await b(`${HOME}/api/check-address?slug=ann-four`)).status).toBe(200);
  });

  it("unknown addresses show nothing; operators can suspend; others can't see /admin", async () => {
    const ann = browser();
    await signUp(ann, "ann", "ann");
    expect((await browser()(`https://nobody.${DOMAIN}/`)).status).toBe(404);
    expect((await ann(`${HOME}/admin`)).status).toBe(404);

    const op = browser();
    await signUp(op, "oper", "ops-team");
    const page = await (await op(`${HOME}/admin`)).text();
    expect(page).toContain(`ann.${DOMAIN}`);
    expect((await op(`${HOME}/admin/workspaces/ann`, { form: { action: "suspend" } })).status).toBe(200);
    expect((await ann(`https://ann.${DOMAIN}/api/me`)).status).toBe(403);
    await op(`${HOME}/admin/workspaces/ann`, { form: { action: "resume" } });
    expect((await enter(ann, "ann")).headers.get("location")).toBe("/app/");
  });

  it("never lends the server's Claude key to a workspace", async () => {
    const ann = browser();
    await signUp(ann, "ann", "ann");
    await enter(ann, "ann");
    const res = await ann(`https://ann.${DOMAIN}/api/explain`, { json: { repo: "https://github.com/acme/rocket" } });
    expect(res.status).not.toBe(200);
  });

  it("keeps workspace addresses away from websites, and certificates to known names", async () => {
    const ann = browser();
    await signUp(ann, "ann", "ann");
    await enter(ann, "ann");
    await ann(`https://ann.${DOMAIN}/api/spaces`, { json: { slug: "web", name: "Web", visibility: "public" } });
    const made = await ann(`https://ann.${DOMAIN}/api/sites`, { json: { slug: "rocket", name: "Rocket", space: "web" } });
    expect(made.status).toBe(201);
    const steal = await ann(`https://ann.${DOMAIN}/api/sites/rocket`, { method: "PATCH", json: { hostname: `bob.${DOMAIN}` } });
    expect(steal.status).toBe(400);
    expect((await ann(`https://ann.${DOMAIN}/api/sites/rocket`, { method: "PATCH", json: { hostname: "docs.rocket.dev" } })).status).toBe(200);

    const tls = async (d: string) => (await server.fetch(new Request(`http://server:8787/internal/tls-allow?domain=${d}`))).status;
    expect(await tls(DOMAIN)).toBe(200);
    expect(await tls(`sandbox.${DOMAIN}`)).toBe(200);
    expect(await tls(`ann.${DOMAIN}`)).toBe(200);
    expect(await tls(`nobody.${DOMAIN}`)).toBe(404);
    expect(await tls("docs.rocket.dev")).toBe(404); // not published yet
    expect(await tls("evil.example")).toBe(404);
  });
});

describe("hosted mode, with approval turned on", () => {
  it("waits for an operator, then opens", async () => {
    await start(true);
    const ann = browser();
    const res = await signUp(ann, "ann", "ann", { purpose: "Docs for my side project." });
    expect(res.headers.get("location")).toBe("/?asked=1");
    expect(await (await ann(`${HOME}/?asked=1`)).text()).toContain("waiting");
    expect((await browser()(`https://ann.${DOMAIN}/`)).status).toBe(404);

    const op = browser();
    await signUp(op, "oper", "ops", { purpose: "Running this server." });
    const admin = await (await op(`${HOME}/admin`)).text();
    const id = admin.match(/\/admin\/requests\/([^"]+)"/g)!.map((m) => m.slice(16, -1));
    // Approve ann's (the first one asked).
    expect((await op(`${HOME}/admin/requests/${id[0]}`, { form: { decision: "approve" } })).status).toBe(200);
    expect((await enter(ann, "ann")).headers.get("location")).toBe("/app/");
  });
});
