import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';

/**
 * Regression guard for the `acquireOne` extraction (Task 6): `performAnkauf` must keep behaving
 * EXACTLY as it did before the refactor — hash-dedup on `records`, always-new `purchases`, and
 * (new invariant) `collection_id IS NULL` for every purchase created via the single-Ankauf path.
 * Written BEFORE the refactor to capture current behavior; must stay green after it.
 */
let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
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
  vi.resetModules();
  ({ performAnkauf } = await import('@/lib/ankauf'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  tenantA = (await seedTenant({ slug: 'acquire-demo', name: 'Acquire Demo' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});
const ctx = () => ({ tenantId: tenantA, userId: null });

describe('performAnkauf (regression via acquireOne)', () => {
  it('two identical Ankauf calls → 1 record (hash-dedup), 2 purchases, both collection_id IS NULL', async () => {
    const input = {
      release,
      purchasePrice: '3.00',
      targetPrice: '22.50',
      conditionRecord: 5,
      conditionCover: 4,
      listOnDiscogs: false,
    };
    const first = await performAnkauf(ctx(), input);
    const second = await performAnkauf(ctx(), input);
    expect(first.recordId).toBe(second.recordId);
    expect(first.purchaseId).not.toBe(second.purchaseId);

    const recs = await withTenant(ctx(), async (tx) =>
      tx.select().from(schema.records).where((await import('drizzle-orm')).eq(schema.records.id, first.recordId)),
    );
    expect(recs).toHaveLength(1);

    const purs = await withTenant(ctx(), async (tx) =>
      tx
        .select()
        .from(schema.purchases)
        .where(
          (await import('drizzle-orm')).inArray(schema.purchases.id, [first.purchaseId, second.purchaseId]),
        ),
    );
    expect(purs).toHaveLength(2);
    for (const p of purs) {
      expect(p.recordId).toBe(first.recordId);
      expect(p.collectionId).toBeNull();
    }
  });
});

/**
 * Review fix (Task 7 CRITICAL): a manually-entered release (no Discogs match) must persist
 * `discogs_id IS NULL` — never a synthetic sentinel — and the `acquireOne` upsert must never let
 * a null discogsId/coverImage on a re-acquisition clobber real values already on the matched
 * record (COALESCE-on-conflict). See src/lib/ankauf.ts.
 */
describe('acquireOne — nullable discogsId + preserve-on-null upsert', () => {
  it('release.discogsId === null (manual entry) → the created record has discogs_id IS NULL', async () => {
    const manualRelease = {
      discogsId: null,
      title: 'Bedroom Tapes',
      artist: 'DIY Artist',
      country: null,
      year: null,
      format: null,
      genre: [],
      label: [],
      coverImage: null,
    };
    const input = {
      release: manualRelease,
      purchasePrice: '2.00',
      targetPrice: '10.00',
      conditionRecord: 3,
      conditionCover: 3,
      listOnDiscogs: false,
    };
    const { recordId } = await performAnkauf(ctx(), input);
    const eq = (await import('drizzle-orm')).eq;
    const [rec] = await withTenant(ctx(), async (tx) =>
      tx.select().from(schema.records).where(eq(schema.records.id, recordId)),
    );
    expect(rec!.discogsId).toBeNull();
  });

  it('preserve-on-null then refresh: a real discogsId survives a null re-acquisition, then a new real discogsId overwrites it', async () => {
    const eq = (await import('drizzle-orm')).eq;
    const base = {
      title: 'Test Preserve Album',
      artist: 'Preserve Artist',
      country: 'DE',
      year: 2001,
      format: 'Vinyl',
      genre: ['Rock'],
      label: ['Preserve Label'],
    };
    const inputFor = (discogsId: number | null, coverImage: string | null) => ({
      release: { ...base, discogsId, coverImage },
      purchasePrice: '5.00',
      targetPrice: '20.00',
      conditionRecord: 4,
      conditionCover: 4,
      listOnDiscogs: false,
    });
    const readRecord = async (recordId: number) => {
      const [rec] = await withTenant(ctx(), async (tx) =>
        tx.select().from(schema.records).where(eq(schema.records.id, recordId)),
      );
      return rec!;
    };

    // 1. Real discogsId + coverImage.
    const first = await performAnkauf(ctx(), inputFor(42, 'https://i.discogs.com/cover42.jpg'));
    let rec = await readRecord(first.recordId);
    expect(rec.discogsId).toBe(42);
    expect(rec.coverImage).toBe('https://i.discogs.com/cover42.jpg');

    // 2. Same hash, manual-entry-shaped re-acquisition (discogsId/coverImage null): must NOT
    //    clobber the real values already on the record. This is the CRITICAL fix under test —
    //    against the pre-fix always-overwrite `onConflictDoUpdate`, this fails: the record would
    //    come back with discogs_id === null and cover_image === null.
    const second = await performAnkauf(ctx(), inputFor(null, null));
    expect(second.recordId).toBe(first.recordId);
    rec = await readRecord(first.recordId);
    expect(rec.discogsId).toBe(42);
    expect(rec.coverImage).toBe('https://i.discogs.com/cover42.jpg');

    // 3. Same hash, a DIFFERENT real discogsId: refresh semantics still work — the new real
    //    value wins (this is what makes re-running a Discogs Ankauf on the same release useful).
    const third = await performAnkauf(ctx(), inputFor(43, 'https://i.discogs.com/cover43.jpg'));
    expect(third.recordId).toBe(first.recordId);
    rec = await readRecord(first.recordId);
    expect(rec.discogsId).toBe(43);
    expect(rec.coverImage).toBe('https://i.discogs.com/cover43.jpg');
  });
});
