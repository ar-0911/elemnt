CREATE TABLE "repo_links" (
	"page_id" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"pinned_commit" text NOT NULL,
	"cited_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_by" text,
	"checked_commit" text,
	"behind_by" integer DEFAULT 0 NOT NULL,
	"changed_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_links" ADD CONSTRAINT "repo_links_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_links" ADD CONSTRAINT "repo_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_links_repo" ON "repo_links" USING btree ("repo");