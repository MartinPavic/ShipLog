CREATE TABLE "owner_profiles" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "ship_logs" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ship_logs_project_published_idx" ON "ship_logs" USING btree ("project_id","published_at" DESC NULLS LAST);