import 'server-only';
import { appPool } from '@/db/client';

/** Physical names of tenant-scoped tables (must match Task 4 schema + Task 5 RLS migration). */
const TENANT_SCOPED_TABLES = [
  'users',
  'user_detail',
  'sessions',
  'records',
  'purchases',
  'permalinks',
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
