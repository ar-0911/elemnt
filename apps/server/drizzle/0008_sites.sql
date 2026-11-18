CREATE TABLE "site_changesets" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"author_id" text,
	"source" text DEFAULT 'mcp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"tree" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"space_id" text,
	"hostname" text,
	"repo" text,
	"draft_tree" text NOT NULL,
	"published_tree" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_changesets" ADD CONSTRAINT "site_changesets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_changesets" ADD CONSTRAINT "site_changesets_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_releases" ADD CONSTRAINT "site_releases_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_releases" ADD CONSTRAINT "site_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_changesets_site" ON "site_changesets" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "site_releases_site" ON "site_releases" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_workspace_slug" ON "sites" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_hostname" ON "sites" USING btree ("hostname");