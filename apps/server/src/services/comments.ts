import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { comments, users } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import { HttpError } from "./errors.js";

export type Anchor = { exact: string; prefix?: string; suffix?: string };

export async function listComments(db: Db, pageId: string) {
  return db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      revisionId: comments.revisionId,
      anchor: comments.anchor,
      body: comments.body,
      authorId: comments.authorId,
      authorEmail: users.email,
      authorName: users.name,
      resolvedAt: comments.resolvedAt,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.pageId, pageId))
    .orderBy(asc(comments.createdAt));
}

export async function addComment(db: Db, input: { pageId: string; authorId: string; body: string; anchor?: Anchor; parentId?: string; revisionId?: string | null }) {
  if (input.parentId) {
    const [parent] = await db.select().from(comments).where(and(eq(comments.id, input.parentId), eq(comments.pageId, input.pageId), isNull(comments.parentId)));
    if (!parent) throw new HttpError(404, "The comment you're replying to doesn't exist on this page.");
  }
  const [row] = await db
    .insert(comments)
    .values({
      id: newId("cmt"),
      pageId: input.pageId,
      parentId: input.parentId ?? null,
      revisionId: input.revisionId ?? null,
      anchor: input.parentId ? null : (input.anchor ?? null),
      authorId: input.authorId,
      body: input.body,
    })
    .returning();
  return row!;
}

export async function setResolved(db: Db, input: { pageId: string; commentId: string; userId: string; resolved: boolean }) {
  const [row] = await db
    .update(comments)
    .set(input.resolved ? { resolvedAt: new Date(), resolvedBy: input.userId } : { resolvedAt: null, resolvedBy: null })
    .where(and(eq(comments.id, input.commentId), eq(comments.pageId, input.pageId), isNull(comments.parentId)))
    .returning();
  if (!row) throw new HttpError(404, "Comment thread not found.");
  return row;
}

/** Authors delete their own comments; admins can delete any. Replies go with their thread. */
export async function deleteComment(db: Db, input: { pageId: string; commentId: string; userId: string; isAdmin: boolean }) {
  const [row] = await db.select().from(comments).where(and(eq(comments.id, input.commentId), eq(comments.pageId, input.pageId)));
  if (!row) throw new HttpError(404, "Comment not found.");
  if (row.authorId !== input.userId && !input.isAdmin) throw new HttpError(403, "You can only delete your own comments.");
  await db.delete(comments).where(eq(comments.parentId, row.id));
  await db.delete(comments).where(eq(comments.id, row.id));
}
