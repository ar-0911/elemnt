ALTER TABLE "revisions" ADD COLUMN "by_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "agent_publish" boolean DEFAULT false NOT NULL;