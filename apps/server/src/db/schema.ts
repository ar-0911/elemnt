import { sql } from "drizzle-orm";
import { bigserial, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: createdAt(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** The workspace's own Anthropic API key (bring your own key), AES-256-GCM sealed. */
  aiKeyCiphertext: text("ai_key_ciphertext"),
  /** Last four characters, so admins can tell which key is set. */
  aiKeyHint: text("ai_key_hint"),
  createdAt: createdAt(),
});

export const roles = ["owner", "admin", "editor", "viewer"] as const;
export type Role = (typeof roles)[number];

export const members = pgTable(
  "members",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: roles }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** sha256 of the token; the token itself is shown once and never stored. */
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  /** Set for OAuth-issued tokens (MCP clients); bootstrap and personal tokens don't expire. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** The OAuth client that holds this token, if any. */
  clientId: text("client_id"),
});

export const visibilities = ["private", "workspace", "public"] as const;
export type Visibility = (typeof visibilities)[number];

export const spaces = pgTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    visibility: text("visibility", { enum: visibilities }).notNull().default("workspace"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("spaces_workspace_slug").on(t.workspaceId, t.slug)],
);

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    /** Slash-separated slugs from the space root, e.g. `guides/deploy`. */
    path: text("path").notNull(),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    summary: text("summary"),
    publishedRevisionId: text("published_revision_id"),
    /** Autosaved work in progress, not yet published. Null when the draft matches the published revision. */
    draftRevisionId: text("draft_revision_id"),
    /** Soft lock: one editor at a time. Expires on its own if the editor goes away. */
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    /** Plain text of the published Markdown, for full-text search. */
    searchText: text("search_text").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pages_space_path").on(t.spaceId, t.path),
    index("pages_parent").on(t.parentId),
    index("pages_search").using("gin", sql`to_tsvector('english', ${t.title} || ' ' || ${t.searchText})`),
  ],
);

/**
 * Page-level or anchored to a quote. The anchor is a text-quote selector
 * (exact text plus a little context) so it survives edits elsewhere on the page.
 */
export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    revisionId: text("revision_id"),
    anchor: jsonb("anchor").$type<{ exact: string; prefix?: string; suffix?: string } | null>(),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: createdAt(),
  },
  (t) => [index("comments_page").on(t.pageId, t.createdAt)],
);

/** Immutable. Bodies live in the blob store, addressed by sha256. */
export const revisions = pgTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    parentRevisionId: text("parent_revision_id"),
    sourceHash: text("source_hash").notNull(),
    htmlHash: text("html_hash").notNull(),
    markdownHash: text("markdown_hash").notNull(),
    /** From frontmatter at save time, so publishing a draft needs no recompile. */
    title: text("title"),
    summary: text("summary"),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    message: text("message"),
    createdAt: createdAt(),
  },
  (t) => [index("revisions_page").on(t.pageId, t.createdAt)],
);

export const pageViews = pgTable(
  "page_views",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    format: text("format", { enum: ["html", "markdown"] }).notNull(),
    utmSource: text("utm_source"),
    utmCampaign: text("utm_campaign"),
    referrerHost: text("referrer_host"),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("page_views_page").on(t.pageId, t.viewedAt)],
);

export const linkedinAccounts = pgTable("linkedin_accounts", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  /** OpenID `sub`; the author URN is `urn:li:person:<sub>`. */
  memberId: text("member_id").notNull(),
  name: text("name"),
  /** AES-256-GCM, see lib/crypto.ts. */
  accessTokenCiphertext: text("access_token_ciphertext").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const linkedinPosts = pgTable("linkedin_posts", {
  id: text("id").primaryKey(),
  pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  postUrn: text("post_urn").notNull(),
  sharedUrl: text("shared_url").notNull(),
  createdAt: createdAt(),
});

export const suggestionStatuses = ["open", "accepted", "rejected"] as const;

/**
 * A proposed change to a page, from Claude in the editor or from an agent over MCP.
 * It stores the whole proposed source against the revision it was written for;
 * hunks are computed on read and a person picks which ones to apply.
 */
export const suggestions = pgTable(
  "suggestions",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    baseRevisionId: text("base_revision_id").notNull(),
    proposedHash: text("proposed_hash").notNull(),
    /** Who asked for it: "assist" (editor ⌘I), "mcp" (an agent), "drift" (repo check). */
    origin: text("origin", { enum: ["assist", "mcp", "drift"] }).notNull(),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    status: text("status", { enum: suggestionStatuses }).notNull().default("open"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The draft revision an accept produced. */
    appliedRevisionId: text("applied_revision_id"),
    createdAt: createdAt(),
  },
  (t) => [index("suggestions_page").on(t.pageId, t.status)],
);

/** OAuth 2.1 clients registered dynamically by MCP clients (RFC 7591). */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: createdAt(),
});

/** Single-use authorization codes, PKCE S256 only. */
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
