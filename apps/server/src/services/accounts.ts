import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { apiTokens, invites, members, users, workspaces, type Role } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../lib/password.js";
import { HttpError } from "./errors.js";

/**
 * People and their accounts: sign-up, sign-in, sessions, API tokens,
 * members and invite links. The first account in a fresh install creates the
 * workspace and owns it; after that, people join with an invite link (or
 * freely, as viewers, when the server runs with ELEMNT_SIGNUP=open).
 */

export const SESSION_DAYS = 30;
const INVITE_DAYS = 7;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{2,29}$/, "Usernames are 3 to 30 letters, digits, - or _, starting with a letter or digit.");
export const passwordSchema = z.string().min(8, "Use at least 8 characters.").max(200, "That password is too long.");
const emailSchema = z.string().trim().toLowerCase().email("That doesn't look like an email address.");
const nameSchema = z.string().trim().max(80).optional();

export const signupSchema = z.object({
  name: nameSchema,
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  invite: z.string().trim().optional(),
});
export type SignupInput = z.input<typeof signupSchema>;

/** What a sign-up form needs to know before it's filled in. */
export async function signupState(db: Db, slug: string, open: boolean, inviteCode?: string) {
  const [ws] = await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) return { allowed: true as const, firstAccount: true, role: "owner" as Role };
  const invite = inviteCode ? await findInvite(db, ws.id, inviteCode) : undefined;
  if (invite) return { allowed: true as const, firstAccount: false, role: invite.role, workspaceName: ws.name };
  if (open) return { allowed: true as const, firstAccount: false, role: "viewer" as Role, workspaceName: ws.name };
  return { allowed: false as const, firstAccount: false, workspaceName: ws.name, reason: inviteCode ? "That invite link has expired or was revoked. Ask for a new one." : "Joining needs an invite link. Ask a workspace admin for one." };
}

async function findInvite(db: Db, workspaceId: string, code: string) {
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.workspaceId, workspaceId), eq(invites.codeHash, sha256(code)), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())));
  return row;
}

/** Creates the account and its membership, and returns a session token. */
export async function signup(db: Db, slug: string, open: boolean, raw: unknown) {
  const input = signupSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    let [ws] = await t.select().from(workspaces).where(eq(workspaces.slug, slug));
    let role: Role;
    let inviteId: string | undefined;
    if (!ws) {
      [ws] = await t.insert(workspaces).values({ id: newId("ws"), slug, name: input.name ? `${input.name.split(" ")[0]}'s docs` : "Elemnt" }).returning();
      role = "owner";
    } else {
      const invite = input.invite ? await findInvite(t, ws.id, input.invite) : undefined;
      if (invite) {
        role = invite.role;
        inviteId = invite.id;
      } else if (open) role = "viewer";
      else throw new HttpError(403, input.invite ? "That invite link has expired or was revoked. Ask for a new one." : "Joining needs an invite link. Ask a workspace admin for one.");
    }
    const [taken] = await t
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(or(eq(users.email, input.email), eq(users.username, input.username)));
    if (taken) throw new HttpError(409, taken.username === input.username ? "That username is taken. Try another." : "There's already an account with that email. Sign in instead.", { field: taken.username === input.username ? "username" : "email" });
    const [user] = await t
      .insert(users)
      .values({ id: newId("usr"), email: input.email, username: input.username, name: input.name || null, passwordHash })
      .returning();
    await t.insert(members).values({ workspaceId: ws!.id, userId: user!.id, role }).onConflictDoNothing();
    if (inviteId) await t.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.id, inviteId));
    const token = await issueSession(t, user!.id);
    return { user: user!, role, token, workspace: ws! };
  });
}

/** Checks a username-or-email and password. Takes the same time whether or not the account exists. */
export async function login(db: Db, identifier: string, password: string) {
  const id = identifier.trim().toLowerCase();
  const [user] = id ? await db.select().from(users).where(id.includes("@") ? eq(users.email, id) : eq(users.username, id)) : [];
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) throw new HttpError(401, "That username or password isn't right.");
  return { user, token: await issueSession(db, user.id) };
}

export async function issueSession(db: Db, userId: string) {
  const token = randomToken("elm");
  await db.insert(apiTokens).values({ id: newId("tok"), userId, tokenHash: sha256(token), name: "Browser session", kind: "session", expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) });
  return token;
}

export async function endSession(db: Db, token: string) {
  await db.delete(apiTokens).where(and(eq(apiTokens.tokenHash, sha256(token)), eq(apiTokens.kind, "session")));
}

// ---------- your account ----------

export async function account(db: Db, userId: string) {
  const [u] = await db.select({ email: users.email, name: users.name, username: users.username, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(404, "No such account.");
  return { email: u.email, name: u.name, username: u.username, hasPassword: Boolean(u.passwordHash) };
}

export async function updateProfile(db: Db, userId: string, raw: unknown) {
  const input = z.object({ name: nameSchema, username: usernameSchema.optional() }).parse(raw);
  if (input.username) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, input.username));
    if (taken && taken.id !== userId) throw new HttpError(409, "That username is taken. Try another.");
  }
  await db
    .update(users)
    .set({ ...(input.name !== undefined ? { name: input.name || null } : {}), ...(input.username ? { username: input.username } : {}) })
    .where(eq(users.id, userId));
  return account(db, userId);
}

/** Sets or changes the password. Changing one needs the current password; setting the first one doesn't. */
export async function changePassword(db: Db, userId: string, raw: unknown, keepToken?: string) {
  const input = z.object({ current: z.string().optional(), password: passwordSchema }).parse(raw);
  const [u] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (u?.passwordHash && !(input.current && (await verifyPassword(input.current, u.passwordHash)))) throw new HttpError(403, "Your current password isn't right.");
  await db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, userId));
  // Other browsers signed in with the old password are signed out.
  const sessions = await db.select({ id: apiTokens.id, tokenHash: apiTokens.tokenHash }).from(apiTokens).where(and(eq(apiTokens.userId, userId), eq(apiTokens.kind, "session")));
  for (const s of sessions) if (!keepToken || s.tokenHash !== sha256(keepToken)) await db.delete(apiTokens).where(eq(apiTokens.id, s.id));
}

export async function listTokens(db: Db, userId: string) {
  return db
    .select({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt, expiresAt: apiTokens.expiresAt, clientId: apiTokens.clientId })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), eq(apiTokens.kind, "api")))
    .orderBy(apiTokens.createdAt);
}

export async function createToken(db: Db, userId: string, raw: unknown) {
  const { name } = z.object({ name: z.string().trim().min(1, "Give the token a name, like \"Claude Code on my laptop\".").max(80) }).parse(raw);
  const token = randomToken("elm");
  const id = newId("tok");
  await db.insert(apiTokens).values({ id, userId, tokenHash: sha256(token), name, kind: "api" });
  return { id, name, token };
}

export async function revokeToken(db: Db, userId: string, id: string) {
  const gone = await db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId))).returning({ id: apiTokens.id });
  if (!gone.length) throw new HttpError(404, "No such token.");
}

// ---------- people (admins) ----------

export async function listMembers(db: Db, workspaceId: string) {
  return db
    .select({ userId: users.id, email: users.email, name: users.name, username: users.username, role: members.role, joinedAt: users.createdAt })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.workspaceId, workspaceId))
    .orderBy(users.createdAt);
}

async function ownerCount(db: Db, workspaceId: string) {
  const rows = await db.select({ userId: members.userId }).from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.role, "owner")));
  return rows.length;
}

/** Only owners can make or unmake owners, and a workspace always keeps one. */
export async function setRole(db: Db, workspaceId: string, actorRole: Role, userId: string, role: Role) {
  const [m] = await db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)));
  if (!m) throw new HttpError(404, "That person isn't in this workspace.");
  if ((m.role === "owner" || role === "owner") && actorRole !== "owner") throw new HttpError(403, "Only an owner can change who owns the workspace.");
  if (m.role === "owner" && role !== "owner" && (await ownerCount(db, workspaceId)) < 2) throw new HttpError(409, "The workspace needs at least one owner. Make someone else an owner first.");
  await db.update(members).set({ role }).where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)));
}

export async function removeMember(db: Db, workspaceId: string, actorRole: Role, userId: string) {
  const [m] = await db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)));
  if (!m) throw new HttpError(404, "That person isn't in this workspace.");
  if (m.role === "owner" && actorRole !== "owner") throw new HttpError(403, "Only an owner can remove an owner.");
  if (m.role === "owner" && (await ownerCount(db, workspaceId)) < 2) throw new HttpError(409, "The workspace needs at least one owner.");
  await db.delete(members).where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)));
  await db.delete(apiTokens).where(and(eq(apiTokens.userId, userId), eq(apiTokens.kind, "session")));
}

export async function listInvites(db: Db, workspaceId: string) {
  return db
    .select({ id: invites.id, role: invites.role, expiresAt: invites.expiresAt, uses: invites.uses, createdAt: invites.createdAt })
    .from(invites)
    .where(and(eq(invites.workspaceId, workspaceId), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
    .orderBy(invites.createdAt);
}

export async function createInvite(db: Db, workspaceId: string, actor: { userId: string; role: Role }, raw: unknown) {
  const { role } = z.object({ role: z.enum(["admin", "editor", "viewer"]) }).parse(raw);
  if (role === "admin" && actor.role !== "owner" && actor.role !== "admin") throw new HttpError(403, "Only admins can invite admins.");
  const code = randomToken("inv");
  const id = newId("inv");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  await db.insert(invites).values({ id, workspaceId, codeHash: sha256(code), role, createdBy: actor.userId, expiresAt });
  return { id, role, code, expiresAt };
}

export async function revokeInvite(db: Db, workspaceId: string, id: string) {
  await db.update(invites).set({ revokedAt: new Date() }).where(and(eq(invites.id, id), eq(invites.workspaceId, workspaceId)));
}
