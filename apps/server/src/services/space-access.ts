import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { members, spaceMembers, spaces, users } from "../db/schema.js";
import { HttpError } from "./errors.js";

type PrivateSpace = { id: string; workspaceId: string };

/** Everyone who can read a private space: the people added to it, and the workspace owners (always). */
export async function listMembers(db: Db, space: PrivateSpace) {
  const added = await db
    .select({ userId: users.id, email: users.email, name: users.name, username: users.username, role: members.role, addedAt: spaceMembers.createdAt })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .innerJoin(members, and(eq(members.userId, spaceMembers.userId), eq(members.workspaceId, space.workspaceId)))
    .where(eq(spaceMembers.spaceId, space.id))
    .orderBy(spaceMembers.createdAt);
  const owners = await db
    .select({ userId: users.id, email: users.email, name: users.name, username: users.username, role: members.role })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.workspaceId, space.workspaceId), eq(members.role, "owner")));
  return [
    ...owners.map((o) => ({ ...o, addedAt: null, always: true })),
    ...added.filter((a) => a.role !== "owner").map((a) => ({ ...a, always: false })),
  ];
}

/** Adds a workspace member to a private space. Adding someone twice is fine. */
export async function addMember(db: Db, space: PrivateSpace, userId: string, addedBy: string) {
  const [m] = await db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, space.workspaceId), eq(members.userId, userId)));
  if (!m) throw new HttpError(404, "Invite them to the workspace first, then add them to this space.");
  await db.insert(spaceMembers).values({ spaceId: space.id, userId, addedBy }).onConflictDoNothing();
}

export async function removeMember(db: Db, space: PrivateSpace, userId: string) {
  const [m] = await db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, space.workspaceId), eq(members.userId, userId)));
  if (m?.role === "owner") throw new HttpError(409, "Owners can read every space. Change their workspace role first.");
  await db.delete(spaceMembers).where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)));
}

/** Drops someone from every private space in a workspace, when they leave it. */
export async function removeFromWorkspace(db: Db, workspaceId: string, userId: string) {
  const ids = db.select({ id: spaces.id }).from(spaces).where(eq(spaces.workspaceId, workspaceId));
  await db.delete(spaceMembers).where(and(eq(spaceMembers.userId, userId), inArray(spaceMembers.spaceId, ids)));
}
