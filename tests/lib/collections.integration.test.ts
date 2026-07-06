import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';
import type { AnkaufInput } from '@/lib/ankauf';

let createCollection: (typeof import('@/lib/collections'))['createCollection'];
let listCollections: (typeof import('@/lib/collections'))['listCollections'];
let getCollection: (typeof import('@/lib/collections'))['getCollection'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let UNLIMITED_ENTITLEMENTS: (typeof import('@/lib/gating'))['UNLIMITED_ENTITLEMENTS'];
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;

const release = {
  discogsId: 42,
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  country: 'US',
  year: 1959,
  format: 'Vinyl',
  genre: ['Jazz'],
  label: ['Columbia'],
  coverImage: 'https://i.discogs.com/x.jpg',
};

/** A valid AnkaufInput at the given EK decimal string (VK/condition/discogs are fixed, irrelevant here). */
function ankaufItem(purchasePrice: string): AnkaufInput {
  return {
    release,
    purchasePrice,
    targetPrice: '22.50',
    conditionRecord: 5,
    conditionCover: 4,
    listOnDiscogs: false,
  };
}

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  vi.resetModules();
  ({ createCollection, listCollections, getCollection } = await import('@/lib/collections'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  ({ UNLIMITED_ENTITLEMENTS } = await import('@/lib/gating'));
  tenantA = (await seedTenant({ slug: 'collections-demo', name: 'Collections Demo' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});
const ctx = () => ({ tenantId: tenantA, userId: null });

describe('createCollection / listCollections / getCollection', () => {
  it('creates one collection + N purchases in one tx, all carrying collection_id', async () => {
    const res = await createCollection(
      ctx(),
      {
        sellerName: 'Nachlass Müller',
        items: [ankaufItem('3.00'), ankaufItem('5.00')],
      },
      UNLIMITED_ENTITLEMENTS,
    );
    expect(res.purchaseIds).toHaveLength(2);
    expect(res.recordIds).toHaveLength(2);

    const { eq } = await import('drizzle-orm');
    const rows = await withTenant(ctx(), async (tx) =>
      tx.select().from(schema.purchases).where(eq(schema.purchases.collectionId, res.collectionId)),
    );
    expect(rows).toHaveLength(2);
    for (const p of rows) {
      expect(res.purchaseIds).toContain(p.id);
      expect(p.collectionId).toBe(res.collectionId);
    }
    expect(rows.map((r) => r.id).sort()).toEqual([...res.purchaseIds].sort());

    const list = await listCollections(ctx());
    const summary = list.find((c) => c.id === res.collectionId)!;
    expect(summary).toBeDefined();
    expect(summary.sellerName).toBe('Nachlass Müller');
    expect(summary.itemCount).toBe(2);
    expect(summary.totalEkCents).toBe(800); // 3.00 + 5.00

    const detail = await getCollection(ctx(), res.collectionId);
    expect(detail).not.toBeNull();
    expect(detail!.items).toHaveLength(2);
    expect(detail!.totalEkCents).toBe(800);
    expect(detail!.items.map((i) => i.purchasePriceCents).sort((x, y) => x - y)).toEqual([300, 500]);
  });

  it('is fail-closed: a bad item rolls back the whole collection', async () => {
    const before = await listCollections(ctx());
    await expect(
      createCollection(
        ctx(),
        {
          sellerName: 'x',
          items: [ankaufItem('3.00'), ankaufItem('not-a-price')],
        },
        UNLIMITED_ENTITLEMENTS,
      ),
    ).rejects.toThrow();
    const after = await listCollections(ctx());
    expect(after).toHaveLength(before.length); // nothing committed
  });

  it('getCollection returns null for a non-existent id', async () => {
    const detail = await getCollection(ctx(), 999999);
    expect(detail).toBeNull();
  });
});
