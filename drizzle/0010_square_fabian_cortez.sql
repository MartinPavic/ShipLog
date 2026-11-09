ALTER TABLE "billing_accounts" ADD COLUMN "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "stripe_checkout_reservation" jsonb;