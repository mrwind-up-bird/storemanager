-- Row-Level Security für record_embeddings (Slice 7). drizzle-kit verwaltet kein RLS,
-- daher handgeschrieben + manuell in meta/_journal.json registriert (idx 14).
-- Gleiche Form wie 0011_slice6_rls.sql: ENABLE + FORCE, tenant_id-Default aus dem GUC,
-- tenant_isolation + superadmin_bypass, DML- + Sequence-Grant an qr_app (load-bearing).

ALTER TABLE "record_embeddings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "record_embeddings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "record_embeddings" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_embeddings"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "record_embeddings"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "record_embeddings" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "record_embeddings_id_seq" TO qr_app;
