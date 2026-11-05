CREATE TABLE "usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"period" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "schedule_key" text;--> statement-breakpoint
CREATE INDEX "usage_reservations_owner_created_idx" ON "usage_reservations" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_schedule_channel_idx" ON "deliveries" USING btree ("schedule_key","channel_id");