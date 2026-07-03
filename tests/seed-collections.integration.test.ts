// tests/seed-collections.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant } from './helpers/db';
import type { TestDatabase } from './helpers/db';

let testDb: TestDatabase;
let ownerPool: Pool;

async function collectionCounts(pool: Pool, tenantId: number, sellerName: string) {
  const r = await pool.query<{ collections: string; purchases_with_collection: string }>(
    `SELECT
       (SELECT COUNT(*) FROM collections WHERE tenant_id = $1 AND seller_name = $2) AS collections,
       (SELECT COUNT(*) FROM purchases p
          JOIN collections c ON c.id = p.collection_id
         WHERE c.tenant_id = $1 AND c.seller_name = $2)                              AS purchases_with_collection`,
    [tenantId, sellerName],
  );
  const row = r.rows[0]!;
  return {
    collections: Number(row.collections),
    purchasesWithCollection: Number(row.purchases_with_collection),
  };
}

async function quickItemCategory(pool: Pool, tenantId: number, name: string): Promise<string | null> {
  const r = await pool.query<{ category: string | null }>(
    `SELECT category FROM quick_items WHERE tenant_id = $1 AND name = $2`,
    [tenantId, name],
  );
  return r.rows[0]?.category ?? null;
}

describe('Seed demo collection + quick-item categories (Slice 4)', () => {
  beforeAll(async () => {
    testDb = await setupTestDatabase();
    ownerPool = new Pool({ connectionString: testDb.ownerUrl });
  }, 60_000);

  afterAll(async () => {
    await ownerPool.end();
    await testDb.teardown();
  });

  it('exports seedTenantCollections, ensureDemoCollection, DEMO_COLLECTION and categorized DEMO_QUICK_ITEMS', async () => {
    const m = await import('../scripts/seed');
    expect(typeof m.seedTenantCollections).toBe('function');
    expect(typeof m.ensureDemoCollection).toBe('function');
    expect(m.DEMO_COLLECTION.sellerName).toBe('Nachlass Beispiel');
    expect(m.DEMO_COLLECTION.items.length).toBeGreaterThanOrEqual(2);
    expect(m.DEMO_COLLECTION.items.length).toBeLessThanOrEqual(3);
    for (const qi of m.DEMO_QUICK_ITEMS) {
      expect(typeof qi.category).toBe('string');
    }
  });

  it('seeds exactly one "Nachlass Beispiel" collection with 2-3 purchases carrying its collection_id; idempotent on re-run', async () => {
    const { seedTenantCollections, DEMO_COLLECTION } = await import('../scripts/seed');
    const { tenantId } = await seedTenant({ slug: 'collections-seed', name: 'Collections Seed' });

    await seedTenantCollections(ownerPool, tenantId, DEMO_COLLECTION);
    const c1 = await collectionCounts(ownerPool, tenantId, DEMO_COLLECTION.sellerName);
    expect(c1.collections).toBe(1);
    expect(c1.purchasesWithCollection).toBe(DEMO_COLLECTION.items.length);
    expect(c1.purchasesWithCollection).toBeGreaterThanOrEqual(2);
    expect(c1.purchasesWithCollection).toBeLessThanOrEqual(3);

    // Good demo data for both the label-QR path (real discogsId) and the no-QR path (null).
    const discogsIds = DEMO_COLLECTION.items.map((i) => i.release.discogsId);
    expect(discogsIds.some((id) => id !== null)).toBe(true);
    expect(discogsIds.some((id) => id === null)).toBe(true);

    // Re-run must NOT create a second collection (skip-if-exists idempotency) — read-back
    // counts stay identical.
    await seedTenantCollections(ownerPool, tenantId, DEMO_COLLECTION);
    const c2 = await collectionCounts(ownerPool, tenantId, DEMO_COLLECTION.sellerName);
    expect(c2).toEqual(c1);
  }, 60_000);

  it('quick items carry categories, including update-on-reseed for a previously-NULL row', async () => {
    const { seedTenantSales, ensureQuickItem, DEMO_QUICK_ITEMS, DEMO_WISHLISTS } = await import('../scripts/seed');
    const { tenantId } = await seedTenant({ slug: 'quick-item-cat-seed', name: 'Quick Item Cat Seed' });

    await seedTenantSales(ownerPool, tenantId, DEMO_QUICK_ITEMS, DEMO_WISHLISTS);
    for (const qi of DEMO_QUICK_ITEMS) {
      expect(await quickItemCategory(ownerPool, tenantId, qi.name)).toBe(qi.category);
    }

    // Non-vacuous state-idempotency proof: null out a category (simulating a row seeded before
    // Slice 4), re-run the seed helper, and confirm ensureQuickItem UPDATEs it back rather than
    // skipping because the row already exists.
    const first = DEMO_QUICK_ITEMS[0]!;
    await ownerPool.query(`UPDATE quick_items SET category = NULL WHERE tenant_id = $1 AND name = $2`, [
      tenantId,
      first.name,
    ]);
    expect(await quickItemCategory(ownerPool, tenantId, first.name)).toBeNull();

    await ensureQuickItem(ownerPool, { tenantId, name: first.name, price: first.price, category: first.category });
    expect(await quickItemCategory(ownerPool, tenantId, first.name)).toBe(first.category);
  }, 60_000);
});
