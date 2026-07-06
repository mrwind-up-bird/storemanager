// Slice 6 T2 — Kapazitäts-Checks gegen echte Zählung (Spec §14): Grenzfall count+add == max
// erlaubt, +1 wirft; maxUsers zählt nur Staff; Freeshop-Reset stellt den Seed-Zustand her.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

describe('gating capacity checks + freeshop reset', () => {
  let db: TestDatabase;
  let owner: Pool;
  let tenantId: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
    const t = await seedTenant({ slug: 'gate', name: 'Gate' });
    tenantId = t.tenantId;
    // 2 Platten als Bestand (explizite tenant_id, ownerPool = vertrauenswürdige Fixture).
    await owner.query(
      `INSERT INTO records (tenant_id, title, artist, hash) VALUES
       ($1, 'R1', 'A1', repeat('1', 64)), ($1, 'R2', 'A2', repeat('2', 64))`,
      [tenantId],
    );
  }, 180_000);

  afterAll(async () => {
    await owner.end();
    await db.teardown();
  });

  it('count + add == max ist erlaubt, +1 wirft LimitExceededError mit exaktem Text', async () => {
    const { withTenant } = await import('@/db/tenant');
    const { checkRecordCapacity, LimitExceededError, FREE_FALLBACK_ENTITLEMENTS } = await import('@/lib/gating');
    const ent = { ...FREE_FALLBACK_ENTITLEMENTS, limits: { maxRecords: 3, maxUsers: 2 } };

    await withTenant({ tenantId, userId: null }, (tx) => checkRecordCapacity(tx, ent, 1)); // 2+1==3 ok

    await expect(
      withTenant({ tenantId, userId: null }, (tx) => checkRecordCapacity(tx, ent, 2)), // 2+2>3
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(LimitExceededError);
      expect((err as Error).message).toBe(
        'Plan-Limit erreicht: max. 3 Platten im Free-Plan. Upgrade unter Einstellungen → Abo.',
      );
      expect((err as InstanceType<typeof LimitExceededError>).current).toBe(2);
      return true;
    });
  });

  it('maxRecords null = unbegrenzt (kein Count-Query nötig)', async () => {
    const { withTenant } = await import('@/db/tenant');
    const { checkRecordCapacity, UNLIMITED_ENTITLEMENTS } = await import('@/lib/gating');
    await withTenant({ tenantId, userId: null }, (tx) =>
      checkRecordCapacity(tx, UNLIMITED_ENTITLEMENTS, 100_000),
    );
  });

  it('maxUsers zählt nur Staff — kunde-Konten sind frei', async () => {
    const { withTenant } = await import('@/db/tenant');
    const { checkUserCapacity, FREE_FALLBACK_ENTITLEMENTS } = await import('@/lib/gating');
    // seedTenant hat 1 admin angelegt; + 3 kunden:
    await owner.query(
      `INSERT INTO users (tenant_id, email, password, role) VALUES
       ($1, 'k1@t.test', 'x', 'kunde'), ($1, 'k2@t.test', 'x', 'kunde'), ($1, 'k3@t.test', 'x', 'kunde')`,
      [tenantId],
    );
    const ent = { ...FREE_FALLBACK_ENTITLEMENTS, limits: { maxRecords: 100, maxUsers: 2 } };
    // Staff aktuell: 1 admin → 1+1==2 ok, 1+2>2 wirft.
    await withTenant({ tenantId, userId: null }, (tx) => checkUserCapacity(tx, ent, 1));
    await expect(
      withTenant({ tenantId, userId: null }, (tx) => checkUserCapacity(tx, ent, 2)),
    ).rejects.toMatchObject({ name: 'LimitExceededError' });
  });

  it('getEntitlements merged tenants.limits-Override und fällt bei unbekanntem Plan auf Free', async () => {
    const { getEntitlements } = await import('@/lib/gating');
    // seedTenant setzt plan default 'free' (Spalte hat DEFAULT); Override setzen:
    await owner.query(`UPDATE tenants SET plan = 'free', limits = '{"maxRecords": 2}' WHERE id = $1`, [tenantId]);
    const ent = await getEntitlements(tenantId);
    expect(ent.plan).toBe('free');
    expect(ent.limits.maxRecords).toBe(2);
    expect(ent.limits.maxUsers).toBe(2);

    await owner.query(`UPDATE tenants SET plan = 'gibtsnicht' WHERE id = $1`, [tenantId]);
    // getEntitlements ist React-cache()-memoisiert pro (tenantId) im selben Request-Scope;
    // in vitest gibt es keinen Request-Scope → frisches import über resetModules erzwingen:
    const { getEntitlements: fresh } = await import('@/lib/gating');
    const fallback = await fresh(tenantId);
    expect(fallback.plan).toBe('free');
    expect(fallback.limits.maxRecords).toBe(2); // Override bleibt wirksam
    expect(fallback.features).toEqual({ analytik: false, discogsListing: false });
    await owner.query(`UPDATE tenants SET plan = 'free' WHERE id = $1`, [tenantId]);
  });

  it('resetFreeshopGatingState stellt free/Override her und löscht E2E-Rückstände', async () => {
    const { resetFreeshopGatingState, FREESHOP_RECORDS } = await import('../scripts/seed');
    const { seedTenantInventory, FREESHOP_PURCHASES, FREESHOP_PERMALINKS } = await import('../scripts/seed');
    const t = await seedTenant({ slug: 'freeshop', name: 'Freeshop' });
    await seedTenantInventory(owner, t.tenantId, FREESHOP_RECORDS, FREESHOP_PURCHASES, FREESHOP_PERMALINKS);
    // E2E-Rückstände simulieren:
    await owner.query(`UPDATE tenants SET plan = 'small' WHERE id = $1`, [t.tenantId]);
    await owner.query(
      `INSERT INTO subscriptions (tenant_id, stripe_customer_id, stripe_subscription_id, plan_slug, status)
       VALUES ($1, 'fake_cus_x', 'fake_sub_x', 'small', 'active')`,
      [t.tenantId],
    );
    await owner.query(
      `INSERT INTO records (tenant_id, title, artist, hash) VALUES ($1, 'Extra', 'E2E', repeat('e', 64))`,
      [t.tenantId],
    );

    await resetFreeshopGatingState(owner, t.tenantId);

    const tenant = await owner.query(`SELECT plan, limits FROM tenants WHERE id = $1`, [t.tenantId]);
    expect(tenant.rows[0]).toMatchObject({ plan: 'free', limits: { maxRecords: 2 } });
    const subs = await owner.query(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1`, [t.tenantId]);
    expect(subs.rows[0].n).toBe(0);
    const recs = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1`, [t.tenantId]);
    expect(recs.rows[0].n).toBe(1); // nur die Seed-Baseline
  });

  it('performAnkauf/createCollection erzwingen das Limit in der Tx (Ende-zu-Ende)', async () => {
    const t = await seedTenant({ slug: 'gate2', name: 'Gate 2' });
    const { FREE_FALLBACK_ENTITLEMENTS, LimitExceededError } = await import('@/lib/gating');
    const { performAnkauf } = await import('@/lib/ankauf');
    const { createCollection } = await import('@/lib/collections');
    const ent = { ...FREE_FALLBACK_ENTITLEMENTS, limits: { maxRecords: 2, maxUsers: 2 } };
    const ctx = { tenantId: t.tenantId, userId: t.adminUserId };
    const item = (title: string) => ({
      release: { discogsId: null, title, artist: 'Gate Artist', country: null, year: null, format: 'Vinyl', genre: [], label: [], coverImage: null },
      purchasePrice: '1.00', targetPrice: '2.00', conditionRecord: 5, conditionCover: 5, listOnDiscogs: false,
    });

    await performAnkauf(ctx, item('Erste'), ent);          // 0+1 ≤ 2
    await performAnkauf(ctx, item('Zweite'), ent);         // 1+1 ≤ 2
    await expect(performAnkauf(ctx, item('Dritte'), ent)).rejects.toBeInstanceOf(LimitExceededError);

    // Batch: 2 vorhanden, Limit 4, Batchgröße 3 → wirft (2+3 > 4), NICHTS committed:
    const ent4 = { ...ent, limits: { maxRecords: 4, maxUsers: 2 } };
    await expect(
      createCollection(ctx, { sellerName: 'Zu groß', items: [item('A'), item('B'), item('C')] }, ent4),
    ).rejects.toBeInstanceOf(LimitExceededError);
    const count = await owner.query(
      `SELECT (SELECT count(*)::int FROM records WHERE tenant_id = $1) AS records,
              (SELECT count(*)::int FROM collections WHERE tenant_id = $1) AS collections`,
      [t.tenantId],
    );
    expect(count.rows[0]).toEqual({ records: 2, collections: 0 });

    // Batchgröße 2 → passt exakt (2+2 == 4):
    await createCollection(ctx, { sellerName: 'Passt', items: [item('A'), item('B')] }, ent4);
  });
});
