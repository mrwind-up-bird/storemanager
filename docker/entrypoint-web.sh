#!/bin/sh
# Boot guard for the web service. Fails closed (exit 1) BEFORE serving any traffic if
# the database is not in a safe state, or if ENCRYPTION_KEY is malformed. Mirrors
# src/db/assertions.ts (assertDatabaseSafety) but is self-contained so it can run inside
# the standalone runner without the app bundle. `pg` is available because db/client.ts
# pulls it into the Next standalone trace.
set -e

# ── 1. ENCRYPTION_KEY must base64-decode to exactly 32 bytes (AES-256). ──────────────
# Belt-and-suspenders: src/env.ts validates this too, but the web process loads env
# lazily, so assert it here before anything else touches the DB.
node -e '
  const k = process.env.ENCRYPTION_KEY || "";
  let n = -1;
  try { n = Buffer.from(k, "base64").length; } catch (e) {}
  if (n !== 32) {
    console.error("[boot] FATAL — ENCRYPTION_KEY must base64-decode to 32 bytes, got " + n);
    process.exit(1);
  }
  console.log("[boot] ENCRYPTION_KEY ok (32 bytes).");
'

# ── 2. Database safety assertions (run as the qr_app runtime role via DATABASE_URL). ──
echo "[boot] Verifying database safety before accepting traffic..."
node <<'BOOT_ASSERT'
const { Pool } = require('pg');

const TENANT_TABLES = ['users', 'user_detail', 'sessions', 'records', 'purchases', 'permalinks'];

async function assertSafety() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    // (a) The runtime role must NOT be a superuser or have BYPASSRLS.
    const { rows: [role] } = await client.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
    );
    if (!role) throw new Error('cannot read pg_roles for current_user');
    if (role.rolsuper) throw new Error('app role must not be a SUPERUSER');
    if (role.rolbypassrls) throw new Error('app role must not have BYPASSRLS');

    // (b) Every tenant-scoped table must have RLS enabled, FORCED, + tenant_isolation policy.
    for (const t of TENANT_TABLES) {
      const { rows: [tbl] } = await client.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policy p
                  WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = $1 AND n.nspname = 'public'`,
        [t]
      );
      if (!tbl) throw new Error(`table not found in public schema: ${t}`);
      if (!tbl.relrowsecurity) throw new Error(`${t}: ROW LEVEL SECURITY not enabled`);
      if (!tbl.relforcerowsecurity) throw new Error(`${t}: FORCE ROW LEVEL SECURITY not set`);
      if (Number(tbl.policies) !== 1) throw new Error(`${t}: tenant_isolation policy missing`);
    }

    // (c) A SELECT with NO tenant context must return 0 rows (RLS is fail-closed).
    const { rows } = await client.query('SELECT count(*)::int AS count FROM records');
    if (rows[0].count !== 0) {
      throw new Error('records returned rows without tenant context — RLS is NOT enforcing');
    }

    console.log('[boot] All database safety assertions passed.');
  } finally {
    client.release();
    await pool.end();
  }
}

assertSafety().catch((err) => {
  console.error('[boot] FATAL — database safety check failed:', err.message);
  process.exit(1);
});
BOOT_ASSERT

echo "[boot] Starting Next.js standalone server..."
exec node /app/server.js
