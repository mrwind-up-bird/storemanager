import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

const enqueueSpy = vi.fn(async () => undefined);
const enqueueMatchSpy = vi.fn(async () => undefined);
vi.mock('@/lib/jobs', () => ({
  enqueueDiscogsListing: enqueueSpy,
  enqueueWishlistMatch: enqueueMatchSpy,
}));

let actions: typeof import('@/app/(app)/ankauf/actions');
let mod: typeof import('@/lib/discogs-connection');
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
  coverImage: null,
};

beforeAll(async () => {
  const db = await setupTestDatabase();

  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  process.env.DISCOGS_DRIVER = 'fake';
  vi.doMock('@/auth/session', () => ({
    requireSession: async () => ({
      id: 1,
      email: 'a@demo',
      tenantId: tenantA,
      role: 'admin',
      isSuperadmin: false,
    }),
  }));
  vi.doMock('next/headers', () => ({
    headers: async () => new Headers(),
    cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.resetModules();
  // Seed AFTER resetModules so seedTenant's ownerPool binds to the same @/db/client
  // instance the teardown closes (a pre-reset seed would leak a qr_owner connection).
  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo' })).tenantId;
  mod = await import('@/lib/discogs-connection');
  actions = await import('@/app/(app)/ankauf/actions');
}, 60_000);
afterAll(async () => {
  if (teardown) await teardown();
});

describe('ankauf actions', () => {
  it('searchDiscogs without connection → not_connected', async () => {
    const r = await actions.searchDiscogs('blue');
    expect(r).toEqual({ ok: false, reason: 'not_connected' });
  });
  it('ankaufRecord with invalid EK → validation', async () => {
    await mod.upsertConnection(
      { tenantId: tenantA, userId: 1 },
      { discogsUsername: 'demo', auth: { token: 't', tokenSecret: 's' }, connectedByUserId: 1 },
    );
    const r = await actions.ankaufRecord({
      release,
      purchasePrice: 'abc',
      targetPrice: '22.50',
      conditionRecord: 5,
      conditionCover: 4,
      listOnDiscogs: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'validation' });
  });
  it('ankaufRecord ok + enqueues when listing', async () => {
    const r = await actions.ankaufRecord({
      release,
      purchasePrice: '3.00',
      targetPrice: '22.50',
      conditionRecord: 5,
      conditionCover: 4,
      listOnDiscogs: true,
    });
    expect(r.ok).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });
  it('ankaufRecord enqueues a wishlist match on every successful ankauf (independent of listing)', async () => {
    enqueueMatchSpy.mockClear();
    enqueueSpy.mockClear(); // reset discogs spy so "not.toHaveBeenCalled" is scoped to this test only
    const r = await actions.ankaufRecord({
      release,
      purchasePrice: '4.00',
      targetPrice: '19.00',
      conditionRecord: 4,
      conditionCover: 4,
      listOnDiscogs: false, // wishlist enqueue must fire even when NOT listing on Discogs
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(enqueueMatchSpy).toHaveBeenCalledWith({
        tenantId: tenantA,
        purchaseId: r.purchaseId,
        recordId: r.recordId,
      });
    }
    // Not listing → the discogs enqueue must NOT have run for this call.
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('ankaufRecord returns ok+listingSkipped when enqueue fails, purchase still committed', async () => {
    enqueueSpy.mockRejectedValueOnce(new Error('queue down'));
    const r = await actions.ankaufRecord({
      release,
      purchasePrice: '6.00',
      targetPrice: '20.00',
      conditionRecord: 3,
      conditionCover: 3,
      listOnDiscogs: true,
    });
    expect(r).toMatchObject({ ok: true, listingSkipped: true });
    if (r.ok) {
      expect(typeof r.purchaseId).toBe('number');
      // Verify the purchase row was committed despite the enqueue failure.
      const { ownerPool } = await import('@/db/client');
      const { rows } = await ownerPool.query('SELECT id FROM purchases WHERE id = $1', [r.purchaseId]);
      expect(rows).toHaveLength(1);
    }
  });
});
