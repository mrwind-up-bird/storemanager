import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
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
beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  ({ performAnkauf } = await import('@/lib/ankauf'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  ({ UNLIMITED_ENTITLEMENTS } = await import('@/lib/gating'));
  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});
const ctx = () => ({ tenantId: tenantA, userId: null });

describe('performAnkauf', () => {
  it('creates record + purchase', async () => {
    const r = await performAnkauf(
      ctx(),
      {
        release,
        purchasePrice: '3.00',
        targetPrice: '22.50',
        conditionRecord: 5,
        conditionCover: 4,
        listOnDiscogs: false,
      },
      UNLIMITED_ENTITLEMENTS,
    );
    expect(r.recordId).toBeTypeOf('number');
    expect(r.purchaseId).toBeTypeOf('number');
  });
  it('second identical Ankauf → 2 copies, 1 record', async () => {
    await performAnkauf(
      ctx(),
      {
        release,
        purchasePrice: '4.00',
        targetPrice: '20.00',
        conditionRecord: 4,
        conditionCover: 4,
        listOnDiscogs: false,
      },
      UNLIMITED_ENTITLEMENTS,
    );
    const recs = await withTenant(ctx(), async (tx) => tx.select().from(schema.records));
    const purs = await withTenant(ctx(), async (tx) => tx.select().from(schema.purchases));
    expect(recs).toHaveLength(1); // deduped by hash
    expect(purs.length).toBeGreaterThanOrEqual(2); // a new copy each time
  });
  it('listOnDiscogs sets discogsListingStatus=pending', async () => {
    const r = await performAnkauf(
      ctx(),
      {
        release,
        purchasePrice: '5.00',
        targetPrice: '25.00',
        conditionRecord: 6,
        conditionCover: 5,
        listOnDiscogs: true,
      },
      UNLIMITED_ENTITLEMENTS,
    );
    const row = await withTenant(ctx(), async (tx) =>
      tx
        .select()
        .from(schema.purchases)
        .where((await import('drizzle-orm')).eq(schema.purchases.id, r.purchaseId)),
    );
    expect(row[0]?.discogsListingStatus).toBe('pending');
  });
});
