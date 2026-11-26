CREATE TABLE "project_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"weekdays" integer[] NOT NULL,
	"hour" integer NOT NULL,
	"timezone" text NOT NULL,
	"period_days" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_channels" (
	"schedule_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	CONSTRAINT "schedule_channels_schedule_id_channel_id_pk" PRIMARY KEY("schedule_id","channel_id")
);
--> statement-breakpoint
-- Intentionally discards scheduled_runs: the table is keyed per schedule now and held no schedules to migrate.
DROP TABLE "scheduled_runs";--> statement-breakpoint
CREATE TABLE "scheduled_runs" (
	"schedule_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"log_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_runs_schedule_id_slot_pk" PRIMARY KEY("schedule_id","slot")
);
--> statement-breakpoint
ALTER TABLE "project_schedules" ADD CONSTRAINT "project_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_channels" ADD CONSTRAINT "schedule_channels_schedule_id_project_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."project_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_channels" ADD CONSTRAINT "schedule_channels_channel_id_delivery_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."delivery_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_schedules_project_idx" ON "project_schedules" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_schedule_id_project_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."project_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_log_id_ship_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."ship_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "schedule";