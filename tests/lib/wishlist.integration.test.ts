import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let wishlistLib: typeof import('@/lib/wishlist');
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let adminA: number;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  vi.resetModules();
  wishlistLib = await import('@/lib/wishlist');
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  const seeded = await seedTenant({ slug: 'wl-demo', name: 'WL Demo' });
  tenantA = seeded.tenantId;
  adminA = seeded.adminUserId;
});
afterAll(async () => {
  if (teardown) await teardown();
});

const ctx = () => ({ tenantId: tenantA, userId: adminA });

// Seed a record + an available purchase copy directly on the RLS tx (not the system under test).
async function seedRecordAndPurchase(opts: {
  artist: string;
  title: string;
  country?: string | null;
  label?: string[];
  hash: string;
}): Promise<{ recordId: number; purchaseId: number }> {
  return withTenant(ctx(), async (tx) => {
    const [rec] = await tx
      .insert(schema.records)
      .values({
        tenantId: tenantA,
        title: opts.title,
        artist: opts.artist,
        label: opts.label ?? [],
        country: opts.country ?? null,
        hash: opts.hash,
      })
      .returning({ id: schema.records.id });
    const [pur] = await tx
      .insert(schema.purchases)
      .values({ tenantId: tenantA, recordId: rec!.id, targetPrice: '20.00', status: 'verfuegbar' })
      .returning({ id: schema.purchases.id });
    return { recordId: rec!.id, purchaseId: pur!.id };
  });
}

describe('createWishlist', () => {
  it('inserts a wishlist (open by default) and normalises blank optionals to null', async () => {
    const { id } = await wishlistLib.createWishlist(ctx(), {
      customerName: '  Ada  ',
      customerEmail: 'ada@example.test',
      artist: '  Kraftwerk  ',
      label: '   ', // blank → null
      title: null,
      country: 'DE',
    });
    const [row] = await withTenant(ctx(), async (tx) =>
      tx.select().from(schema.wishlists).where(eq(schema.wishlists.id, id)),
    );
    expect(row?.status).toBe('open');
    expect(row?.customerName).toBe('Ada'); // trimmed
    expect(row?.artist).toBe('Kraftwerk'); // trimmed
    expect(row?.label).toBeNull(); // blank optional → null
    expect(row?.country).toBe('DE');
    expect(row?.createdByUserId).toBe(adminA);
  });

  it('throws when ctx.userId is null (createdByUserId is NOT NULL)', async () => {
    await expect(
      wishlistLib.createWishlist(
        { tenantId: tenantA, userId: null },
        { customerName: 'X', customerEmail: 'x@example.test', artist: 'Y' },
      ),
    ).rejects.toThrow(/userId/);
  });
});

describe('findAndPersistWishlistMatches', () => {
  it('inserts one pending match and is idempotent on re-run (non-vacuous)', async () => {
    const { recordId, purchaseId } = await seedRecordAndPurchase({
      artist: 'Miles Davis',
      title: 'Kind of Blue',
      country: 'US',
      label: ['Columbia'],
      hash: 'm'.padEnd(64, '1'),
    });
    await wishlistLib.createWishlist(ctx(), {
      customerName: 'Bo',
      customerEmail: 'bo@example.test',
      artist: 'miles davis', // ci-substring of 'Miles Davis'
    });

    const first = await wishlistLib.findAndPersistWishlistMatches(ctx(), { purchaseId, recordId });
    expect(first).toBe(1); // one NEW match inserted

    const second = await wishlistLib.findAndPersistWishlistMatches(ctx(), { purchaseId, recordId });
    expect(second).toBe(0); // onConflictDoNothing — re-run inserts ZERO

    const rows = await withTenant(ctx(), async (tx) =>
      tx
        .select()
        .from(schema.wishlistMatches)
        .where(eq(schema.wishlistMatches.purchaseId, purchaseId)),
    );
    expect(rows).toHaveLength(1); // non-vacuous: exactly one row survives the re-run
    expect(rows[0]?.status).toBe('pending');
  });

  it('returns 0 and inserts nothing when no open wishlist matches the record', async () => {
    const { recordId, purchaseId } = await seedRecordAndPurchase({
      artist: 'Nobody Wants This',
      title: 'Untracked',
      hash: 'n'.padEnd(64, '2'),
    });
    const n = await wishlistLib.findAndPersistWishlistMatches(ctx(), { purchaseId, recordId });
    expect(n).toBe(0);
    const rows = await withTenant(ctx(), async (tx) =>
      tx
        .select()
        .from(schema.wishlistMatches)
        .where(eq(schema.wishlistMatches.purchaseId, purchaseId)),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('listPendingMatches', () => {
  it('returns pending matches on OPEN wishlists and HIDES matches on notified wishlists', async () => {
    // (a) open wishlist + matching pending match → must appear
    const a = await seedRecordAndPurchase({
      artist: 'Aphex Twin',
      title: 'Selected Ambient Works',
      hash: 'a'.padEnd(64, '3'),
    });
    await wishlistLib.createWishlist(ctx(), {
      customerName: 'Ci',
      customerEmail: 'ci@example.test',
      artist: 'aphex twin',
    });
    await wishlistLib.findAndPersistWishlistMatches(ctx(), {
      purchaseId: a.purchaseId,
      recordId: a.recordId,
    });

    // (b) NOTIFIED wishlist carrying a pending match → must be hidden (terminal-notify, C9.4)
    const b = await seedRecordAndPurchase({
      artist: 'Boards of Canada',
      title: 'Music Has the Right',
      hash: 'b'.padEnd(64, '4'),
    });
    const notifiedWishlistId = await withTenant(ctx(), async (tx) => {
      const [w] = await tx
        .insert(schema.wishlists)
        .values({
          tenantId: tenantA,
          createdByUserId: adminA,
          customerName: 'Do',
          customerEmail: 'do@example.test',
          artist: 'Boards of Canada',
          status: 'notified',
        })
        .returning({ id: schema.wishlists.id });
      await tx.insert(schema.wishlistMatches).values({
        tenantId: tenantA,
        wishlistId: w!.id,
        purchaseId: b.purchaseId,
        recordId: b.recordId,
        status: 'pending',
      });
      return w!.id;
    });

    const pending = await wishlistLib.listPendingMatches(ctx());
    expect(pending.map((p) => p.artist)).toContain('Aphex Twin');
    expect(pending.some((p) => p.wishlistId === notifiedWishlistId)).toBe(false);
    // join shape is populated (customer from wishlists, artist/title from records)
    const aphex = pending.find((p) => p.artist === 'Aphex Twin');
    expect(aphex?.customerName).toBe('Ci');
    expect(aphex?.title).toBe('Selected Ambient Works');
    expect(typeof aphex?.matchId).toBe('number');
  });
});
