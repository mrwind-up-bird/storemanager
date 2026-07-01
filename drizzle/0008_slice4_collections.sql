CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"seller_name" text NOT NULL,
	"seller_contact" text,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "collection_id" integer;--> statement-breakpoint
ALTER TABLE "quick_items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collections_tenant_acquired_idx" ON "collections" USING btree ("tenant_id","acquired_at");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_collection_idx" ON "purchases" USING btree ("tenant_id","collection_id");