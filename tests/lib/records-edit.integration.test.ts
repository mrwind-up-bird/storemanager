import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let getRecordDetail: (typeof import('@/lib/records'))['getRecordDetail'];
let updateRecord: (typeof import('@/lib/records'))['updateRecord'];
let RecordHashConflictError: (typeof import('@/lib/records'))['RecordHashConflictError'];
let updatePurchase: (typeof import('@/lib/copies'))['updatePurchase'];
let addCopy: (typeof import('@/lib/copies'))['addCopy'];
let duplicateCopy: (typeof import('@/lib/copies'))['duplicateCopy'];
let deleteCopy: (typeof import('@/lib/copies'))['deleteCopy'];
let CopyEditError: (typeof import('@/lib/copies'))['CopyEditError'];
let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let UNLIMITED_ENTITLEMENTS: (typeof import('@/lib/gating'))['UNLIMITED_ENTITLEMENTS'];
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;

const baseRelease = {
  discogsId: 11,
  title: 'The Best Of…',
  artist: 'Uriah Heep',
  country: 'DE',
  year: 1978,
  format: 'Vinyl',
  genre: ['Rock'],
  label: ['Bronze'],
  coverImage: 'https://img.example/cover.jpg',
};

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  ({ getRecordDetail, updateRecord, RecordHashConflictError } = await import('@/lib/records'));
  ({ updatePurchase, addCopy, duplicateCopy, deleteCopy, CopyEditError } = await import('@/lib/copies'));
  ({ performAnkauf } = await import('@/lib/ankauf'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  ({ UNLIMITED_ENTITLEMENTS } = await import('@/lib/gating'));
  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});

const ctx = () => ({ tenantId: tenantA, userId: null });

async function acquire(overrides: Partial<typeof baseRelease> = {}, ek = '3.00', vk = '10.00') {
  return performAnkauf(
    ctx(),
    {
      release: { ...baseRelease, ...overrides },
      purchasePrice: ek,
      targetPrice: vk,
      conditionRecord: 5,
      conditionCover: 4,
      listOnDiscogs: false,
    },
    UNLIMITED_ENTITLEMENTS,
  );
}

async function markSold(purchaseId: number, soldPrice = '20.00') {
  await withTenant(ctx(), async (tx) => {
    await tx
      .update(schema.purchases)
      .set({ status: 'verkauft', soldPrice, soldDate: new Date() })
      .where(eq(schema.purchases.id, purchaseId));
  });
}

describe('getRecordDetail', () => {
  it('rolls up a record + all its physical copies with stats', async () => {
    const first = await acquire({ title: 'Detail Album' }, '3.00', '10.00');
    await acquire({ title: 'Detail Album' }, '4.00', '12.00'); // 2nd copy → same record (dedup)

    const detail = await getRecordDetail(ctx(), first.recordId);
    expect(detail).not.toBeNull();
    expect(detail!.copies).toHaveLength(2);
    expect(detail!.stats.total).toBe(2);
    expect(detail!.stats.available).toBe(2);
    // stock value = Σ target of available copies = 10.00 + 12.00 = 22.00 € = 2200 cents
    expect(detail!.stats.stockValueCents).toBe(2200);
    expect(detail!.coverImage).toBe(baseRelease.coverImage);
  });

  it('returns null for a foreign / missing record id', async () => {
    expect(await getRecordDetail(ctx(), 999_999)).toBeNull();
  });
});

describe('updateRecord', () => {
  it('replaces metadata + classification (genres/styles/tags/notes)', async () => {
    const { recordId } = await acquire({ title: 'Editable' });
    await updateRecord(ctx(), recordId, {
      title: 'Editable (Remaster)',
      artist: 'Uriah Heep',
      label: ['Bronze', 'Sanctuary'],
      country: 'UK',
      releaseYear: 1979,
      format: 'CD',
      genre: ['Rock'],
      styles: ['Prog Rock', 'Hard Rock'],
      tags: ['reissue', 'shelf-A'],
      notes: 'Runouts are stamped.',
    });

    const detail = await getRecordDetail(ctx(), recordId);
    expect(detail!.title).toBe('Editable (Remaster)');
    expect(detail!.format).toBe('CD');
    expect(detail!.country).toBe('UK');
    expect(detail!.styles).toEqual(['Prog Rock', 'Hard Rock']);
    expect(detail!.tags).toEqual(['reissue', 'shelf-A']);
    expect(detail!.notes).toBe('Runouts are stamped.');
  });

  it('throws RecordHashConflictError when the new identity collides with another record', async () => {
    await acquire({ title: 'Conflict Beta', discogsId: 21 });
    const a = await acquire({ title: 'Conflict Alpha', discogsId: 22 });

    const err = await updateRecord(ctx(), a.recordId, {
      title: 'Conflict Beta', // now identical identity → hash collides with the Beta record
      artist: baseRelease.artist,
      label: baseRelease.label,
      country: baseRelease.country,
      releaseYear: baseRelease.year,
      format: baseRelease.format,
      genre: [],
      styles: [],
      tags: [],
      notes: null,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(RecordHashConflictError);
  });
});

describe('updatePurchase', () => {
  it('patches EK/VK/condition/status of a copy', async () => {
    const { purchaseId } = await acquire({ title: 'Patchable', discogsId: 31 });
    await updatePurchase(ctx(), purchaseId, {
      purchasePrice: '5.50',
      targetPrice: '18.00',
      conditionRecord: 6,
      conditionCover: 6,
      status: 'reserviert',
      notes: 'kleiner Kratzer',
    });
    const [row] = await withTenant(ctx(), async (tx) =>
      tx.select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId)),
    );
    expect(row!.status).toBe('reserviert');
    expect(row!.purchasePrice).toBe('5.50');
    expect(row!.targetPrice).toBe('18.00');
    expect(row!.conditionRecord).toBe(6);
    expect(row!.notes).toBe('kleiner Kratzer');
  });

  it('refuses to edit a sold copy (sold_immutable)', async () => {
    const { purchaseId } = await acquire({ title: 'Sold One', discogsId: 32 });
    await markSold(purchaseId);
    const err = await updatePurchase(ctx(), purchaseId, { status: 'verfuegbar' }).catch((e) => e);
    expect(err).toBeInstanceOf(CopyEditError);
    expect((err as InstanceType<typeof CopyEditError>).reason).toBe('sold_immutable');
  });

  it('throws not_found for a foreign / missing copy', async () => {
    const err = await updatePurchase(ctx(), 999_999, { status: 'verfuegbar' }).catch((e) => e);
    expect(err).toBeInstanceOf(CopyEditError);
    expect((err as InstanceType<typeof CopyEditError>).reason).toBe('not_found');
  });
});

describe('addCopy / duplicateCopy / deleteCopy', () => {
  it('addCopy adds a fresh verfuegbar copy to an existing record', async () => {
    const { recordId } = await acquire({ title: 'Multi', discogsId: 41 });
    await addCopy(ctx(), recordId, {
      purchasePrice: '2.00',
      targetPrice: '9.00',
      conditionRecord: 5,
      conditionCover: 5,
    });
    const detail = await getRecordDetail(ctx(), recordId);
    expect(detail!.stats.total).toBe(2);
    expect(detail!.stats.available).toBe(2);
  });

  it('duplicateCopy clones a copy back into stock', async () => {
    const { recordId, purchaseId } = await acquire({ title: 'Dupe', discogsId: 42 }, '7.00', '21.00');
    const { purchaseId: clone } = await duplicateCopy(ctx(), purchaseId);
    expect(clone).not.toBe(purchaseId);
    const detail = await getRecordDetail(ctx(), recordId);
    expect(detail!.stats.total).toBe(2);
    const cloned = detail!.copies.find((c) => c.purchaseId === clone)!;
    expect(cloned.status).toBe('verfuegbar');
    expect(cloned.purchasePriceCents).toBe(700);
    expect(cloned.targetPriceCents).toBe(2100);
  });

  it('deleteCopy removes an unsold copy but refuses a sold one', async () => {
    const { recordId, purchaseId } = await acquire({ title: 'Deletable', discogsId: 43 });
    const extra = await addCopy(ctx(), recordId, {
      purchasePrice: '1.00',
      targetPrice: '5.00',
      conditionRecord: 5,
      conditionCover: 5,
    });

    await deleteCopy(ctx(), extra.purchaseId);
    let detail = await getRecordDetail(ctx(), recordId);
    expect(detail!.stats.total).toBe(1);

    await markSold(purchaseId);
    const err = await deleteCopy(ctx(), purchaseId).catch((e) => e);
    expect(err).toBeInstanceOf(CopyEditError);
    expect((err as InstanceType<typeof CopyEditError>).reason).toBe('sold_immutable');
    detail = await getRecordDetail(ctx(), recordId);
    expect(detail!.stats.total).toBe(1); // sold copy still present
  });
});
