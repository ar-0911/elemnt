ALTER TABLE "sites" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "agent_publish" boolean DEFAULT false NOT NULL;