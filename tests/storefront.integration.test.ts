import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

// Bound AFTER setupTestDatabase publishes env (harness ordering contract in tests/helpers/db.ts).
// Never import @/db/* or @/lib/storefront statically — they eval @/env at load time.
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let records: (typeof import('@/db/schema'))['records'];
let purchases: (typeof import('@/db/schema'))['purchases'];
let permalinks: (typeof import('@/db/schema'))['permalinks'];
let resolvePermalink: (typeof import('@/lib/storefront'))['resolvePermalink'];
let listStorefront: (typeof import('@/lib/storefront'))['listStorefront'];
let parsePermalinkFilter: (typeof import('@/lib/storefront'))['parsePermalinkFilter'];

let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;

// Record ids we assert against.
const ids: Record<string, number> = {};

async function insertRecord(
  tenantId: number,
  data: {
    hash: string; title: string; artist: string;
    label: string[]; genre: string[]; format: string; releaseYear: number; country: string;
  },
): Promise<number> {
  const rows = await withOwner((tx) =>
    tx
      .insert(records)
      .values({
        tenantId,
        hash: data.hash,
        title: data.title,
        artist: data.artist,
        label: data.label,
        genre: data.genre,
        format: data.format,
        releaseYear: data.releaseYear,
        country: data.country,
      })
      .returning({ id: records.id }),
  );
  return rows[0].id;
}

async function insertCopy(
  tenantId: number,
  recordId: number,
  status: 'verfuegbar' | 'reserviert' | 'verkauft' | 'verliehen',
): Promise<void> {
  await withOwner((tx) =>
    tx.insert(purchases).values({
      tenantId,
      recordId,
      status,
      purchasePrice: '12.00', // EK — MUST NOT leak to the public output
      targetPrice: '24.90',   // VK — MUST NOT leak to the public output
      conditionRecord: 6,     // condition — MUST NOT leak to the public output
      conditionCover: 5,
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
  ({ records, purchases, permalinks } = await import('@/db/schema'));
  ({ resolvePermalink, listStorefront, parsePermalinkFilter } = await import('@/lib/storefront'));

  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo Store', primaryColor: '#E8552E' })).tenantId;
  tenantB = (await seedTenant({ slug: 'other', name: 'Other Store' })).tenantId;

  // Tenant A — Jazz catalogue
  ids.jazzIn = await insertRecord(tenantA, {
    hash: 'a-jazz-in', title: 'Kind of Blue', artist: 'Miles Davis',
    label: ['Columbia'], genre: ['Jazz'], format: 'Vinyl', releaseYear: 1959, country: 'US',
  });
  await insertCopy(tenantA, ids.jazzIn, 'verfuegbar');
  await insertCopy(tenantA, ids.jazzIn, 'verfuegbar'); // 2 available → 'in'

  ids.jazzLow = await insertRecord(tenantA, {
    hash: 'a-jazz-low', title: 'A Love Supreme', artist: 'John Coltrane',
    label: ['Impulse!'], genre: ['Jazz'], format: 'Vinyl', releaseYear: 1965, country: 'US',
  });
  await insertCopy(tenantA, ids.jazzLow, 'verfuegbar'); // 1 available → 'low'
  await insertCopy(tenantA, ids.jazzLow, 'verkauft');

  ids.jazzSold = await insertRecord(tenantA, {
    hash: 'a-jazz-sold', title: 'Mingus Ah Um', artist: 'Charles Mingus',
    label: ['Columbia'], genre: ['Jazz'], format: 'Vinyl', releaseYear: 1959, country: 'US',
  });
  await insertCopy(tenantA, ids.jazzSold, 'verkauft'); // 0 available → not listed

  ids.rock = await insertRecord(tenantA, {
    hash: 'a-rock', title: 'OK Computer', artist: 'Radiohead',
    label: ['Parlophone'], genre: ['Rock'], format: 'CD', releaseYear: 1997, country: 'GB',
  });
  await insertCopy(tenantA, ids.rock, 'verfuegbar'); // available but wrong genre

  // Tenant B — its own Jazz record + same-slug permalink (isolation control)
  ids.bJazz = await insertRecord(tenantB, {
    hash: 'b-jazz', title: 'Blue Train', artist: 'John Coltrane',
    label: ['Blue Note'], genre: ['Jazz'], format: 'Vinyl', releaseYear: 1957, country: 'US',
  });
  await insertCopy(tenantB, ids.bJazz, 'verfuegbar');
  await insertCopy(tenantB, ids.bJazz, 'verfuegbar');

  await withOwner((tx) =>
    tx.insert(permalinks).values([
      { tenantId: tenantA, slug: 'jazz', filter: { genre: ['Jazz'] } },
      { tenantId: tenantB, slug: 'jazz', filter: { genre: ['Jazz'] } },
    ]),
  );
}, 90_000);

afterAll(async () => {
  await teardown?.();
});

describe('listStorefront — public, tenant-scoped, in-stock only', () => {
  it('returns only records with >=1 verfuegbar copy matching the filter', async () => {
    const rows = await listStorefront({ tenantId: tenantA }, { genre: ['Jazz'] });
    const ids_ = rows.map((r) => r.recordId).sort((a, b) => a - b);
    expect(ids_).toEqual([ids.jazzIn, ids.jazzLow].sort((a, b) => a - b));
  });

  it('computes availability: >=2 → in, exactly 1 → low', async () => {
    const rows = await listStorefront({ tenantId: tenantA }, { genre: ['Jazz'] });
    const byId = new Map(rows.map((r) => [r.recordId, r]));
    expect(byId.get(ids.jazzIn)?.availability).toBe('in');
    expect(byId.get(ids.jazzLow)?.availability).toBe('low');
  });

  it('excludes a record whose copies are all sold', async () => {
    const rows = await listStorefront({ tenantId: tenantA }, { genre: ['Jazz'] });
    expect(rows.some((r) => r.recordId === ids.jazzSold)).toBe(false);
  });

  it('respects the genre filter (rock record excluded from a Jazz permalink)', async () => {
    const rows = await listStorefront({ tenantId: tenantA }, { genre: ['Jazz'] });
    expect(rows.some((r) => r.recordId === ids.rock)).toBe(false);
  });

  it('never returns another tenant’s records for tenant A', async () => {
    const rows = await listStorefront({ tenantId: tenantA }, { genre: ['Jazz'] });
    expect(rows.some((r) => r.recordId === ids.bJazz)).toBe(false);
    expect(rows.some((r) => r.title === 'Blue Train')).toBe(false);
  });

  it('narrows by in-results query (q) over title/artist, case-insensitive', async () => {
    const rows = await listStorefront({ tenantId: tenantA }, { genre: ['Jazz'] }, 'COLTRANE');
    expect(rows.map((r) => r.recordId)).toEqual([ids.jazzLow]);
  });

  it('leaks NO private field — result objects expose exactly the public shape', async () => {
    const rows = await listStorefront({ tenantId: tenantA }, { genre: ['Jazz'] });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['artist', 'availability', 'format', 'meta', 'recordId', 'title']);
      const blob = JSON.stringify(row).toLowerCase();
      expect(blob).not.toContain('24.90'); // VK
      expect(blob).not.toContain('12.00'); // EK
      expect(blob).not.toContain('price');
      expect(blob).not.toContain('condition');
      expect(blob).not.toContain('status');
    }
    const inStock = rows.find((r) => r.recordId === ids.jazzIn);
    expect(inStock?.meta).toBe('1959 · Columbia · US · Vinyl');
  });
});

describe('resolvePermalink — fail-closed, tenant-scoped', () => {
  it('resolves a known slug to its parsed filter + derived title', async () => {
    const resolved = await resolvePermalink({ tenantId: tenantA }, 'jazz');
    expect(resolved).not.toBeNull();
    expect(resolved?.slug).toBe('jazz');
    expect(resolved?.filter).toEqual({ genre: ['Jazz'] });
    expect(resolved?.title).toBe('Jazz');
  });

  it('returns null for an unknown slug (page must call notFound())', async () => {
    expect(await resolvePermalink({ tenantId: tenantA }, 'does-not-exist')).toBeNull();
  });

  it('does not resolve a slug belonging to another tenant’s data into A’s records', async () => {
    const resolved = await resolvePermalink({ tenantId: tenantA }, 'jazz');
    const rows = await listStorefront({ tenantId: tenantA }, resolved!.filter);
    expect(rows.some((r) => r.recordId === ids.bJazz)).toBe(false);
  });
});

describe('parsePermalinkFilter — validate/sanitise jsonb', () => {
  it('keeps valid title/genre/format and drops everything else', () => {
    expect(
      parsePermalinkFilter({
        title: '  New Arrivals ',
        genre: ['Jazz', '', 'Soul', 42],
        format: ['Vinyl'],
        evil: 'DROP TABLE',
      }),
    ).toEqual({ title: 'New Arrivals', genre: ['Jazz', 'Soul'], format: ['Vinyl'] });
  });

  it('returns {} for non-object / empty / array input', () => {
    expect(parsePermalinkFilter(null)).toEqual({});
    expect(parsePermalinkFilter('jazz')).toEqual({});
    expect(parsePermalinkFilter(['Jazz'])).toEqual({});
    expect(parsePermalinkFilter({ title: 123, genre: 'Jazz' })).toEqual({});
  });
});
