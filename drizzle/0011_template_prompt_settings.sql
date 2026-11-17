ALTER TABLE "custom_templates" ADD COLUMN "tone" text;--> statement-breakpoint
ALTER TABLE "custom_templates" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "custom_templates" ADD COLUMN "custom_prompt" text;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "tone";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "audience";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "custom_prompt";