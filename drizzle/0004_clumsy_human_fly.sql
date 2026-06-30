CREATE TYPE "public"."discogs_listing_status" AS ENUM('not_listed', 'pending', 'listed', 'failed');--> statement-breakpoint
CREATE TABLE "discogs_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"discogs_username" text NOT NULL,
	"oauth_token" text NOT NULL,
	"oauth_token_secret" text NOT NULL,
	"connected_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "discogs_connections_tenant" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "discogs_listing_id" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "discogs_listing_status" "discogs_listing_status" DEFAULT 'not_listed' NOT NULL;--> statement-breakpoint
ALTER TABLE "discogs_connections" ADD CONSTRAINT "discogs_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discogs_connections" ADD CONSTRAINT "discogs_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;