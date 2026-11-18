CREATE TABLE "page_redirects" (
	"workspace_id" text NOT NULL,
	"space_slug" text NOT NULL,
	"path" text NOT NULL,
	"page_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_redirects_workspace_id_space_slug_path_pk" PRIMARY KEY("workspace_id","space_slug","path")
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "page_redirects" ADD CONSTRAINT "page_redirects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_redirects" ADD CONSTRAINT "page_redirects_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_redirects_page" ON "page_redirects" USING btree ("page_id");--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;