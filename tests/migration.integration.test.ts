import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';

const TENANT_TABLES = ['users', 'user_detail', 'sessions', 'records', 'purchases', 'permalinks'] as const;
const REGISTRY_TABLES = ['tenants', 'plans'] as const;

let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let appUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start();

  // Bootstrap the two app roles as the superuser — mirrors docker/postgres/init/01-roles.sql.
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(`CREATE ROLE qr_owner LOGIN NOSUPERUSER BYPASSRLS PASSWORD 'owner_pw'`);
  await admin.query(`CREATE ROLE qr_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'app_pw'`);
  await admin.query(`ALTER DATABASE ${container.getDatabase()} OWNER TO qr_owner`);
  await admin.query(`ALTER SCHEMA public OWNER TO qr_owner`);
  await admin.query(`GRANT ALL ON SCHEMA public TO qr_owner`);
  await admin.end();

  const host = container.getHost();
  const port = container.getPort();
  const db = container.getDatabase();
  ownerUrl = `postgresql://qr_owner:owner_pw@${host}:${port}/${db}`;
  appUrl = `postgresql://qr_app:app_pw@${host}:${port}/${db}`;

  // Run as the owner — the only role allowed to migrate.
  await runMigrations(ownerUrl);
}, 180_000);

afterAll(async () => {
  await container?.stop();
});

describe('0001_rls.sql', () => {
  it('ENABLEs + FORCEs RLS and creates both named policies on every tenant-scoped table', async () => {
    const pool = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      for (const table of TENANT_TABLES) {
        const flags = await pool.query(
          `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
          [table],
        );
        expect(flags.rows[0].relrowsecurity, `${table}.relrowsecurity`).toBe(true);
        expect(flags.rows[0].relforcerowsecurity, `${table}.relforcerowsecurity`).toBe(true);

        const policies = await pool.query(
          `SELECT polname FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname`,
          [table],
        );
        expect(policies.rows.map((r) => r.polname)).toEqual(['superadmin_bypass', 'tenant_isolation']);

        const def = await pool.query(
          `SELECT column_default FROM information_schema.columns
             WHERE table_name = $1 AND column_name = 'tenant_id'`,
          [table],
        );
        // The default MUST go through NULLIF (not a bare ''::int cast) so the empty-string
        // GUC used by withSuperadmin/withOwner resolves to NULL instead of throwing.
        // Postgres normalizes the stored expression (adds ::text casts), so match loosely:
        // NULLIF(current_setting('app.current_tenant'...), ''...)::integer.
        const defText: string = def.rows[0].column_default;
        expect(defText, `${table}.tenant_id default`).toContain('NULLIF');
        expect(defText, `${table}.tenant_id default`).toContain("current_setting('app.current_tenant'");
        expect(defText, `${table}.tenant_id default`).toMatch(/::int(eger)?/);
      }
    } finally {
      await pool.end();
    }
  });

  it('does NOT enable RLS on the registry tables (tenants, plans)', async () => {
    const pool = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      for (const table of REGISTRY_TABLES) {
        const flags = await pool.query(
          `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
          [table],
        );
        expect(flags.rows[0].relrowsecurity, `${table}.relrowsecurity`).toBe(false);
        expect(flags.rows[0].relforcerowsecurity, `${table}.relforcerowsecurity`).toBe(false);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('0002_seed_plans.sql', () => {
  it('seeds free/small/big and is idempotent when migrate re-runs', async () => {
    await runMigrations(ownerUrl); // re-run: must stay green and not duplicate plans
    const pool = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query(`SELECT slug FROM plans ORDER BY slug`);
      expect(rows.map((r) => r.slug)).toEqual(['big', 'free', 'small']);
    } finally {
      await pool.end();
    }
  }, 60_000);
});

describe('qr_app runtime role', () => {
  it(
    'fail-closed: empty-string app.current_tenant GUC returns 0 rows without an integer-cast error (policy NULLIF guard)',
    async () => {
      // withSuperadmin / withOwner (Task 6) set app.current_tenant to '' (empty string),
      // not to NULL. A policy USING clause without NULLIF would try to evaluate ''::int and
      // throw: "invalid input syntax for type integer". NULLIF('', '') → NULL → tenant_id = NULL
      // is UNKNOWN → no rows match → fail-closed with no error. This test proves that path.
      const appPool = new Pool({ connectionString: appUrl, max: 1 });
      const c = await appPool.connect();
      try {
        await c.query('BEGIN');
        // Transaction-local GUC set to empty string — exactly what withSuperadmin/withOwner do.
        await c.query(`SELECT set_config('app.current_tenant', '', true)`);

        // Must RESOLVE (not throw) and return 0 (fail-closed, NULLIF guard holds).
        const recordsResult = await c.query(`SELECT count(*)::int AS n FROM records`);
        expect(recordsResult.rows[0].n).toBe(0);

        // Confirm the guard is uniform — same policy shape on users.
        const usersResult = await c.query(`SELECT count(*)::int AS n FROM users`);
        expect(usersResult.rows[0].n).toBe(0);

        await c.query('ROLLBACK');
      } finally {
        c.release();
        await appPool.end();
      }
    },
    60_000,
  );

  it('is not a superuser, has no BYPASSRLS, and cannot see rows without tenant context', async () => {
    const appPool = new Pool({ connectionString: appUrl, max: 1 });
    const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      const role = await appPool.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(role.rows[0].rolsuper).toBe(false);
      expect(role.rows[0].rolbypassrls).toBe(false);

      // Owner seeds one record under explicit tenant context (owner is FORCEd too).
      const t = await ownerPool.query(
        `INSERT INTO tenants (slug, name) VALUES ('demo', 'Demo') RETURNING id`,
      );
      const tenantId: number = t.rows[0].id;
      const c = await ownerPool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.current_tenant', $1, true)`, [String(tenantId)]);
        await c.query(
          `INSERT INTO records (tenant_id, title, artist, hash) VALUES ($1, 't', 'a', 'h')`,
          [tenantId],
        );
        await c.query('COMMIT');
      } finally {
        c.release();
      }

      // qr_app with no GUC set → current_setting() is NULL → NULLIF fail-closed → 0 rows, NO error.
      const seen = await appPool.query(`SELECT count(*)::int AS n FROM records`);
      expect(seen.rows[0].n).toBe(0);

      // qr_app retains its registry read grant (SELECT on plans succeeds).
      const plans = await appPool.query(`SELECT count(*)::int AS n FROM plans`);
      expect(plans.rows[0].n).toBe(3);
    } finally {
      await appPool.end();
      await ownerPool.end();
    }
  }, 60_000);
});
