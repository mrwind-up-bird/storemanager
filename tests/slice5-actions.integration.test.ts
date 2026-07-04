import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

vi.mock('@/lib/jobs', () => ({
  enqueueDiscogsListing: vi.fn(async () => undefined),
  enqueueWishlistMatch: vi.fn(async () => undefined),
}));

type MockUser = {
  id: number; email: string; tenantId: number;
  role: 'admin' | 'mitarbeiter' | 'kunde' | 'superadmin'; isSuperadmin: boolean;
};

let kasseActions: typeof import('@/app/(app)/kasse/actions');
let ankaufActions: typeof import('@/app/(app)/ankauf/actions');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;
let currentUser: MockUser;

const asAdmin = (tenantId: number): MockUser => ({
  id: 1, email: 'a@test', tenantId, role: 'admin', isSuperadmin: false,
});

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  process.env.DISCOGS_DRIVER = 'fake';
  vi.doMock('@/auth/session', () => ({
    requireSession: async () => currentUser,
  }));
  vi.doMock('next/headers', () => ({
    headers: async () => new Headers(),
    cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.resetModules();

  ({ tenantId: tenantA } = await seedTenant({ slug: 'test-a', name: 'Test A' }));
  ({ tenantId: tenantB } = await seedTenant({ slug: 'test-b', name: 'Test B' }));
  currentUser = asAdmin(tenantA);

  kasseActions = await import('@/app/(app)/kasse/actions');
  ankaufActions = await import('@/app/(app)/ankauf/actions');

  // Fixture: Tenant A bekommt 2 verfügbare + 1 verkauftes Exemplar von Release 11111
  // sowie eine Discogs-Fake-Connection für die Barcode-Suche.
  const { performAnkauf } = await import('@/lib/ankauf');
  const { upsertConnection } = await import('@/lib/discogs-connection');
  const { withTenant } = await import('@/db/tenant');
  const { purchases } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  await upsertConnection(
    { tenantId: tenantA, userId: null },
    { discogsUsername: 'a', auth: { token: 't', tokenSecret: 's' }, connectedByUserId: null },
  );

  const release = {
    discogsId: 11111, title: 'Kind of Blue', artist: 'Miles Davis', country: 'US',
    year: 1959, format: 'Vinyl', genre: ['Jazz'], label: ['Columbia'], coverImage: null,
  };
  const base = {
    release, purchasePrice: '3', targetPrice: '22.50',
    conditionRecord: 5, conditionCover: 4, listOnDiscogs: false,
  };
  const ctxA = { tenantId: tenantA, userId: null };
  await performAnkauf(ctxA, base);
  await performAnkauf(ctxA, base);
  const { purchaseId: soldId } = await performAnkauf(ctxA, base);
  await withTenant(ctxA, (tx) =>
    tx.update(purchases).set({ status: 'verkauft' }).where(eq(purchases.id, soldId)),
  );
}, 120_000);

afterAll(async () => {
  await teardown?.();
});

describe('findAvailableCopiesByRelease (Action, C6/C7)', () => {
  it('liefert nur verfuegbare Exemplare des Releases, ohne EK-Preis', async () => {
    currentUser = asAdmin(tenantA);
    const res = await kasseActions.findAvailableCopiesByRelease(11111);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.copies).toHaveLength(2); // das verkaufte Exemplar fehlt
    for (const c of res.copies) {
      expect(c.title).toBe('Kind of Blue');
      expect(c.targetPrice).toBe('22.50');
      expect('purchasePrice' in c).toBe(false); // EK bleibt server-intern
      expect('ek' in c).toBe(false);
    }
  });

  it('RLS/Isolation: Tenant B sieht 0 Exemplare', async () => {
    currentUser = asAdmin(tenantB);
    const res = await kasseActions.findAvailableCopiesByRelease(11111);
    expect(res).toEqual({ ok: true, copies: [] });
  });

  it('validation: releaseId 0 → validation', async () => {
    currentUser = asAdmin(tenantA);
    expect(await kasseActions.findAvailableCopiesByRelease(0)).toEqual({
      ok: false, reason: 'validation',
    });
  });

  it('kunde → forbidden() wirft', async () => {
    currentUser = { ...asAdmin(tenantA), role: 'kunde' };
    await expect(kasseActions.findAvailableCopiesByRelease(11111)).rejects.toThrow();
  });
});

describe('searchAvailableCopies (Action, C6)', () => {
  it('findet per Substring, max. 8, nur verfuegbar', async () => {
    currentUser = asAdmin(tenantA);
    const res = await kasseActions.searchAvailableCopies('kind of');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.copies.length).toBe(2);
    expect(res.copies[0]!.artist).toBe('Miles Davis');
  });

  it('leerer Query → validation', async () => {
    currentUser = asAdmin(tenantA);
    expect(await kasseActions.searchAvailableCopies('   ')).toEqual({
      ok: false, reason: 'validation',
    });
  });
});

describe('searchDiscogsByBarcode (Action, C6)', () => {
  it('FAKE_BARCODE_HIT → 2 Treffer über den Fake-Treiber', async () => {
    currentUser = asAdmin(tenantA);
    const { FAKE_BARCODE_HIT } = await import('@/lib/discogs/fake');
    const res = await ankaufActions.searchDiscogsByBarcode(FAKE_BARCODE_HIT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.results.map((r) => r.discogsId)).toEqual([11111, 22222]);
  });

  it('ungültiger Barcode (Buchstaben / 7 / 15 Ziffern) → validation', async () => {
    currentUser = asAdmin(tenantA);
    for (const bad of ['abcdefgh', '1234567', '123456789012345']) {
      expect(await ankaufActions.searchDiscogsByBarcode(bad)).toEqual({
        ok: false, reason: 'validation',
      });
    }
  });

  it('ohne Connection → not_connected (Tenant B hat keine)', async () => {
    currentUser = asAdmin(tenantB);
    expect(await ankaufActions.searchDiscogsByBarcode('12345678')).toEqual({
      ok: false, reason: 'not_connected',
    });
  });

  it('kunde → forbidden() wirft (Spec §11.2)', async () => {
    currentUser = { ...asAdmin(tenantA), role: 'kunde' };
    await expect(ankaufActions.searchDiscogsByBarcode('12345678')).rejects.toThrow();
  });
});
