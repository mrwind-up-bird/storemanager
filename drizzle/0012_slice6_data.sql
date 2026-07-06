-- Slice-6-Daten-Migration (idempotent):
-- 1. Plan-Matrix (Spec §10) — überschreibt die Slice-0-Keys {records, discogs} mit der
--    Slice-6-Struktur {maxRecords, maxUsers} / {analytik, discogsListing}.
--    JSON null = unbegrenzt (big). Anzeigepreise; der abgerechnete Preis hängt am stripePriceId.
-- 2. onboarding_completed_at-Backfill: Bestands-Tenants sind längst konfiguriert und dürfen
--    beim nächsten Login NICHT in den Wizard laufen (Spec §8). Auf frischen DBs ein No-op.

INSERT INTO "plans" ("slug", "name", "price_monthly_cents", "limits", "features") VALUES
  ('free',  'Free',     0, '{"maxRecords": 100,  "maxUsers": 2}'::jsonb,    '{"analytik": false, "discogsListing": false}'::jsonb),
  ('small', 'Small', 1900, '{"maxRecords": 5000, "maxUsers": 10}'::jsonb,   '{"analytik": true,  "discogsListing": true}'::jsonb),
  ('big',   'Big',   4900, '{"maxRecords": null, "maxUsers": null}'::jsonb, '{"analytik": true,  "discogsListing": true}'::jsonb)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "price_monthly_cents" = EXCLUDED."price_monthly_cents",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features";
--> statement-breakpoint
UPDATE "tenants" SET "onboarding_completed_at" = now() WHERE "onboarding_completed_at" IS NULL;
