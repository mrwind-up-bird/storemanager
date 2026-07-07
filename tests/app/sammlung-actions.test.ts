// tests/app/sammlung-actions.test.ts
// Fast unit test (no DB): the C2 gates (kunde/origin/validation) all short-circuit before
// createCollectionAction ever touches @/lib/collections, so every dependency is mocked out —
// mirrors the mock shape of tests/app/kasse-actions.integration.test.ts (session/origin toggles)
// but skips setupTestDatabase entirely.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

let actions: typeof import('@/app/(app)/ankauf/sammlung/actions');

let sessionRole: 'admin' | 'kunde' = 'admin';
let badOrigin = false;

const createCollection = vi.fn(async () => ({
  collectionId: 1,
  purchaseIds: [10, 11],
  recordIds: [20, 21],
}));
const enqueueWishlistMatch = vi.fn(async () => undefined);
const enqueueDiscogsListing = vi.fn(async () => undefined);
const enqueueEmbeddingRefresh = vi.fn(async () => undefined);

// Slice 6 T12: the action now loads getEntitlements(user.tenantId) before createCollection —
// mocked out here (no DB in this fast unit test) so the discogsListing-feature-gated fixture
// below (listOnDiscogs: true) still reaches createCollection instead of short-circuiting.
class LimitExceededError extends Error {
  constructor(
    message: string,
    public readonly current: number,
    public readonly max: number,
  ) {
    super(message);
    this.name = 'LimitExceededError';
  }
}
const getEntitlements = vi.fn(async () => ({
  plan: 'big',
  planName: 'Big',
  priceMonthlyCents: 4900,
  limits: { maxRecords: null, maxUsers: null },
  features: { analytik: true, discogsListing: true },
}));

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

function item(overrides: Record<string, unknown> = {}) {
  return {
    release,
    purchasePrice: '3.00',
    targetPrice: '20.00',
    conditionRecord: 5,
    conditionCover: 4,
    listOnDiscogs: false,
    ...overrides,
  };
}

beforeAll(async () => {
  // The action imports '@/lib/csrf' (real, for the bad-origin case), which loads '@/env' —
  // envSchema.parse(process.env) runs at module-eval time and needs every required key present.
  // '@/lib/collections' and '@/lib/jobs' are mocked below, so no real DB/queue is ever touched;
  // these are just stub values to satisfy the schema (mirrors tests/helpers/db.ts's fallbacks).
  process.env.ROOT_DOMAIN ??= 'localhost';
  process.env.DATABASE_URL ??= 'postgresql://qr_app:x@localhost:5432/qrdb_test_stub';
  process.env.DATABASE_OWNER_URL ??= 'postgresql://qr_owner:x@localhost:5432/qrdb_test_stub';
  process.env.PGBOSS_DATABASE_URL ??= 'postgresql://qr_owner:x@localhost:5432/qrdb_test_stub';
  process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-0';
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  process.env.ENCRYPTION_KEY_ID ??= 'v1';
  process.env.MAIL_DRIVER ??= 'console';
  process.env.MAIL_HOST ??= 'localhost';
  process.env.MAIL_PORT ??= '1025';
  process.env.MAIL_FROM ??= 'test@qrecords.test';
  process.env.DISCOGS_CONSUMER_KEY ??= 'test-key';
  process.env.DISCOGS_CONSUMER_SECRET ??= 'test-secret';

  vi.doMock('@/auth/session', () => ({
    requireSession: async () => ({
      id: 1,
      email: 'staff@demo',
      tenantId: 7,
      role: sessionRole,
      isSuperadmin: false,
    }),
  }));
  vi.doMock('next/headers', () => ({
    headers: async () =>
      new Headers(badOrigin ? { origin: 'http://evil.example', host: 'localhost:3000' } : {}),
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
  vi.doMock('@/lib/collections', () => ({ createCollection }));
  vi.doMock('@/lib/jobs', () => ({ enqueueWishlistMatch, enqueueDiscogsListing, enqueueEmbeddingRefresh }));
  vi.doMock('@/lib/gating', () => ({ getEntitlements, LimitExceededError }));
  vi.resetModules();
  actions = await import('@/app/(app)/ankauf/sammlung/actions');
});

afterEach(() => {
  sessionRole = 'admin';
  badOrigin = false;
  createCollection.mockClear();
  enqueueWishlistMatch.mockClear();
  enqueueDiscogsListing.mockClear();
  enqueueEmbeddingRefresh.mockClear();
});

describe('createCollectionAction', () => {
  it('kunde role is forbidden', async () => {
    sessionRole = 'kunde';
    await expect(
      actions.createCollectionAction({ sellerName: 'Max', items: [item()] }),
    ).rejects.toThrow('FORBIDDEN');
    expect(createCollection).not.toHaveBeenCalled();
  });

  it('bad origin -> {ok:false, reason:"error"}, never reaches createCollection', async () => {
    badOrigin = true;
    const r = await actions.createCollectionAction({ sellerName: 'Max', items: [item()] });
    expect(r).toEqual({ ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' });
    expect(createCollection).not.toHaveBeenCalled();
  });

  it('empty items array -> {ok:false, reason:"validation"}', async () => {
    const r = await actions.createCollectionAction({ sellerName: 'Max', items: [] });
    expect(r).toMatchObject({ ok: false, reason: 'validation' });
    expect(createCollection).not.toHaveBeenCalled();
  });

  it('valid 2-item input -> ok, enqueues wishlist match per item + discogs listing only for flagged items', async () => {
    const r = await actions.createCollectionAction({
      sellerName: 'Max Mustermann',
      sellerContact: '0176 12345',
      items: [item({ listOnDiscogs: true }), item({ purchasePrice: '4.00' })],
    });
    expect(r).toEqual({ ok: true, collectionId: 1, count: 2 });
    expect(createCollection).toHaveBeenCalledTimes(1);

    // Post-commit enqueue: one wishlist-match call per purchase/record pair, 3-arg shape.
    expect(enqueueWishlistMatch).toHaveBeenCalledTimes(2);
    expect(enqueueWishlistMatch).toHaveBeenNthCalledWith(1, { tenantId: 7, purchaseId: 10, recordId: 20 });
    expect(enqueueWishlistMatch).toHaveBeenNthCalledWith(2, { tenantId: 7, purchaseId: 11, recordId: 21 });

    // Only the first item had listOnDiscogs=true -> exactly one listing enqueue, paired by index.
    expect(enqueueDiscogsListing).toHaveBeenCalledTimes(1);
    expect(enqueueDiscogsListing).toHaveBeenCalledWith({ tenantId: 7, purchaseId: 10 });
  });

  it('createCollection throws LimitExceededError -> {ok:false, reason:"validation", message} (C8 action boundary)', async () => {
    const message = 'Plan-Limit erreicht: max. 100 Platten im Free-Plan. Upgrade unter Einstellungen → Abo.';
    createCollection.mockRejectedValueOnce(new LimitExceededError(message, 100, 100));

    const r = await actions.createCollectionAction({ sellerName: 'Max', items: [item()] });

    // Must map to reason:'validation' (a form error, not the generic reason:'error' fallback) so
    // the client renders the exact plan-limit copy — this is the contract the T12 review flagged
    // as untested.
    expect(r).toEqual({ ok: false, reason: 'validation', message });
  });
});
