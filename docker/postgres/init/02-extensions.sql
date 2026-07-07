-- Läuft beim First-Init als postgres-SUPERUSER gegen POSTGRES_DB (qrecords),
-- alphabetisch NACH 01-roles.sql. `vector` ist keine trusted extension und
-- kann daher NICHT in einer qr_owner-Migration angelegt werden (Slice-7-Ground-Truth).
CREATE EXTENSION IF NOT EXISTS vector;
