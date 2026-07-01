import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';

const notifySpy = vi.fn(async () => undefined);
vi.mock('@/lib/jobs', () => ({ enqueueWishlistNotification: notifySpy }));

let actions: typeof import('@/app/(app)/wunschlisten/actions');
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let records: (typeof import('@/db/schema'))['records'];
let purchases: (typeof import('@/db/schema'))['purchases'];
let wishlists: (typeof import('@/db/schema'))['wishlists'];
let wishlistMatches: (typeof import('@/db/schema'))['wishlistMatches'];

let teardown: (() => Promise<void>) | undefined;
let tenantA = 0;
let adminUserId = 0;
let sessionRole: 'admin' | 'kunde' = 'admin';

async function insertMatch(status: 'pending' | 'notified' | 'dismissed'): Promise<number> {
  return withOwner(async (tx) => {
    const [rec] = await tx
      .insert(records)
      .values({
        tenantId: tenantA,
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        label: ['Columbia'],
        format: 'Vinyl',
        genre: ['Jazz'],
        releaseYear: 1959,
        country: 'US',
        hash: `h-${Math.random().toString(36).slice(2)}`,
      })
      .returning({ id: records.id });
    const [pur] = await tx
      .insert(purchases)
      .values({
        tenantId: tenantA,
        recordId: rec.id,
        status: 'verfuegbar',
        conditionRecord: 7,
        conditionCover: 7,
        purchasePrice: '10.00',
        targetPrice: '20.00',
      })
      .returning({ id: purchases.id });
    const [wl] = await tx
      .insert(wishlists)
      .values({
        tenantId: tenantA,
        createdByUserId: adminUserId,
        customerName: 'Max Mustermann',
        customerEmail: 'max@example.com',
        artist: 'Miles Davis',
        status: 'open',
      })
      .returning({ id: wishlists.id });
    const [m] = await tx
      .insert(wishlistMatches)
      .values({
        tenantId: tenantA,
        wishlistId: wl.id,
        purchaseId: pur.id,
        recordId: rec.id,
        status,
      })
      .returning({ id: wishlistMatches.id });
    return m.id;
  });
}

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;

  vi.doMock('@/auth/session', () => ({
    requireSession: async () => ({
      id: adminUserId,
      email: 'staff@demo',
      tenantId: tenantA,
      role: sessionRole,
      isSuperadmin: false,
    }),
  }));
  vi.doMock('next/headers', () => ({
    headers: async () => new Headers(),
    cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  }));
  vi.doMock('next/navigation', () => ({
    forbidden: () => {
      throw new Error('FORBIDDEN');
    },
    redirect: (url: string) => {
      throw new Error(`REDIRECT:${url}`);
    },
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.resetModules();

  const seed = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantA = seed.tenantId;
  adminUserId = seed.adminUserId;
  ({ withOwner } = await import('@/db/tenant'));
  ({ records, purchases, wishlists, wishlistMatches } = await import('@/db/schema'));
  actions = await import('@/app/(app)/wunschlisten/actions');
});

afterAll(async () => {
  if (teardown) await teardown();
});

afterEach(() => {
  sessionRole = 'admin';
  notifySpy.mockClear();
});

describe('wunschlisten actions', () => {
  it('createWishlist: kunde role is forbidden', async () => {
    sessionRole = 'kunde';
    await expect(
      actions.createWishlist({ customerName: 'Max', customerEmail: 'max@example.com', artist: 'Miles Davis' }),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('createWishlist: invalid email → reason validation', async () => {
    const r = await actions.createWishlist({ customerName: 'Max', customerEmail: 'not-an-email', artist: 'X' });
    expect(r).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('createWishlist: happy path → ok + row persisted', async () => {
    const r = await actions.createWishlist({
      customerName: 'Erika',
      customerEmail: 'erika@example.com',
      artist: 'Kraftwerk',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    const { ownerPool } = await import('@/db/client');
    const w = await ownerPool.query('SELECT customer_name, artist, status FROM wishlists WHERE id = $1', [r.id]);
    expect(w.rows[0]).toMatchObject({ customer_name: 'Erika', artist: 'Kraftwerk', status: 'open' });
  });

  it('notifyWishlistMatch: unknown id → reason not_found, no enqueue', async () => {
    const r = await actions.notifyWishlistMatch({ matchId: 999999 });
    expect(r).toMatchObject({ ok: false, reason: 'not_found' });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('notifyWishlistMatch: pending match → ok + enqueues exactly once', async () => {
    const matchId = await insertMatch('pending');
    const r = await actions.notifyWishlistMatch({ matchId });
    expect(r).toEqual({ ok: true });
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith({ tenantId: tenantA, matchId });
  });

  it('notifyWishlistMatch: already-notified match → ok WITHOUT enqueue (idempotent)', async () => {
    const matchId = await insertMatch('notified');
    const r = await actions.notifyWishlistMatch({ matchId });
    expect(r).toEqual({ ok: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('dismissMatch: pending → ok + status dismissed; unknown → not_found', async () => {
    const matchId = await insertMatch('pending');
    const r = await actions.dismissMatch({ matchId });
    expect(r).toEqual({ ok: true });
    const { ownerPool } = await import('@/db/client');
    const m = await ownerPool.query('SELECT status FROM wishlist_matches WHERE id = $1', [matchId]);
    expect(m.rows[0].status).toBe('dismissed');
    const r2 = await actions.dismissMatch({ matchId: 999999 });
    expect(r2).toMatchObject({ ok: false, reason: 'not_found' });
  });
});
