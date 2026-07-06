-- Row-Level Security für die Slice-6-Tabelle `subscriptions`. drizzle-kit verwaltet kein RLS,
-- daher handgeschrieben + manuell in meta/_journal.json registriert (idx 11).
-- Gleiche Form wie 0009_slice4_rls.sql: ENABLE + FORCE RLS, tenant_id-Default aus dem
-- request-scoped GUC (NULLIF-guarded), tenant_isolation + superadmin_bypass, DML-Grant +
-- Sequence-Grant an qr_app (der Sequence-Grant ist load-bearing — INSERT schlägt sonst fehl).
--
-- BEWUSST KEINE Grants für platform_users / platform_sessions / webhook_events:
-- Diese Registry-Tabellen werden ausschließlich über withOwner() (qr_owner) angesprochen.
-- qr_app hat darauf weder SELECT noch DML — enger als die Spec fordert (Defence-in-Depth).
-- Die Boot-Assertion braucht KEINE Ausnahmeliste: sie introspiziert nur Tabellen MIT
-- tenant_id-Spalte, und die drei Registry-Tabellen haben keine.

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscriptions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "subscriptions"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "subscriptions_id_seq" TO qr_app;
