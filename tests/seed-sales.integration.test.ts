// tests/seed-sales.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant } from './helpers/db';
import type { TestDatabase } from './helpers/db';

let testDb: TestDatabase;
let ownerPool: Pool;

async function counts(pool: Pool, tenantId: number) {
  const r = await pool.query<{ quick: string; quick_active: string; wishlists: string; open: string }>(
    `SELECT
       (SELECT COUNT(*) FROM quick_items WHERE tenant_id = $1)                       AS quick,
       (SELECT COUNT(*) FROM quick_items WHERE tenant_id = $1 AND active = true)     AS quick_active,
       (SELECT COUNT(*) FROM wishlists   WHERE tenant_id = $1)                       AS wishlists,
       (SELECT COUNT(*) FROM wishlists   WHERE tenant_id = $1 AND status = 'open')   AS open`,
    [tenantId],
  );
  const row = r.rows[0]!;
  return {
    quick: Number(row.quick),
    quickActive: Number(row.quick_active),
    wishlists: Number(row.wishlists),
    open: Number(row.open),
  };
}

describe('Seed sales/wishlist data', () => {
  beforeAll(async () => {
    testDb = await setupTestDatabase();
    ownerPool = new Pool({ connectionString: testDb.ownerUrl });
  }, 60_000);

  afterAll(async () => {
    await ownerPool.end();
    await testDb.teardown();
  });

  it('exports seedTenantSales, ensureQuickItem, ensureWishlist and the datasets', async () => {
    const m = await import('../scripts/seed');
    expect(typeof m.seedTenantSales).toBe('function');
    expect(typeof m.ensureQuickItem).toBe('function');
    expect(typeof m.ensureWishlist).toBe('function');
    expect(Array.isArray(m.DEMO_QUICK_ITEMS)).toBe(true);
    expect(m.DEMO_QUICK_ITEMS.length).toBeGreaterThan(0);
    expect(Array.isArray(m.DEMO_WISHLISTS)).toBe(true);
    expect(m.DEMO_WISHLISTS.length).toBeGreaterThan(0);
  });

  it('seeds active quick items + at least one OPEN wishlist; idempotent on re-run', async () => {
    const { seedTenantSales, DEMO_QUICK_ITEMS, DEMO_WISHLISTS } = await import('../scripts/seed');
    const { tenantId } = await seedTenant({ slug: 'sales-seed', name: 'Sales Seed' });

    await seedTenantSales(ownerPool, tenantId, DEMO_QUICK_ITEMS, DEMO_WISHLISTS);
    const c1 = await counts(ownerPool, tenantId);

    expect(c1.quick).toBe(DEMO_QUICK_ITEMS.length);
    expect(c1.quickActive).toBe(DEMO_QUICK_ITEMS.length); // every seeded quick item is active
    expect(c1.wishlists).toBe(DEMO_WISHLISTS.length);
    expect(c1.open).toBe(DEMO_WISHLISTS.length); // default status 'open'

    // Re-run must not duplicate (idempotent ensure* helpers).
    await seedTenantSales(ownerPool, tenantId, DEMO_QUICK_ITEMS, DEMO_WISHLISTS);
    const c2 = await counts(ownerPool, tenantId);
    expect(c2).toEqual(c1);
  }, 60_000);

  it('a seeded wishlist artist matches a seeded record (E2E match precondition)', async () => {
    const { seedTenantInventory, seedTenantSales, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS, DEMO_WISHLISTS } =
      await import('../scripts/seed');
    const { tenantId } = await seedTenant({ slug: 'sales-match', name: 'Sales Match' });

    await seedTenantInventory(ownerPool, tenantId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);
    await seedTenantSales(ownerPool, tenantId, [], DEMO_WISHLISTS);

    // For at least one open wishlist there is a record whose artist (ci) CONTAINS the wishlist artist —
    // exactly the rule handleWishlistMatch (T7) applies, so a matching Ankauf in T14 will produce a pending row.
    const r = await ownerPool.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM wishlists w
         JOIN records  rec
           ON rec.tenant_id = w.tenant_id
          AND lower(rec.artist) LIKE '%' || lower(w.artist) || '%'
        WHERE w.tenant_id = $1 AND w.status = 'open'`,
      [tenantId],
    );
    expect(Number(r.rows[0]!.n)).toBeGreaterThan(0);
  }, 60_000);
});
