import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let handleWishlistMatch: (typeof import('@/worker/jobs/wishlistMatch'))['handleWishlistMatch'];
let wishlist: typeof import('@/lib/wishlist');
let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let adminUserId: number;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  process.env.DISCOGS_DRIVER = 'fake';
  vi.resetModules();
  ({ handleWishlistMatch } = await import('@/worker/jobs/wishlistMatch'));
  wishlist = await import('@/lib/wishlist');
  ({ performAnkauf } = await import('@/lib/ankauf'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  // Seed AFTER resetModules so seedTenant's ownerPool binds to the same @/db/client
  // instance teardown closes.
  ({ tenantId: tenantA, adminUserId } = await seedTenant({ slug: 'demo', name: 'Demo' }));
}, 120_000);

afterAll(async () => {
  if (teardown) await teardown();
});

const makeWishlist = (artist: string) =>
  wishlist.createWishlist(
    { tenantId: tenantA, userId: adminUserId },
    { customerName: 'Klaus', customerEmail: 'klaus@example.test', artist },
  );

const ankauf = (artist: string, title: string, discogsId: number) =>
  performAnkauf(
    { tenantId: tenantA, userId: null },
    {
      release: {
        discogsId,
        title,
        artist,
        country: 'US',
        year: 1959,
        format: 'Vinyl',
        genre: ['Jazz'],
        label: ['Columbia'],
        coverImage: null,
      },
      purchasePrice: '3.00',
      targetPrice: '20.00',
      conditionRecord: 5,
      conditionCover: 4,
      listOnDiscogs: false,
    },
  );

const fakeJob = (purchaseId: number, recordId: number) =>
  ({ id: 'j', name: 'q', data: { tenantId: tenantA, purchaseId, recordId } }) as unknown as Parameters<
    typeof handleWishlistMatch
  >[0];

const matchesFor = async (purchaseId: number) =>
  withTenant({ tenantId: tenantA, userId: null }, async (tx) =>
    tx
      .select()
      .from(schema.wishlistMatches)
      .where(eq(schema.wishlistMatches.purchaseId, purchaseId)),
  );

describe('handleWishlistMatch', () => {
  it('creates one pending match for a matching open wishlist', async () => {
    const wl = await makeWishlist('Miles Davis');
    const { recordId, purchaseId } = await ankauf('Miles Davis', 'Kind of Blue', 101);

    await handleWishlistMatch(fakeJob(purchaseId, recordId));

    const rows = await matchesFor(purchaseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.wishlistId).toBe(wl.id);
    expect(rows[0]?.recordId).toBe(recordId);
    expect(rows[0]?.status).toBe('pending');
  });

  it('is idempotent on re-run: persist re-invoked, but only one row (1 inserted then 0)', async () => {
    await makeWishlist('Coltrane');
    const { recordId, purchaseId } = await ankauf('John Coltrane', 'Blue Train', 102);

    // spyOn calls THROUGH (no mockImplementation): the real persistence runs each time,
    // and we read its return values to prove the DB-level dedup, not a handler short-circuit.
    const spy = vi.spyOn(wishlist, 'findAndPersistWishlistMatches');
    try {
      await handleWishlistMatch(fakeJob(purchaseId, recordId));
      await handleWishlistMatch(fakeJob(purchaseId, recordId));

      // Non-vacuous: the handler did NOT skip the second run...
      expect(spy).toHaveBeenCalledTimes(2);
      // ...and onConflictDoNothing on unique (wishlistId, purchaseId) deduped it: 1 then 0.
      const inserted = await Promise.all(spy.mock.results.map((r) => r.value as Promise<number>));
      expect(inserted).toEqual([1, 0]);

      const rows = await matchesFor(purchaseId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('pending');
    } finally {
      spy.mockRestore();
    }
  });

  it('creates no match when a present wishlist does not match the arrived record', async () => {
    await makeWishlist('Bill Evans');
    const { recordId, purchaseId } = await ankauf('Sun Ra', 'Space Is the Place', 103);

    await handleWishlistMatch(fakeJob(purchaseId, recordId));

    const rows = await matchesFor(purchaseId);
    expect(rows).toHaveLength(0);
  });
});
