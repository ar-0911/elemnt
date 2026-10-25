CREATE TABLE "library_components" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"summary" text NOT NULL,
	"html" text NOT NULL,
	"css" text NOT NULL,
	"js" text NOT NULL,
	"height" integer DEFAULT 320 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_levels" (
	"page_id" text NOT NULL,
	"level" text NOT NULL,
	"base_revision_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"html_hash" text NOT NULL,
	"markdown_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"approved_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_levels_page_id_level_pk" PRIMARY KEY("page_id","level")
);
--> statement-breakpoint
CREATE TABLE "page_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"revision_id" text,
	"question" text NOT NULL,
	"quote" text,
	"section" text,
	"answer" text NOT NULL,
	"gap" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"asker_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_stats" (
	"page_id" text NOT NULL,
	"source" text NOT NULL,
	"section" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"dwell_ms" bigint DEFAULT 0 NOT NULL,
	"exits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "section_stats_page_id_source_section_pk" PRIMARY KEY("page_id","source","section")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "ask_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "library_components" ADD CONSTRAINT "library_components_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_components" ADD CONSTRAINT "library_components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_levels" ADD CONSTRAINT "page_levels_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_levels" ADD CONSTRAINT "page_levels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_questions" ADD CONSTRAINT "page_questions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_questions" ADD CONSTRAINT "page_questions_asker_id_users_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_stats" ADD CONSTRAINT "section_stats_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "library_components_slug" ON "library_components" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "page_questions_page" ON "page_questions" USING btree ("page_id","created_at");