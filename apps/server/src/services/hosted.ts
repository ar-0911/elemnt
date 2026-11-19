import { createHmac } from "node:crypto";
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { members, users, workspaceRequests, workspaces } from "../db/schema.js";
import { createPage, createSpace, type PageDeps } from "./pages.js";
import { safeEqual } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { HttpError } from "./errors.js";

/**
 * Hosted mode: one server, many workspaces, each at <slug>.<domain>. People
 * make an account at the domain itself and pick an address. The workspace goes
 * live at once, or, with ELEMNT_HOSTED_APPROVAL=on, once an operator approves
 * it. Nothing here runs on a normal (single-workspace) install.
 */

/** Each person may own this many workspaces, and have one request waiting. */
export const MAX_OWNED = 3;

/** Names a workspace can't take: infrastructure, auth, and look-alikes. */
export const RESERVED = new Set([
  "www", "app", "api", "admin", "administrator", "root", "mail", "email", "smtp", "imap", "pop", "mx", "ns", "ns1", "ns2", "ftp", "sftp",
  "sandbox", "sites", "www2", "usercontent", "static", "assets", "cdn", "media", "files", "img", "images", "status", "health", "metrics",
  "auth", "login", "logout", "signin", "signup", "register", "account", "accounts", "billing", "pay", "payments", "secure", "security",
  "help", "support", "docs", "blog", "news", "about", "legal", "terms", "privacy", "abuse", "postmaster", "hostmaster", "webmaster",
  "elemnt", "official", "team", "staff", "operator", "operators", "internal", "test", "demo", "example", "localhost",
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, "Use 3 to 30 letters, digits or hyphens, starting and ending with a letter or digit.")
  .refine((s) => !s.includes("--"), "Use single hyphens only.")
  .refine((s) => !RESERVED.has(s), "That name is reserved. Pick another.");

export const workspaceSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1, "Give it a name.").max(80),
});

export const requestSchema = workspaceSchema.extend({
  purpose: z.string().trim().min(10, "Say a little about what it's for (at least 10 characters).").max(1000),
});

/** Whether an address can be taken, with the reason if not. For the live check on the sign-up form. */
export async function checkSlug(db: Db, raw: string): Promise<{ ok: true; slug: string } | { ok: false; reason: string }> {
  const parsed = slugSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]!.message };
  if (await slugTaken(db, parsed.data)) return { ok: false, reason: "That address is taken. Pick another." };
  return { ok: true, slug: parsed.data };
}

export function workspaceUrl(home: string, domain: string, slug: string) {
  const u = new URL(home);
  return `${u.protocol}//${slug}.${domain}${u.port ? `:${u.port}` : ""}`;
}

/** The workspace a host names, if it's <slug>.<domain>. */
export function slugForHost(host: string, domain: string): string | undefined {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (!h.endsWith(`.${domain}`)) return undefined;
  const label = h.slice(0, -domain.length - 1);
  return label && !label.includes(".") ? label : undefined;
}

/** Whether a slug is free: no workspace has it and nobody is waiting on it. */
async function slugTaken(db: Db, slug: string) {
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug));
  if (ws) return true;
  const [pending] = await db.select({ id: workspaceRequests.id }).from(workspaceRequests).where(and(eq(workspaceRequests.slug, slug), eq(workspaceRequests.status, "pending")));
  return Boolean(pending);
}

export async function ownedCount(db: Db, userId: string) {
  const [row] = await db.select({ n: count() }).from(members).where(and(eq(members.userId, userId), eq(members.role, "owner")));
  return row?.n ?? 0;
}

async function mayOwnAnother(db: Db, userId: string, slug: string) {
  if ((await ownedCount(db, userId)) >= MAX_OWNED) throw new HttpError(409, `You already own ${MAX_OWNED} workspaces, the most one person can have here.`);
  if (await slugTaken(db, slug)) throw new HttpError(409, "That address is taken. Pick another.", { field: "slug" });
}

/** Approval mode: asks an operator for a workspace. */
export async function requestWorkspace(db: Db, userId: string, raw: unknown) {
  const input = requestSchema.parse(raw);
  const [open] = await db.select({ id: workspaceRequests.id }).from(workspaceRequests).where(and(eq(workspaceRequests.userId, userId), eq(workspaceRequests.status, "pending")));
  if (open) throw new HttpError(409, "You already have a request waiting. You'll be able to ask for another once it's decided.");
  await mayOwnAnother(db, userId, input.slug);
  const [row] = await db.insert(workspaceRequests).values({ id: newId("wsr"), userId, ...input }).returning();
  return row!;
}

/** Instant mode: makes the workspace now, owned by this person, with a starter space to write in. */
export async function createWorkspaceNow(deps: PageDeps, userId: string, raw: unknown) {
  const input = workspaceSchema.parse(raw);
  await mayOwnAnother(deps.db, userId, input.slug);
  const ws = await deps.db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [made] = await t.insert(workspaces).values({ id: newId("ws"), slug: input.slug, name: input.name }).onConflictDoNothing().returning();
    if (!made) throw new HttpError(409, "That address was just taken. Pick another.", { field: "slug" });
    await t.insert(members).values({ workspaceId: made.id, userId, role: "owner" });
    return made;
  });
  await starterContent(deps, ws.id, userId);
  return ws;
}

/** A first space and page, so a new workspace isn't an empty screen. Best effort. */
async function starterContent(deps: PageDeps, workspaceId: string, userId: string) {
  try {
    const space = await createSpace(deps.db, workspaceId, { slug: "docs", name: "Docs", visibility: "workspace" });
    await createPage(deps, { spaceId: space.id, path: "welcome", source: STARTER_PAGE, authorId: userId, message: "Starter page" });
  } catch (err) {
    console.error("starter content failed", err);
  }
}

export const STARTER_PAGE = `---
title: Welcome to your workspace
summary: A page to edit, or delete once you've found your way around.
---

This is your first page. Click **Edit** to change it: Markdown on the left, the finished page on the right.

:::callout{type=tip}
Start a line with / to insert a component: callouts, steps, charts, diagrams and more.
:::

## Three things to do first

1. **Add your Claude key** in Settings, under Claude API key. Your workspace uses its own key.
2. **Connect Claude Code** from Settings, under Connect Claude, so Claude can write drafts here for you to review.
3. **Invite people** from Settings, under People. Each invite link carries a role.

This space, *Docs*, is visible to members of this workspace only. Make a public space when you want to publish something for everyone.
`;

/** Your workspaces (with your role) and your requests, newest first. */
export async function mine(db: Db, userId: string) {
  const spaces = await db
    .select({ slug: workspaces.slug, name: workspaces.name, role: members.role })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(eq(members.userId, userId))
    .orderBy(workspaces.name);
  const requests = await db.select().from(workspaceRequests).where(eq(workspaceRequests.userId, userId)).orderBy(desc(workspaceRequests.createdAt)).limit(10);
  return { workspaces: spaces, requests };
}

export async function pendingRequests(db: Db) {
  return db
    .select({ id: workspaceRequests.id, slug: workspaceRequests.slug, name: workspaceRequests.name, purpose: workspaceRequests.purpose, createdAt: workspaceRequests.createdAt, email: users.email, username: users.username, userName: users.name })
    .from(workspaceRequests)
    .innerJoin(users, eq(users.id, workspaceRequests.userId))
    .where(eq(workspaceRequests.status, "pending"))
    .orderBy(workspaceRequests.createdAt);
}

/** Approves a request: creates the workspace, owned by whoever asked. */
export async function approve(deps: PageDeps, id: string, operatorId: string) {
  const ws = await deps.db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [req] = await t.select().from(workspaceRequests).where(eq(workspaceRequests.id, id));
    if (!req || req.status !== "pending") throw new HttpError(409, "That request isn't waiting any more.");
    const [clash] = await t.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, req.slug));
    if (clash) throw new HttpError(409, `A workspace called ${req.slug} already exists. Decline this request.`);
    const [ws] = await t.insert(workspaces).values({ id: newId("ws"), slug: req.slug, name: req.name }).returning();
    await t.insert(members).values({ workspaceId: ws!.id, userId: req.userId, role: "owner" });
    await t.update(workspaceRequests).set({ status: "approved", workspaceId: ws!.id, decidedBy: operatorId, decidedAt: new Date() }).where(eq(workspaceRequests.id, id));
    return { ws: ws!, owner: req.userId };
  });
  await starterContent(deps, ws.ws.id, ws.owner);
  return ws.ws;
}

export async function decline(db: Db, id: string, operatorId: string, note?: string) {
  const updated = await db
    .update(workspaceRequests)
    .set({ status: "declined", decidedBy: operatorId, decidedAt: new Date(), note: note?.slice(0, 500) || null })
    .where(and(eq(workspaceRequests.id, id), eq(workspaceRequests.status, "pending")))
    .returning({ id: workspaceRequests.id });
  if (!updated.length) throw new HttpError(409, "That request isn't waiting any more.");
}

// ---------- operators ----------

/** Every workspace, newest first, with its owner and size, for the /admin page. */
export async function allWorkspaces(db: Db) {
  const owners = db
    .select({ workspaceId: members.workspaceId, email: sql<string>`min(${users.email})`.as("owner_email") })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.role, "owner"))
    .groupBy(members.workspaceId)
    .as("owners");
  const sizes = db.select({ workspaceId: members.workspaceId, n: count().as("n") }).from(members).groupBy(members.workspaceId).as("sizes");
  return db
    .select({ slug: workspaces.slug, name: workspaces.name, createdAt: workspaces.createdAt, suspendedAt: workspaces.suspendedAt, owner: owners.email, members: sizes.n })
    .from(workspaces)
    .leftJoin(owners, eq(owners.workspaceId, workspaces.id))
    .leftJoin(sizes, eq(sizes.workspaceId, workspaces.id))
    .orderBy(desc(workspaces.createdAt))
    .limit(500);
}

export async function setSuspended(db: Db, slug: string, suspended: boolean) {
  const updated = await db.update(workspaces).set({ suspendedAt: suspended ? new Date() : null }).where(eq(workspaces.slug, slug)).returning({ id: workspaces.id });
  if (!updated.length) throw new HttpError(404, "No workspace with that address.");
}

/** A live workspace by address: undefined if there's none or it's suspended. */
export async function liveWorkspace(db: Db, slug: string) {
  const [ws] = await db.select({ id: workspaces.id, suspendedAt: workspaces.suspendedAt }).from(workspaces).where(eq(workspaces.slug, slug));
  return ws ? { id: ws.id, suspended: Boolean(ws.suspendedAt) } : undefined;
}

export const suspendedCount = async (db: Db) => (await db.select({ n: count() }).from(workspaces).where(isNotNull(workspaces.suspendedAt)))[0]?.n ?? 0;

// ---------- signing in to a workspace from the main address ----------

/**
 * A one-minute code that carries a signed-in person from the main address to
 * one of their workspaces, so they don't type their password again. It names
 * the user and the workspace and is signed with the server's secret.
 */
export function handoffCode(secret: string, userId: string, slug: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + 60;
  const body = `${userId}.${slug}.${exp}`;
  return `${Buffer.from(body).toString("base64url")}.${sign(secret, body)}`;
}

export function readHandoff(secret: string, code: string, slug: string, now = Date.now()): string | undefined {
  const [b64, mac] = code.split(".");
  if (!b64 || !mac) return undefined;
  const body = Buffer.from(b64, "base64url").toString();
  if (!safeEqual(mac, sign(secret, body))) return undefined;
  const [userId, forSlug, exp] = body.split(".");
  if (forSlug !== slug || !userId || Number(exp) * 1000 < now) return undefined;
  return userId;
}

function sign(secret: string, body: string) {
  return createHmac("sha256", `handoff:${secret}`).update(body).digest("base64url");
}
