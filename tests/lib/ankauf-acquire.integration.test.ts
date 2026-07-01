import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';

/**
 * Regression guard for the `acquireOne` extraction (Task 6): `performAnkauf` must keep behaving
 * EXACTLY as it did before the refactor — hash-dedup on `records`, always-new `purchases`, and
 * (new invariant) `collection_id IS NULL` for every purchase created via the single-Ankauf path.
 * Written BEFORE the refactor to capture current behavior; must stay green after it.
 */
let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
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

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  vi.resetModules();
  ({ performAnkauf } = await import('@/lib/ankauf'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  tenantA = (await seedTenant({ slug: 'acquire-demo', name: 'Acquire Demo' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});
const ctx = () => ({ tenantId: tenantA, userId: null });

describe('performAnkauf (regression via acquireOne)', () => {
  it('two identical Ankauf calls → 1 record (hash-dedup), 2 purchases, both collection_id IS NULL', async () => {
    const input = {
      release,
      purchasePrice: '3.00',
      targetPrice: '22.50',
      conditionRecord: 5,
      conditionCover: 4,
      listOnDiscogs: false,
    };
    const first = await performAnkauf(ctx(), input);
    const second = await performAnkauf(ctx(), input);
    expect(first.recordId).toBe(second.recordId);
    expect(first.purchaseId).not.toBe(second.purchaseId);

    const recs = await withTenant(ctx(), async (tx) =>
      tx.select().from(schema.records).where((await import('drizzle-orm')).eq(schema.records.id, first.recordId)),
    );
    expect(recs).toHaveLength(1);

    const purs = await withTenant(ctx(), async (tx) =>
      tx
        .select()
        .from(schema.purchases)
        .where(
          (await import('drizzle-orm')).inArray(schema.purchases.id, [first.purchaseId, second.purchaseId]),
        ),
    );
    expect(purs).toHaveLength(2);
    for (const p of purs) {
      expect(p.recordId).toBe(first.recordId);
      expect(p.collectionId).toBeNull();
    }
  });
});
