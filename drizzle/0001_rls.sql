-- Row-Level Security layer. drizzle-kit does NOT manage RLS, so this is hand-written.
-- Run by the migrator AS qr_owner (the database owner). For every tenant-scoped table:
--   1. ENABLE + FORCE row level security (FORCE → even the table owner is subject to RLS),
--   2. set the tenant_id default from the request-scoped GUC (NULLIF-guarded),
--   3. create the tenant_isolation + superadmin_bypass policies (both PERMISSIVE),
--   4. grant DML to the runtime role qr_app.
-- The NULLIF guard is mandatory: withSuperadmin/withOwner set app.current_tenant to '' and a
-- bare ''::int cast THROWS. NULLIF('', ...) → NULL → no row matches → fail-closed, no error.
-- The second arg `true` to current_setting() = missing_ok: an unset GUC returns NULL, not an error.

GRANT USAGE ON SCHEMA public TO qr_app;
--> statement-breakpoint

-- users -----------------------------------------------------------------
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "users"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "users"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO qr_app;
--> statement-breakpoint

-- user_detail -----------------------------------------------------------
ALTER TABLE "user_detail" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_detail" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_detail" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "user_detail"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "user_detail"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_detail" TO qr_app;
--> statement-breakpoint

-- sessions --------------------------------------------------------------
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "sessions"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO qr_app;
--> statement-breakpoint

-- records ---------------------------------------------------------------
ALTER TABLE "records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "records"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "records"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "records" TO qr_app;
--> statement-breakpoint

-- purchases -------------------------------------------------------------
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchases"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "purchases"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchases" TO qr_app;
--> statement-breakpoint

-- permalinks ------------------------------------------------------------
ALTER TABLE "permalinks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permalinks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permalinks" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "permalinks"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "permalinks"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "permalinks" TO qr_app;
--> statement-breakpoint

-- Registry tables: NO tenant RLS. qr_app reads only; writes go through qr_owner.
GRANT SELECT ON "tenants" TO qr_app;
--> statement-breakpoint
GRANT SELECT ON "plans" TO qr_app;
--> statement-breakpoint

-- Serial PKs need their sequences usable by qr_app for INSERTs.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qr_app;
