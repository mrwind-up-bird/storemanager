-- Row-Level Security for the Slice 4 `collections` table (batch-Ankauf). drizzle-kit does NOT
-- manage RLS, so this is hand-written and registered in meta/_journal.json after the 0008 DDL
-- migration. Same shape as 0007_slice3_rls.sql: ENABLE + FORCE RLS, tenant_id default from the
-- request-scoped GUC (NULLIF-guarded), tenant_isolation + superadmin_bypass policies, DML grant +
-- the serial sequence grant to qr_app (the sequence grant is load-bearing — INSERT fails without
-- it). `purchases.collection_id` and `quick_items.category` need NO new policy — those tables
-- already have RLS from 0001_rls.sql / 0007_slice3_rls.sql.

ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "collections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "collections"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "collections"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "collections" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "collections_id_seq" TO qr_app;
