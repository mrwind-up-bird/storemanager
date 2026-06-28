-- Runs as the postgres superuser during first-time DB init (docker-entrypoint-initdb.d).
-- Reads passwords + db name from the container environment via psql \getenv (PostgreSQL 16+),
-- so no credentials are hardcoded in the image.
\set ON_ERROR_STOP on

\getenv qr_owner_password QR_OWNER_PASSWORD
\getenv qr_app_password   QR_APP_PASSWORD
\getenv db_name           POSTGRES_DB

-- Migration / owner role and runtime role. Neither is a superuser.
--   qr_owner  : BYPASSRLS so migrations + provisioning can write through FORCE ROW LEVEL SECURITY.
--   qr_app    : NOBYPASSRLS so every runtime query is strictly bound by the RLS policies.
CREATE ROLE qr_owner LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'qr_owner_password';
CREATE ROLE qr_app   LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'qr_app_password';

-- qr_owner owns the application database + public schema, so migrations create objects as owner.
ALTER DATABASE :"db_name" OWNER TO qr_owner;
ALTER SCHEMA public OWNER TO qr_owner;
GRANT ALL ON SCHEMA public TO qr_owner;
