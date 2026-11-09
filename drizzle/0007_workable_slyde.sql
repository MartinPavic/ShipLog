CREATE TABLE "gitlab_connections" (
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_connections_owner_id_user_id_pk" PRIMARY KEY("owner_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "gitlab_instances" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"base_url" text NOT NULL,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gitlab_connections_user_idx" ON "gitlab_connections" USING btree ("user_id");