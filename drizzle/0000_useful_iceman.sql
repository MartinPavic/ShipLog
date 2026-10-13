CREATE TABLE "ai_credentials" (
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"last4" text NOT NULL,
	"model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credentials_owner_id_provider_pk" PRIMARY KEY("owner_id","provider")
);
--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text,
	"current_period_end" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"log_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"encrypted_config" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template" text DEFAULT 'weekly_update' NOT NULL,
	"tone" text,
	"audience" text,
	"custom_prompt" text,
	"default_period_days" integer DEFAULT 7 NOT NULL,
	"schedule" jsonb,
	"is_public_changelog" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ship_log_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"log_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ship_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"template" text NOT NULL,
	"provider" text,
	"model" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"error" text,
	"source_snapshot" jsonb,
	"pinned" boolean DEFAULT false NOT NULL,
	"share_token" text,
	"share_password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"owner_id" text NOT NULL,
	"period" text NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_owner_id_period_kind_pk" PRIMARY KEY("owner_id","period","kind")
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_log_id_ship_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."ship_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_channel_id_delivery_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."delivery_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_channels" ADD CONSTRAINT "delivery_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_log_versions" ADD CONSTRAINT "ship_log_versions_log_id_ship_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."ship_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_logs" ADD CONSTRAINT "ship_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_log_idx" ON "deliveries" USING btree ("log_id");--> statement-breakpoint
CREATE INDEX "delivery_channels_project_idx" ON "delivery_channels" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_slug_idx" ON "projects" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "ship_log_versions_log_idx" ON "ship_log_versions" USING btree ("log_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ship_logs_owner_idx" ON "ship_logs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "ship_logs_project_created_idx" ON "ship_logs" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ship_logs_share_token_idx" ON "ship_logs" USING btree ("share_token");