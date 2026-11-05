ALTER TABLE "ship_logs" ADD COLUMN "schedule_key" text;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "status" text DEFAULT 'processed' NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ship_logs_schedule_key_idx" ON "ship_logs" USING btree ("schedule_key");