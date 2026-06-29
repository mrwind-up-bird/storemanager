import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

// Bound AFTER setupTestDatabase publishes env (see the harness ordering contract in tests/helpers/db.ts).
// Never import @/db/* or @/lib/* statically — those modules eval @/env at load time, which would read
// DATABASE_URL before testcontainers has written the actual connection string.
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let records: (typeof import('@/db/schema'))['records'];
let purchases: (typeof import('@/db/schema'))['purchases'];
let listInventory: (typeof import('@/lib/inventory'))['listInventory'];
let inventoryAggregates: (typeof import('@/lib/inventory'))['inventoryAggregates'];
let parseInventoryFilters: (typeof import('@/lib/inventory'))['parseInventoryFilters'];

let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;

async function insertRecord(
  tenantId: number,
  data: {
    title: string;
    artist: string;
    label: string[];
    format: string;
    genre: string[];
    releaseYear: number;
    country: string;
    hash: string;
  },
): Promise<number> {
  return withOwner(async (tx) => {
    const [row] = await tx
      .insert(records)
      .values({ tenantId, ...data })
      .returning({ id: records.id });
    return row.id;
  });
}

async function insertPurchase(
  tenantId: number,
  recordId: number,
  data: {
    status: 'verfuegbar' | 'reserviert' | 'verkauft' | 'verliehen';
    conditionRecord: number;
    conditionCover: number;
    ek: string;
    vk: string;
    soldPrice?: string;
    soldDate?: Date;
  },
): Promise<void> {
  await withOwner((tx) =>
    tx.insert(purchases).values({
      tenantId,
      recordId,
      status: data.status,
      conditionRecord: data.conditionRecord,
      conditionCover: data.conditionCover,
      purchasePrice: data.ek,
      targetPrice: data.vk,
      soldPrice: data.soldPrice,
      soldDate: data.soldDate,
    }),
  );
}

beforeAll(async () => {
  const testDb = await setupTestDatabase();
  teardown = testDb.teardown;
  process.env.DATABASE_URL = testDb.appUrl;
  process.env.DATABASE_OWNER_URL = testDb.ownerUrl;

  vi.resetModules();
  ({ withOwner } = await import('@/db/tenant'));
  ({ records, purchases } = await import('@/db/schema'));
  ({ listInventory, inventoryAggregates, parseInventoryFilters } = await import('@/lib/inventory'));

  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo Store' })).tenantId;
  tenantB = (await seedTenant({ slug: 'other', name: 'Other Store' })).tenantId;

  // ── Tenant A: 3 records, 5 copies (deterministic) ──────────────────────────
  const a1 = await insertRecord(tenantA, {
    title: 'Kind of Blue', artist: 'Miles Davis', label: ['Columbia'],
    format: 'Vinyl', genre: ['Jazz'], releaseYear: 1959, country: 'US', hash: 'a1',
  });
  const a2 = await insertRecord(tenantA, {
    title: 'Discovery', artist: 'Daft Punk', label: ['Virgin'],
    format: 'CD', genre: ['Electronic'], releaseYear: 2001, country: 'FR', hash: 'a2',
  });
  const a3 = await insertRecord(tenantA, {
    title: 'Remain in Light', artist: 'Talking Heads', label: ['Sire'],
    format: 'Vinyl', genre: ['Rock'], releaseYear: 1980, country: 'US', hash: 'a3',
  });

  // a1: verfuegbar(NM,7,vk30) + verkauft(NM,6,vk25)
  await insertPurchase(tenantA, a1, { status: 'verfuegbar', conditionRecord: 7, conditionCover: 7, ek: '10.00', vk: '30.00' });
  await insertPurchase(tenantA, a1, { status: 'verkauft', conditionRecord: 6, conditionCover: 6, ek: '8.00', vk: '25.00', soldPrice: '24.00', soldDate: new Date('2026-01-15T00:00:00Z') });
  // a2: verfuegbar(VG+,5,vk15)
  await insertPurchase(tenantA, a2, { status: 'verfuegbar', conditionRecord: 5, conditionCover: 5, ek: '5.00', vk: '15.00' });
  // a3: verliehen(VG,4,vk20) + verfuegbar(G+,3,vk18)
  await insertPurchase(tenantA, a3, { status: 'verliehen', conditionRecord: 4, conditionCover: 4, ek: '12.00', vk: '20.00' });
  await insertPurchase(tenantA, a3, { status: 'verfuegbar', conditionRecord: 3, conditionCover: 3, ek: '6.00', vk: '18.00' });

  // ── Tenant B: 1 record, 1 copy (isolation probe) ───────────────────────────
  const b1 = await insertRecord(tenantB, {
    title: 'Blue Train', artist: 'John Coltrane', label: ['Blue Note'],
    format: 'Vinyl', genre: ['Jazz'], releaseYear: 1957, country: 'US', hash: 'b1',
  });
  await insertPurchase(tenantB, b1, { status: 'verfuegbar', conditionRecord: 7, conditionCover: 7, ek: '20.00', vk: '50.00' });
}, 180_000);

afterAll(async () => {
  await teardown?.();
});

describe('listInventory — RLS isolation', () => {
  it('returns only tenant A copies and never tenant B copies', async () => {
    const rows = await listInventory({ tenantId: tenantA, userId: null }, {});
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.title !== 'Blue Train')).toBe(true);
  });

  it('interleaved — tenant B sees only its own copy', async () => {
    const rows = await listInventory({ tenantId: tenantB, userId: null }, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Blue Train');
    expect(rows[0].ek).toBe('20.00');
    expect(rows[0].vk).toBe('50.00');
  });
});

describe('listInventory — search + filters', () => {
  it('q matches title/artist/label, case-insensitive', async () => {
    expect(await listInventory({ tenantId: tenantA, userId: null }, { q: 'MILES' })).toHaveLength(2); // artist
    expect(await listInventory({ tenantId: tenantA, userId: null }, { q: 'columbia' })).toHaveLength(2); // label
    expect(await listInventory({ tenantId: tenantA, userId: null }, { q: 'discovery' })).toHaveLength(1); // title
  });

  it('format / genre / condition-band filters select the right subset', async () => {
    expect(await listInventory({ tenantId: tenantA, userId: null }, { format: 'Vinyl' })).toHaveLength(4); // a1(2)+a3(2)
    expect(await listInventory({ tenantId: tenantA, userId: null }, { genre: 'Jazz' })).toHaveLength(2); // a1
    expect(await listInventory({ tenantId: tenantA, userId: null }, { condition: 'mint_nm' })).toHaveLength(2); // cond>=6: 7,6
    expect(await listInventory({ tenantId: tenantA, userId: null }, { condition: 'vg' })).toHaveLength(4); // cond>=4: 7,6,5,4
  });

  it('status filter selects exactly that status', async () => {
    const rows = await listInventory({ tenantId: tenantA, userId: null }, { status: 'verkauft' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('verkauft');
    expect(rows[0].title).toBe('Kind of Blue');
  });

  it('ek/vk are numeric→string and ordered by artist then title', async () => {
    const rows = await listInventory({ tenantId: tenantA, userId: null }, {});
    const artists = rows.map((r) => r.artist);
    expect(artists).toEqual([...artists].sort()); // asc(artist)
    const a1c1 = rows.find((r) => r.title === 'Kind of Blue' && r.status === 'verfuegbar');
    expect(a1c1?.ek).toBe('10.00');
    expect(a1c1?.vk).toBe('30.00');
    expect(a1c1?.conditionRecord).toBe(7);
  });
});

describe('inventoryAggregates — status tab is IGNORED in counts/value', () => {
  it('no filters: byStatus/total/valueAvailable/formatSplit/genreOptions match the seed', async () => {
    const agg = await inventoryAggregates({ tenantId: tenantA, userId: null }, {});
    expect(agg.total).toBe(5);
    expect(agg.byStatus).toEqual({ verfuegbar: 3, reserviert: 0, verkauft: 1, verliehen: 1 });
    expect(agg.valueAvailable).toBe(63); // 30 + 15 + 18 (verfuegbar vk only)
    expect(agg.formatSplit).toEqual({ vinyl: 2, cd: 1, other: 0 }); // verfuegbar copies by format
    expect(agg.genreOptions).toEqual(['Electronic', 'Jazz', 'Rock']); // distinct, sorted, filter-independent
  });

  it('with a status filter applied, byStatus/total still cover ALL statuses in the q+filter set', async () => {
    // status is intentionally passed; aggregates MUST ignore it (only q/format/genre/condition narrow the set)
    const agg = await inventoryAggregates({ tenantId: tenantA, userId: null }, { format: 'Vinyl', status: 'verfuegbar' });
    expect(agg.total).toBe(4); // a1(2)+a3(2)
    expect(agg.byStatus).toEqual({ verfuegbar: 2, reserviert: 0, verkauft: 1, verliehen: 1 });
    expect(agg.valueAvailable).toBe(48); // verfuegbar vk in set: 30 + 18
    expect(agg.formatSplit).toEqual({ vinyl: 2, cd: 0, other: 0 });
    expect(agg.genreOptions).toEqual(['Electronic', 'Jazz', 'Rock']); // independent of the format filter
  });
});

describe('parseInventoryFilters — strict whitelist', () => {
  it('drops unknown/empty input', () => {
    expect(
      parseInventoryFilters({ format: 'Betamax', genre: '', condition: 'super', status: 'evil', q: '   ' }),
    ).toEqual({});
  });

  it('keeps valid input, trims/caps q to 80 chars, and takes the first array value', () => {
    const f = parseInventoryFilters({
      q: '  ' + 'x'.repeat(100),
      format: 'Vinyl',
      genre: ['Jazz'],
      condition: 'vg',
      status: ['verkauft'],
    });
    expect(f.q).toBe('x'.repeat(80));
    expect(f.format).toBe('Vinyl');
    expect(f.genre).toBe('Jazz');
    expect(f.condition).toBe('vg');
    expect(f.status).toBe('verkauft');
  });
});
