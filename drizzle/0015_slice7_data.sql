-- Slice-7-Daten-Migration (idempotent): kiSuche-Feature je Plan (Spec §9).
-- free ✗ / small ✓ / big ✓. Überschreibt plans.features via ON CONFLICT DO UPDATE.
-- NICHT 0012 editieren (bereits angewandt).
INSERT INTO "plans" ("slug", "name", "price_monthly_cents", "limits", "features") VALUES
  ('free',  'Free',     0, '{"maxRecords": 100,  "maxUsers": 2}'::jsonb,    '{"analytik": false, "discogsListing": false, "kiSuche": false}'::jsonb),
  ('small', 'Small', 1900, '{"maxRecords": 5000, "maxUsers": 10}'::jsonb,   '{"analytik": true,  "discogsListing": true,  "kiSuche": true}'::jsonb),
  ('big',   'Big',   4900, '{"maxRecords": null, "maxUsers": null}'::jsonb, '{"analytik": true,  "discogsListing": true,  "kiSuche": true}'::jsonb)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "price_monthly_cents" = EXCLUDED."price_monthly_cents",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features";
