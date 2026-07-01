import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, seedTenant } from '../helpers/db';

// Override getEmailAdapter to a fake whose send is a spy; keep sendWishlistNotificationEmail REAL.
const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/index', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/email/index')>();
  return { ...actual, getEmailAdapter: () => ({ send: sendSpy }) };
});

let handle: (typeof import('@/worker/jobs/wishlistNotify'))['handleWishlistNotify'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;

let tenantId: number;
let adminUserId: number;
let recordId: number;
let purchaseId: number;
let wishlistId: number;
let matchId: number;

const ctx = () => ({ tenantId, userId: null });

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  process.env.MAIL_DRIVER = 'console';
  vi.resetModules();
  ({ handleWishlistNotify: handle } = await import('@/worker/jobs/wishlistNotify'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');

  ({ tenantId, adminUserId } = await seedTenant({ slug: 'wn', name: 'Wunsch Records' }));

  await withTenant(ctx(), async (tx) => {
    const [rec] = await tx
      .insert(schema.records)
      .values({
        tenantId,
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        hash: 'hash-wishlist-notify-1',
      })
      .returning({ id: schema.records.id });
    recordId = rec.id;

    const [p] = await tx
      .insert(schema.purchases)
      .values({ tenantId, recordId, targetPrice: '22.50' })
      .returning({ id: schema.purchases.id });
    purchaseId = p.id;

    const [wl] = await tx
      .insert(schema.wishlists)
      .values({
        tenantId,
        createdByUserId: adminUserId,
        customerName: 'Lena',
        customerEmail: 'lena@example.com',
        artist: 'Miles Davis',
        title: 'Kind of Blue',
      })
      .returning({ id: schema.wishlists.id });
    wishlistId = wl.id;

    const [m] = await tx
      .insert(schema.wishlistMatches)
      .values({ tenantId, wishlistId, purchaseId, recordId })
      .returning({ id: schema.wishlistMatches.id });
    matchId = m.id;
  });
});

afterAll(async () => {
  if (teardown) await teardown();
});

beforeEach(() => {
  sendSpy.mockClear();
});

const fakeJob = (data: { tenantId: number; matchId: number }) =>
  ({ id: 'j', name: 'tenant.wishlist.notify', data }) as unknown as Parameters<typeof handle>[0];

const readMatch = async (id: number) =>
  (
    await withTenant(ctx(), async (tx) =>
      tx
        .select({ status: schema.wishlistMatches.status, notifiedAt: schema.wishlistMatches.notifiedAt })
        .from(schema.wishlistMatches)
        .where(eq(schema.wishlistMatches.id, id)),
    )
  )[0];

const readWishlist = async (id: number) =>
  (
    await withTenant(ctx(), async (tx) =>
      tx
        .select({ status: schema.wishlists.status })
        .from(schema.wishlists)
        .where(eq(schema.wishlists.id, id)),
    )
  )[0];

describe('handleWishlistNotify (C9.4)', () => {
  it('sends the mail once and flips match + wishlist to notified', async () => {
    await handle(fakeJob({ tenantId, matchId }));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = ((sendSpy.mock.calls[0]! as unknown[])[0]) as { to: string; subject: string };
    expect(sent.to).toBe('lena@example.com');
    expect(sent.subject).toContain('Miles Davis');
    expect(sent.subject).toContain('Kind of Blue');

    const match = await readMatch(matchId);
    expect(match.status).toBe('notified');
    expect(match.notifiedAt).not.toBeNull();
    const wl = await readWishlist(wishlistId);
    expect(wl.status).toBe('notified');
  });

  it('is idempotent on re-run: a second invocation sends NO further mail', async () => {
    // First invocation already flipped the match to 'notified' in the prior test; this run must short-circuit.
    await handle(fakeJob({ tenantId, matchId }));
    expect(sendSpy).not.toHaveBeenCalled();
    // State unchanged.
    expect((await readMatch(matchId)).status).toBe('notified');
    expect((await readWishlist(wishlistId)).status).toBe('notified');
  });

  it('is a no-op (no send, no throw) when the match does not exist', async () => {
    await expect(handle(fakeJob({ tenantId, matchId: 999_999 }))).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
