import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { apiTokens, members, spaceMembers, spaces, users, workspaces, type Role, type Visibility } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { HttpError } from "./errors.js";

export interface Viewer {
  userId: string;
  email: string;
  role: Role | undefined;
  /** Private spaces in this workspace the viewer was added to. Owners read every space regardless. */
  privateSpaces?: string[];
}

export async function getWorkspace(db: Db, slug: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, slug));
  if (!ws) throw new HttpError(404, `Workspace "${slug}" does not exist. Run the bootstrap script first.`);
  return ws;
}

/** Creates the workspace (if needed), an owner, and an API token for them. Returns the token once. */
export async function bootstrap(db: Db, input: { workspaceSlug: string; workspaceName?: string; email: string; name?: string }) {
  return db.transaction(async (tx) => {
    let [ws] = await tx.select().from(workspaces).where(eq(workspaces.slug, input.workspaceSlug));
    if (!ws) {
      [ws] = await tx.insert(workspaces).values({ id: newId("ws"), slug: input.workspaceSlug, name: input.workspaceName ?? input.workspaceSlug }).returning();
    }
    let [user] = await tx.select().from(users).where(eq(users.email, input.email));
    if (!user) [user] = await tx.insert(users).values({ id: newId("usr"), email: input.email, name: input.name ?? null }).returning();
    await tx.insert(members).values({ workspaceId: ws!.id, userId: user!.id, role: "owner" }).onConflictDoNothing();
    const token = await issueToken(tx as unknown as Db, user!.id, "bootstrap");
    return { workspace: ws!, user: user!, token };
  });
}

/** Bootstraps only when the workspace doesn't exist yet; otherwise does nothing and returns undefined. */
export async function firstRun(db: Db, input: { workspaceSlug: string; email: string }) {
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, input.workspaceSlug));
  return ws ? undefined : bootstrap(db, input);
}

export async function issueToken(db: Db, userId: string, name: string): Promise<string> {
  const token = randomToken("elm");
  await db.insert(apiTokens).values({ id: newId("tok"), userId, tokenHash: sha256(token), name });
  return token;
}

export async function viewerForToken(db: Db, workspaceId: string, token: string): Promise<Viewer | undefined> {
  const [row] = await db
    .select({ userId: users.id, email: users.email, tokenId: apiTokens.id, expiresAt: apiTokens.expiresAt })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, sha256(token)));
  if (!row || (row.expiresAt && row.expiresAt < new Date())) return undefined;
  const [member] = await db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.userId, row.userId)));
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
  const privateSpaces = member
    ? (
        await db
          .select({ id: spaceMembers.spaceId })
          .from(spaceMembers)
          .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
          .where(and(eq(spaceMembers.userId, row.userId), eq(spaces.workspaceId, workspaceId)))
      ).map((r) => r.id)
    : [];
  return { userId: row.userId, email: row.email, role: member?.role, privateSpaces };
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function hasRole(viewer: Viewer | undefined, needed: Role): boolean {
  return Boolean(viewer?.role && RANK[viewer.role] >= RANK[needed]);
}

/**
 * The one rule for reading a space. Public: anyone. Workspace: any member.
 * Private: owners, plus members who were added to that space.
 */
export function canReadSpace(viewer: Viewer | undefined, space: { id: string; visibility: Visibility }): boolean {
  if (space.visibility === "public") return true;
  if (!viewer?.role) return false;
  if (space.visibility === "workspace") return true;
  return viewer.role === "owner" || Boolean(viewer.privateSpaces?.includes(space.id));
}
