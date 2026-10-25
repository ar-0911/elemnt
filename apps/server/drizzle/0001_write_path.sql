CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"parent_id" text,
	"revision_id" text,
	"anchor" jsonb,
	"author_id" text,
	"body" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "draft_revision_id" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_page" ON "comments" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "pages_search" ON "pages" USING gin (to_tsvector('english', "title" || ' ' || "search_text"));