// tests/app/ankauf-embedding-hook.test.ts
// T6: post-commit embeddingRefresh-Hook — fast unit tests (no DB), mirrors the mock shape of
// tests/app/sammlung-actions.test.ts. Every dependency of both action files is mocked so the
// enqueue call itself (not the underlying purchase/collection logic, already covered by
// tests/ankauf-actions.integration.test.ts and tests/app/sammlung-actions.test.ts) is what's
// under test here.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

let ankaufActions: typeof import('@/app/(app)/ankauf/actions');
let sammlungActions: typeof import('@/app/(app)/ankauf/sammlung/actions');

const tenantId = 7;

const performAnkauf = vi.fn(async () => ({ recordId: 42, purchaseId: 7 }));
const createCollection = vi.fn(async () => ({
  collectionId: 1,
  purchaseIds: [10, 11, 12],
  recordIds: [5, 5, 8],
}));

const enqueueEmbeddingRefresh = vi.fn(async () => undefined);
const enqueueWishlistMatch = vi.fn(async () => undefined);
const enqueueDiscogsListing = vi.fn(async () => undefined);

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
  vi.doMock('@/auth/session', () => ({
    requireSession: async () => ({
      id: 1,
      email: 'staff@demo',
      tenantId,
      role: 'admin',
      isSuperadmin: false,
    }),
  }));
  vi.doMock('@/lib/csrf', () => ({ isValidOrigin: async () => true }));
  vi.doMock('@/lib/discogs-connection', () => ({
    getConnection: async () => ({
      discogsUsername: 'demo',
      auth: { token: 't', tokenSecret: 's' },
      connectedByUserId: 1,
    }),
    deleteConnection: async () => undefined,
  }));
  vi.doMock('@/lib/discogs', () => ({ getDiscogsAdapter: () => ({}) }));
  vi.doMock('@/lib/ankauf', () => ({ performAnkauf }));
  vi.doMock('@/lib/collections', () => ({ createCollection }));
  vi.doMock('@/lib/jobs', () => ({
    enqueueEmbeddingRefresh,
    enqueueWishlistMatch,
    enqueueDiscogsListing,
  }));
  vi.doMock('@/lib/gating', () => ({ getEntitlements, LimitExceededError }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.doMock('next/navigation', () => ({
    forbidden: () => {
      throw new Error('FORBIDDEN');
    },
  }));
  vi.resetModules();
  ankaufActions = await import('@/app/(app)/ankauf/actions');
  sammlungActions = await import('@/app/(app)/ankauf/sammlung/actions');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Ankauf → embeddingRefresh-Hook', () => {
  it('Einzel-Ankauf reiht genau einen Refresh für den recordId ein (post-commit)', async () => {
    performAnkauf.mockResolvedValueOnce({ recordId: 42, purchaseId: 7 });

    const r = await ankaufActions.ankaufRecord({
      release,
      purchasePrice: '3.00',
      targetPrice: '22.50',
      conditionRecord: 5,
      conditionCover: 4,
      listOnDiscogs: false,
    });

    expect(r).toMatchObject({ ok: true, recordId: 42, purchaseId: 7 });
    expect(enqueueEmbeddingRefresh).toHaveBeenCalledTimes(1);
    expect(enqueueEmbeddingRefresh).toHaveBeenCalledWith({ tenantId, recordId: 42 });
  });

  it('Batch/Sammlung dedupliziert recordIds (ein Refresh je distinktem Record)', async () => {
    createCollection.mockResolvedValueOnce({
      collectionId: 1,
      purchaseIds: [10, 11, 12],
      recordIds: [5, 5, 8],
    });

    const r = await sammlungActions.createCollectionAction({
      sellerName: 'Max Mustermann',
      items: [item(), item(), item()],
    });

    expect(r).toEqual({ ok: true, collectionId: 1, count: 3 });
    // recordIds [5, 5, 8] -> exactly 2 distinct refreshes, not 3.
    expect(enqueueEmbeddingRefresh).toHaveBeenCalledTimes(2);
    expect(enqueueEmbeddingRefresh).toHaveBeenCalledWith({ tenantId, recordId: 5 });
    expect(enqueueEmbeddingRefresh).toHaveBeenCalledWith({ tenantId, recordId: 8 });
  });
});
