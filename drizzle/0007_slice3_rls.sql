-- Row-Level Security for the Slice 3 POS/Sales + Wishlist tables (quick_items, transactions,
-- transaction_items, wishlists, wishlist_matches). drizzle-kit does NOT manage RLS, so this is
-- hand-written and registered in meta/_journal.json after the 0006 DDL migration. Same shape as
-- 0005_discogs_rls.sql: ENABLE + FORCE RLS, tenant_id default from the request-scoped GUC
-- (NULLIF-guarded), tenant_isolation + superadmin_bypass policies, DML grant + the serial
-- sequence grant to qr_app (the sequence grant is load-bearing — INSERT fails without it).

ALTER TABLE "quick_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quick_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quick_items" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quick_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "quick_items"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "quick_items" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "quick_items_id_seq" TO qr_app;
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transactions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "transactions"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transactions" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "transactions_id_seq" TO qr_app;
--> statement-breakpoint
ALTER TABLE "transaction_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transaction_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transaction_items" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transaction_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "transaction_items"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transaction_items" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "transaction_items_id_seq" TO qr_app;
--> statement-breakpoint
ALTER TABLE "wishlists" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wishlists" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wishlists" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "wishlists"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "wishlists"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "wishlists" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "wishlists_id_seq" TO qr_app;
--> statement-breakpoint
ALTER TABLE "wishlist_matches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wishlist_matches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wishlist_matches" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "wishlist_matches"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "wishlist_matches"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "wishlist_matches" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "wishlist_matches_id_seq" TO qr_app;
