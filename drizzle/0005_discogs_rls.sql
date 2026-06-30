-- Row-Level Security for discogs_connections (Slice 2). drizzle-kit does NOT manage RLS, so this
-- is hand-written and registered in meta/_journal.json after the 0004 DDL migration. Same shape as
-- 0001_rls.sql: ENABLE + FORCE RLS, tenant_id default from the request-scoped GUC (NULLIF-guarded),
-- tenant_isolation + superadmin_bypass policies, DML grant + the serial sequence grant to qr_app.
-- The new purchases columns inherit the existing purchases RLS — no policy change needed there.

ALTER TABLE "discogs_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "discogs_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "discogs_connections" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "discogs_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "discogs_connections"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "discogs_connections" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "discogs_connections_id_seq" TO qr_app;
