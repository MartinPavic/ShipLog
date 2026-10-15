CREATE TABLE "scheduled_runs" (
	"project_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"log_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_runs_project_id_slot_pk" PRIMARY KEY("project_id","slot")
);
--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_log_id_ship_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."ship_logs"("id") ON DELETE set null ON UPDATE no action;