import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '@/db/migrate';

/**
 * Shared testcontainers harness for the Slice 0 DB suites (RLS gate + Tasks 10/12/14).
 *
 * CRITICAL ordering contract:
 *   `setupTestDatabase()` boots PostgreSQL 17, provisions the two app roles, runs the
 *   migrator AS qr_owner, and ONLY THEN publishes the live connection strings into
 *   `process.env.DATABASE_URL` (qr_app) + `process.env.DATABASE_OWNER_URL` (qr_owner).
 *   `src/db/client.ts` builds its `appPool`/`ownerPool` singletons at module-eval time from
 *   `@/env`, so callers MUST set env first and then `await import('@/db/client')` (and
 *   `@/db/tenant`, `@/db/assertions`) — never import them statically at the top of a spec, or
 *   the pools bind to a non-existent / wrong database.
 *
 * This module deliberately imports NOTHING from `@/db/client`, `@/db/tenant`, `@/env`, or
 * `@/db/schema` at the top level — only `@/db/migrate` (which reads no env). Those modules are
 * pulled in via dynamic `import()` strictly AFTER env has been published.
 */

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  ownerUrl: string;
  appUrl: string;
  teardown: () => Promise<void>;
}

const OWNER_PW = 'owner_pw';
const APP_PW = 'app_pw';

export async function setupTestDatabase(): Promise<TestDatabase> {
  // Boot a real PostgreSQL 17 (default db/user/pass: test/test/test).
  const container = await new PostgreSqlContainer('postgres:17').start();

  const host = container.getHost();
  const port = container.getPort();
  const dbName = container.getDatabase();
  const ownerUrl = `postgresql://qr_owner:${OWNER_PW}@${host}:${port}/${dbName}`;
  const appUrl = `postgresql://qr_app:${APP_PW}@${host}:${port}/${dbName}`;

  // 1. Superuser-only role + ownership setup (mirrors docker/postgres/init/01-roles.sql).
  //    qr_owner: NOSUPERUSER BYPASSRLS  → migrations + registry writes, exempt from RLS.
  //    qr_app:   NOSUPERUSER NOBYPASSRLS → the runtime role; ALWAYS subject to RLS.
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  try {
    await admin.query(`CREATE ROLE qr_owner LOGIN NOSUPERUSER BYPASSRLS PASSWORD '${OWNER_PW}'`);
    await admin.query(`CREATE ROLE qr_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    await admin.query(`ALTER DATABASE ${dbName} OWNER TO qr_owner`);
    await admin.query(`ALTER SCHEMA public OWNER TO qr_owner`);
    await admin.query(`GRANT ALL ON SCHEMA public TO qr_owner`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO qr_app`);
  } finally {
    await admin.end();
  }

  // 2. Run the versioned migrations AS the owner — the same pipeline as production
  //    (0000 tables, 0001 RLS enable+force+policies+grants+GUC defaults, 0002 plans).
  await runMigrations(ownerUrl);

  // 3. Defensive re-grant of sequence usage to qr_app. 0001_rls.sql already grants this; we
  //    re-assert it (idempotent) so qr_app can drive the serial PKs on its INSERTs regardless.
  const grantPool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await grantPool.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qr_app');
  } finally {
    await grantPool.end();
  }

  // 4. Publish env BEFORE any @/db module import so client.ts/env.ts bind to THIS container.
  //    The DB URLs are forced (=) because any pre-existing value would point at the wrong db;
  //    everything else uses ??= so a real environment can still override.
  process.env.DATABASE_URL = appUrl;
  process.env.DATABASE_OWNER_URL = ownerUrl;
  process.env.PGBOSS_DATABASE_URL = ownerUrl;
  // NODE_ENV is typed read-only by the Next.js ambient types; vitest already sets it to 'test'
  // and env.ts defaults it anyway, so we leave it untouched.
  process.env.ROOT_DOMAIN ??= 'localhost';
  process.env.APP_PROTOCOL ??= 'http';
  process.env.APP_PORT ??= '3000';
  process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-0';
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  process.env.ENCRYPTION_KEY_ID ??= 'v1';
  process.env.MAIL_DRIVER ??= 'console';
  process.env.MAIL_HOST ??= 'localhost';
  process.env.MAIL_PORT ??= '1025';
  process.env.MAIL_FROM ??= 'test@qrecords.test';

  return {
    container,
    ownerUrl,
    appUrl,
    teardown: async () => {
      // End the singleton pools created by @/db/client (if they were imported by this run),
      // then stop the container. Same cached module instance the specs used — teardown runs
      // without an intervening vi.resetModules(), so import() returns the live pools.
      try {
        const { appPool, ownerPool } = await import('@/db/client');
        await appPool.end().catch(() => undefined);
        await ownerPool.end().catch(() => undefined);
      } catch {
        // @/db/client was never imported in this run — nothing to close.
      }
      await container.stop();
    },
  };
}

/**
 * Seeds one registry tenant + one admin user, BOTH through `ownerPool` (qr_owner has BYPASSRLS
 * and owns the tables), inserting an EXPLICIT `tenant_id`. Seeding deliberately does NOT go
 * through the RLS policies it is used to test — a seed must be a trustworthy fixture, not a
 * second copy of the system under test. Registry (`tenants`) is not under tenant RLS anyway.
 *
 * Returns the generated `{ tenantId, adminUserId }`. Records for the leak tests are seeded by
 * the specs themselves (explicit tenant_id or via withTenant) so each test controls its own set.
 */
export async function seedTenant(input: {
  slug: string;
  name: string;
  primaryColor?: string;
  adminEmail?: string;
}): Promise<{ tenantId: number; adminUserId: number }> {
  const { ownerPool } = await import('@/db/client');

  const config = {
    branding: { primaryColor: input.primaryColor ?? '#FF5A5F', logo: null },
  };

  const tenantRow = await ownerPool.query<{ id: number }>(
    'INSERT INTO tenants (slug, name, config) VALUES ($1, $2, $3) RETURNING id',
    [input.slug, input.name, JSON.stringify(config)],
  );
  const tenantId = Number(tenantRow.rows[0].id);

  const userRow = await ownerPool.query<{ id: number }>(
    `INSERT INTO users (tenant_id, email, password, role, is_superadmin)
     VALUES ($1, $2, $3, 'admin', false) RETURNING id`,
    [tenantId, input.adminEmail ?? `admin@${input.slug}.test`, 'seed-not-a-real-hash'],
  );
  const adminUserId = Number(userRow.rows[0].id);

  return { tenantId, adminUserId };
}
