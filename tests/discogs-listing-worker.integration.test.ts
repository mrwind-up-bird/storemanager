import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

let handle: (typeof import('@/worker/jobs/discogsListing'))['handleDiscogsListingCreate'];
let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
let upsertConnection: (typeof import('@/lib/discogs-connection'))['upsertConnection'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  process.env.DISCOGS_DRIVER = 'fake';
  vi.resetModules();
  ({ handleDiscogsListingCreate: handle } = await import('@/worker/jobs/discogsListing'));
  ({ performAnkauf } = await import('@/lib/ankauf'));
  ({ upsertConnection } = await import('@/lib/discogs-connection'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo' })).tenantId;
  await upsertConnection(
    { tenantId: tenantA, userId: null },
    { discogsUsername: 'demo', auth: { token: 't', tokenSecret: 's' }, connectedByUserId: null },
  );
});

afterAll(async () => {
  if (teardown) await teardown();
});

const release = (discogsId: number | null) => ({
  discogsId: discogsId as number,
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  country: 'US',
  year: 1959,
  format: 'Vinyl',
  genre: ['Jazz'],
  label: ['Columbia'],
  coverImage: null,
});
const fakeJob = (purchaseId: number) =>
  ({ id: 'j', name: 'q', data: { tenantId: tenantA, purchaseId } }) as unknown as Parameters<
    typeof handle
  >[0];
const status = async (id: number) =>
  (
    await withTenant({ tenantId: tenantA, userId: null }, async (tx) =>
      tx
        .select()
        .from(schema.purchases)
        .where((await import('drizzle-orm')).eq(schema.purchases.id, id)),
    )
  )[0];

describe('handleDiscogsListingCreate', () => {
  it('lists a pending copy → listed + listingId', async () => {
    const { purchaseId } = await performAnkauf(
      { tenantId: tenantA, userId: null },
      {
        release: release(42),
        purchasePrice: '3',
        targetPrice: '22.50',
        conditionRecord: 5,
        conditionCover: 4,
        listOnDiscogs: true,
      },
    );
    await handle(fakeJob(purchaseId));
    const row = await status(purchaseId);
    expect(row?.discogsListingStatus).toBe('listed');
    expect(row?.discogsListingId).toBeTruthy();
  });

  it('is idempotent on re-run (createListing called exactly once)', async () => {
    const { getDiscogsAdapter } = await import('@/lib/discogs/index');
    // getDiscogsAdapter() caches a singleton, and the handler calls it itself, so
    // spying on the returned object's method instruments the SAME instance the
    // handler uses — a true guard against re-listing on the second run.
    const spy = vi.spyOn(getDiscogsAdapter(), 'createListing');
    try {
      const { purchaseId } = await performAnkauf(
        { tenantId: tenantA, userId: null },
        {
          release: release(43),
          purchasePrice: '3',
          targetPrice: '22.50',
          conditionRecord: 5,
          conditionCover: 4,
          listOnDiscogs: true,
        },
      );
      await handle(fakeJob(purchaseId));
      const first = await status(purchaseId);
      expect(first?.discogsListingStatus).toBe('listed');

      await handle(fakeJob(purchaseId));
      expect((await status(purchaseId))?.discogsListingId).toBe(first?.discogsListingId);
      // The second run must short-circuit on the idempotency guard — no new listing.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('marks failed when the record has no discogsId', async () => {
    const { purchaseId } = await performAnkauf(
      { tenantId: tenantA, userId: null },
      {
        release: release(null),
        purchasePrice: '3',
        targetPrice: '22.50',
        conditionRecord: 5,
        conditionCover: 4,
        listOnDiscogs: true,
      },
    );
    await handle(fakeJob(purchaseId));
    const row = await status(purchaseId);
    expect(row?.discogsListingStatus).toBe('failed');
    expect(row?.discogsListingId).toBeNull();
  });
});
