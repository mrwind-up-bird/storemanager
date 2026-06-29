-- Idempotent seed of the three subscription plans. Runs AS qr_owner (registry writes
-- never go through qr_app). ON CONFLICT keeps re-runs green and lets price/limits/features
-- be updated in place without duplicating rows.
INSERT INTO "plans" ("slug", "name", "price_monthly_cents", "limits", "features") VALUES
  ('free',  'Free',     0, '{"records": 100}'::jsonb,    '{"discogs": false}'::jsonb),
  ('small', 'Small', 1900, '{"records": 1000}'::jsonb,   '{"discogs": true}'::jsonb),
  ('big',   'Big',   4900, '{"records": 100000}'::jsonb, '{"discogs": true, "analytics": true}'::jsonb)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "price_monthly_cents" = EXCLUDED."price_monthly_cents",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features";
