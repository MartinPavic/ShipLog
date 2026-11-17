UPDATE "custom_templates"
SET "instructions" = "instructions" || E'\n\n' || "custom_prompt"
WHERE "custom_prompt" IS NOT NULL AND btrim("custom_prompt") <> '';--> statement-breakpoint
ALTER TABLE "custom_templates" DROP COLUMN "custom_prompt";