// Slice 6 T1 — Migrations-Gate: neue Tabellen/Spalten, subscriptions-RLS nicht-vakuos,
// Registry-Tabellen OHNE qr_app-Zugriff, Boot-Assertion grün, Plan-Matrix neu.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

describe('slice6 migration (0010–0012)', () => {
  let db: TestDatabase;
  let owner: Pool;
  let tenantA: number;
  let tenantB: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
    const a = await seedTenant({ slug: 'sub-a', name: 'Sub A' });
    const b = await seedTenant({ slug: 'sub-b', name: 'Sub B' });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
  }, 180_000);

  afterAll(async () => {
    await owner.end();
    await db.teardown();
  });

  it('legt die neuen Tabellen und Spalten an', async () => {
    const tables = await owner.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('platform_users','platform_sessions','webhook_events','subscriptions')`,
    );
    expect(tables.rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual([
      'platform_sessions', 'platform_users', 'subscriptions', 'webhook_events',
    ]);
    const cols = await owner.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE (table_name = 'plans' AND column_name = 'stripe_price_id')
           OR (table_name = 'users' AND column_name = 'must_change_password')
           OR (table_name = 'tenants' AND column_name = 'onboarding_completed_at')`,
    );
    expect(cols.rows).toHaveLength(3);
  });

  it('plans trägt die Slice-6-Matrix (maxRecords/maxUsers, analytik/discogsListing)', async () => {
    const res = await owner.query(`SELECT slug, limits, features FROM plans ORDER BY slug`);
    const bySlug = Object.fromEntries(
      res.rows.map((r: { slug: string; limits: unknown; features: unknown }) => [r.slug, r]),
    ) as Record<string, { limits: Record<string, unknown>; features: Record<string, unknown> }>;
    expect(bySlug.free.limits).toEqual({ maxRecords: 100, maxUsers: 2 });
    expect(bySlug.free.features).toEqual({ analytik: false, discogsListing: false, kiSuche: false });
    expect(bySlug.small.limits).toEqual({ maxRecords: 5000, maxUsers: 10 });
    expect(bySlug.big.limits).toEqual({ maxRecords: null, maxUsers: null });
    expect(bySlug.big.features).toEqual({ analytik: true, discogsListing: true, kiSuche: true });
  });

  it('subscriptions-RLS ist nicht-vakuos: A sieht exakt seine Zeile, B exakt seine', async () => {
    await owner.query(
      `INSERT INTO subscriptions (tenant_id, stripe_customer_id, stripe_subscription_id, plan_slug, status)
       VALUES ($1, 'cus_a', 'sub_a', 'small', 'active'), ($2, 'cus_b', 'sub_b', 'big', 'active')`,
      [tenantA, tenantB],
    );
    const { withTenant } = await import('@/db/tenant');
    const { subscriptions } = await import('@/db/schema');
    const seenByA = await withTenant({ tenantId: tenantA, userId: null }, (tx) =>
      tx.select().from(subscriptions),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.stripeCustomerId).toBe('cus_a');
    const seenByB = await withTenant({ tenantId: tenantB, userId: null }, (tx) =>
      tx.select().from(subscriptions),
    );
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]!.stripeCustomerId).toBe('cus_b');
  });

  it('qr_app hat KEINEN Zugriff auf platform_users/platform_sessions/webhook_events', async () => {
    const app = new Pool({ connectionString: db.appUrl, max: 1 });
    try {
      for (const table of ['platform_users', 'platform_sessions', 'webhook_events']) {
        await expect(app.query(`SELECT count(*) FROM ${table}`)).rejects.toMatchObject({
          code: '42501', // insufficient_privilege
        });
      }
    } finally {
      await app.end();
    }
  });

  it('Boot-Assertion bleibt grün (Drift-Guard kennt subscriptions)', async () => {
    const { assertDatabaseSafety } = await import('@/db/assertions');
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });

  it('provisionTenant setzt mustChangePassword nur bei generiertem Passwort', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const gen = await provisionTenant({ slug: 'gen-pw', name: 'Gen', adminEmail: 'a@gen.test' });
    const explicit = await provisionTenant({
      slug: 'exp-pw', name: 'Exp', adminEmail: 'a@exp.test', password: 'ExplicitSeedPw1!',
    });
    const rows = await owner.query(
      `SELECT id, must_change_password FROM users WHERE id = ANY($1::int[]) ORDER BY id`,
      [[gen.adminUserId, explicit.adminUserId]],
    );
    const byId = Object.fromEntries(
      rows.rows.map((r: { id: number; must_change_password: boolean }) => [r.id, r.must_change_password]),
    );
    expect(byId[gen.adminUserId]).toBe(true);
    expect(byId[explicit.adminUserId]).toBe(false);
  });
});
