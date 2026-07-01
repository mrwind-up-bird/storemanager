import 'server-only';
import { appPool } from '@/db/client';

/** Physical names of tenant-scoped tables (must match the schema + RLS migrations). */
const TENANT_SCOPED_TABLES = [
  'users',
  'user_detail',
  'sessions',
  'records',
  'purchases',
  'permalinks',
  'discogs_connections',
  'quick_items',
  'transactions',
  'transaction_items',
  'wishlists',
  'wishlist_matches',
] as const;

/**
 * Boot guard (run before serving traffic). Fails closed if:
 *  - the current connection role is a SUPERUSER or has BYPASSRLS,
 *  - any tenant-scoped table lacks rowsecurity + forced + the `tenant_isolation` policy,
 *  - a SELECT on `records` WITHOUT tenant context returns more than 0 rows.
 *
 * Runs through the APP pool (qr_app) so it validates the RUNTIME role, not qr_owner.
 */
export async function assertDatabaseSafety(): Promise<void> {
  const client = await appPool.connect();
  try {
    const role = await client.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    const r = role.rows[0] as { rolsuper: boolean; rolbypassrls: boolean } | undefined;
    if (!r) throw new Error('assertDatabaseSafety: current_user not found in pg_roles');
    if (r.rolsuper) {
      throw new Error('assertDatabaseSafety: app role is a SUPERUSER — refusing to start');
    }
    if (r.rolbypassrls) {
      throw new Error('assertDatabaseSafety: app role has BYPASSRLS — refusing to start');
    }

    // ── Drift guard ───────────────────────────────────────────────────────────
    // Discover every base table in `public` that carries a `tenant_id` column and
    // assert the set equals TENANT_SCOPED_TABLES EXACTLY. A future slice that adds a
    // tenant-scoped table but forgets to extend this list (or forgets FORCE RLS / the
    // tenant_isolation policy) would otherwise silently skip the per-table validation
    // below — this turns that drift into a hard boot failure instead.
    const drift = await client.query(
      `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name = 'tenant_id'
          AND t.table_type = 'BASE TABLE'`,
    );
    const discovered = new Set(
      (drift.rows as { table_name: string }[]).map((row) => row.table_name),
    );
    const expected = new Set<string>(TENANT_SCOPED_TABLES);
    const hasTenantIdButUnlisted = [...discovered].filter((t) => !expected.has(t)).sort();
    const listedButNoTenantId = [...expected].filter((t) => !discovered.has(t)).sort();
    if (hasTenantIdButUnlisted.length > 0 || listedButNoTenantId.length > 0) {
      const parts: string[] = [];
      if (hasTenantIdButUnlisted.length > 0) {
        parts.push(
          `have a tenant_id column but are absent from TENANT_SCOPED_TABLES: [${hasTenantIdButUnlisted.join(', ')}]`,
        );
      }
      if (listedButNoTenantId.length > 0) {
        parts.push(
          `are in TENANT_SCOPED_TABLES but have no tenant_id column in public: [${listedButNoTenantId.join(', ')}]`,
        );
      }
      throw new Error(
        `assertDatabaseSafety: TENANT_SCOPED_TABLES drift — table(s) ${parts.join('; and ')}. ` +
          `Update TENANT_SCOPED_TABLES (and the RLS migration: ENABLE/FORCE + tenant_isolation) to match.`,
      );
    }

    for (const table of TENANT_SCOPED_TABLES) {
      const sec = await client.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`,
        [table],
      );
      const s = sec.rows[0] as
        | { relrowsecurity: boolean; relforcerowsecurity: boolean }
        | undefined;
      if (!s) throw new Error(`assertDatabaseSafety: table ${table} not found`);
      if (!s.relrowsecurity) {
        throw new Error(`assertDatabaseSafety: ${table} is missing ROW LEVEL SECURITY`);
      }
      if (!s.relforcerowsecurity) {
        throw new Error(`assertDatabaseSafety: ${table} is missing FORCE ROW LEVEL SECURITY`);
      }

      const pol = await client.query(
        `SELECT count(*)::text AS count FROM pg_policies
         WHERE schemaname = 'public' AND tablename = $1 AND policyname = 'tenant_isolation'`,
        [table],
      );
      if ((pol.rows[0] as { count: string } | undefined)?.count !== '1') {
        throw new Error(`assertDatabaseSafety: ${table} is missing policy 'tenant_isolation'`);
      }
    }

    // No tenant context is set on this raw connection → current_setting(...) is NULL → 0 rows.
    const noCtx = await client.query(`SELECT count(*)::text AS count FROM records`);
    if ((noCtx.rows[0] as { count: string } | undefined)?.count !== '0') {
      throw new Error(
        'assertDatabaseSafety: records returned rows without tenant context — RLS is not fail-closed',
      );
    }
  } finally {
    client.release();
  }
}
