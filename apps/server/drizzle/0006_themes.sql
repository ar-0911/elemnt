ALTER TABLE "revisions" ADD COLUMN "style" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "style" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "theme" jsonb;