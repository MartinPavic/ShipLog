CREATE TABLE "sentry_connections" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"organization_slug" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sentry_projects" jsonb DEFAULT '[]'::jsonb NOT NULL;