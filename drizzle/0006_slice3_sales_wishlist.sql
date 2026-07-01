CREATE TYPE "public"."payment_method" AS ENUM('bar', 'karte', 'paypal', 'gutschein');--> statement-breakpoint
CREATE TYPE "public"."wishlist_match_status" AS ENUM('pending', 'notified', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."wishlist_status" AS ENUM('open', 'notified', 'closed');--> statement-breakpoint
CREATE TABLE "quick_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "quick_items_price_nonneg" CHECK ("quick_items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"purchase_id" integer,
	"quick_item_id" integer,
	"label" text NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transaction_items_quantity_positive" CHECK ("transaction_items"."quantity" >= 1),
	CONSTRAINT "transaction_items_kind_exclusive" CHECK (NOT ("transaction_items"."purchase_id" IS NOT NULL AND "transaction_items"."quick_item_id" IS NOT NULL)),
	CONSTRAINT "transaction_items_inventory_qty_one" CHECK ("transaction_items"."purchase_id" IS NULL OR "transaction_items"."quantity" = 1)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"sold_by_user_id" integer NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"discount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"voucher_code" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "transactions_discount_nonneg" CHECK ("transactions"."discount" >= 0),
	CONSTRAINT "transactions_discount_le_subtotal" CHECK ("transactions"."discount" <= "transactions"."subtotal"),
	CONSTRAINT "transactions_total_consistent" CHECK ("transactions"."total" = "transactions"."subtotal" - "transactions"."discount"),
	CONSTRAINT "transactions_voucher_iff_gutschein" CHECK (("transactions"."payment_method" = 'gutschein') = ("transactions"."voucher_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "wishlist_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"wishlist_id" integer NOT NULL,
	"purchase_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"status" "wishlist_match_status" DEFAULT 'pending' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "wishlist_matches_wishlist_purchase" UNIQUE("wishlist_id","purchase_id")
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"artist" text NOT NULL,
	"label" text,
	"title" text,
	"country" text,
	"status" "wishlist_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "quick_items" ADD CONSTRAINT "quick_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_quick_item_id_quick_items_id_fk" FOREIGN KEY ("quick_item_id") REFERENCES "public"."quick_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sold_by_user_id_users_id_fk" FOREIGN KEY ("sold_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_matches" ADD CONSTRAINT "wishlist_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_matches" ADD CONSTRAINT "wishlist_matches_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_matches" ADD CONSTRAINT "wishlist_matches_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_matches" ADD CONSTRAINT "wishlist_matches_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quick_items_tenant_active_idx" ON "quick_items" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "transaction_items_tenant_transaction_idx" ON "transaction_items" USING btree ("tenant_id","transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_items_tenant_purchase_idx" ON "transaction_items" USING btree ("tenant_id","purchase_id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_created_idx" ON "transactions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "wishlist_matches_tenant_status_idx" ON "wishlist_matches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "wishlists_tenant_status_idx" ON "wishlists" USING btree ("tenant_id","status");