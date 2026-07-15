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
let encodeCursor: (typeof import('@/lib/inventory'))['encodeCursor'];
let decodeCursor: (typeof import('@/lib/inventory'))['decodeCursor'];
let paginateInventory: (typeof import('@/lib/inventory'))['paginateInventory'];

let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;
let tenantC: number; // ILIKE metachar escaping tests
let tenantD: number; // genreOptions isolation + formatSplit other bucket
let tenantE: number; // NULL target_price → valueAvailable coalesce path

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
    discogsId?: number;
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
  ({ listInventory, inventoryAggregates, parseInventoryFilters, encodeCursor, decodeCursor, paginateInventory } =
    await import('@/lib/inventory'));

  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo Store' })).tenantId;
  tenantB = (await seedTenant({ slug: 'other', name: 'Other Store' })).tenantId;

  // ── Tenant A: 3 records, 5 copies (deterministic) ──────────────────────────
  const a1 = await insertRecord(tenantA, {
    title: 'Kind of Blue', artist: 'Miles Davis', label: ['Columbia'],
    format: 'Vinyl', genre: ['Jazz'], releaseYear: 1959, country: 'US', hash: 'a1',
    discogsId: 4784, // a1 carries a discogsId; a2/a3 deliberately don't (asserts NULL passthrough)
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

  // ── Tenant C: 2 records for ILIKE metachar escaping tests ─────────────────
  // c1 title contains a literal %, c2 is a normal record with no metacharacters.
  tenantC = (await seedTenant({ slug: 'metachar', name: 'Metachar Store' })).tenantId;
  const c1 = await insertRecord(tenantC, {
    title: '50% Off', artist: 'Promo Artist', label: ['Promo'],
    format: 'CD', genre: ['Pop'], releaseYear: 2020, country: 'DE', hash: 'c1',
  });
  const c2 = await insertRecord(tenantC, {
    title: 'Normal Record', artist: 'Promo Artist', label: ['Promo'],
    format: 'CD', genre: ['Pop'], releaseYear: 2021, country: 'DE', hash: 'c2',
  });
  await insertPurchase(tenantC, c1, { status: 'verfuegbar', conditionRecord: 7, conditionCover: 7, ek: '5.00', vk: '10.00' });
  await insertPurchase(tenantC, c2, { status: 'verfuegbar', conditionRecord: 7, conditionCover: 7, ek: '5.00', vk: '10.00' });

  // ── Tenant D: genreOptions isolation + formatSplit other bucket ────────────
  // d1 has genre 'Reggae' (absent from tenantA) and format 'Kassette' (the 'other' bucket).
  tenantD = (await seedTenant({ slug: 'isolation', name: 'Isolation Store' })).tenantId;
  const d1 = await insertRecord(tenantD, {
    title: 'No Woman No Cry', artist: 'Bob Marley', label: ['Island'],
    format: 'Kassette', genre: ['Reggae'], releaseYear: 1974, country: 'JM', hash: 'd1',
  });
  await insertPurchase(tenantD, d1, { status: 'verfuegbar', conditionRecord: 6, conditionCover: 6, ek: '8.00', vk: '15.00' });

  // ── Tenant E: one verfuegbar copy with NULL target_price (coalesce → 0) ─────
  tenantE = (await seedTenant({ slug: 'nullvk', name: 'NullVK Store' })).tenantId;
  const e1 = await insertRecord(tenantE, {
    title: 'Untitled', artist: 'Unknown', label: ['NoLabel'],
    format: 'Vinyl', genre: ['Jazz'], releaseYear: 1990, country: 'US', hash: 'e1',
  });
  await withOwner((tx) =>
    tx.insert(purchases).values({
      tenantId: tenantE,
      recordId: e1,
      status: 'verfuegbar',
      conditionRecord: 5,
      conditionCover: 5,
      purchasePrice: '5.00',
      targetPrice: null, // the coalesce path under test
    }),
  );
}, 180_000);

afterAll(async () => {
  await teardown?.();
});

describe('listInventory — RLS isolation', () => {
  it('returns only tenant A copies and never tenant B copies', async () => {
    const { rows } = await listInventory({ tenantId: tenantA, userId: null }, {});
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.title !== 'Blue Train')).toBe(true);
  });

  it('interleaved — tenant B sees only its own copy', async () => {
    const { rows } = await listInventory({ tenantId: tenantB, userId: null }, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Blue Train');
    expect(rows[0].ek).toBe('20.00');
    expect(rows[0].vk).toBe('50.00');
  });
});

describe('listInventory — search + filters', () => {
  it('q matches title/artist/label, case-insensitive', async () => {
    expect((await listInventory({ tenantId: tenantA, userId: null }, { q: 'MILES' })).rows).toHaveLength(2); // artist
    expect((await listInventory({ tenantId: tenantA, userId: null }, { q: 'columbia' })).rows).toHaveLength(2); // label
    expect((await listInventory({ tenantId: tenantA, userId: null }, { q: 'discovery' })).rows).toHaveLength(1); // title
  });

  it('format / genre / condition-band filters select the right subset', async () => {
    expect((await listInventory({ tenantId: tenantA, userId: null }, { format: 'Vinyl' })).rows).toHaveLength(4); // a1(2)+a3(2)
    expect((await listInventory({ tenantId: tenantA, userId: null }, { genre: 'Jazz' })).rows).toHaveLength(2); // a1
    expect((await listInventory({ tenantId: tenantA, userId: null }, { condition: 'mint_nm' })).rows).toHaveLength(2); // cond>=6: 7,6
    expect((await listInventory({ tenantId: tenantA, userId: null }, { condition: 'vg' })).rows).toHaveLength(4); // cond>=4: 7,6,5,4
  });

  it('status filter selects exactly that status', async () => {
    const { rows } = await listInventory({ tenantId: tenantA, userId: null }, { status: 'verkauft' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('verkauft');
    expect(rows[0].title).toBe('Kind of Blue');
  });

  it('ek/vk are numeric→string and ordered by artist then title', async () => {
    const { rows } = await listInventory({ tenantId: tenantA, userId: null }, {});
    const artists = rows.map((r) => r.artist);
    expect(artists).toEqual([...artists].sort()); // asc(artist)
    const a1c1 = rows.find((r) => r.title === 'Kind of Blue' && r.status === 'verfuegbar');
    expect(a1c1?.ek).toBe('10.00');
    expect(a1c1?.vk).toBe('30.00');
    expect(a1c1?.conditionRecord).toBe(7);
  });

  it('discogsId is projected from records — present for a1, null for records without one', async () => {
    const { rows } = await listInventory({ tenantId: tenantA, userId: null }, {});
    const kindOfBlue = rows.find((r) => r.title === 'Kind of Blue' && r.status === 'verfuegbar');
    expect(kindOfBlue?.discogsId).toBe(4784);
    const discovery = rows.find((r) => r.title === 'Discovery');
    expect(discovery?.discogsId).toBeNull();
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

describe('listInventory — ILIKE metacharacter escaping', () => {
  it('literal % in q matches only rows containing %, not all rows (wildcard proof)', async () => {
    // With correct escaping, q='50%' → pattern %50\%% → matches '50% Off' by substring
    const { rows: byFull } = await listInventory({ tenantId: tenantC, userId: null }, { q: '50%' });
    expect(byFull).toHaveLength(1);
    expect(byFull[0].title).toBe('50% Off');

    // With correct escaping, q='%' → pattern %\%% → matches only strings containing a literal %
    // If % were unescaped it would produce %% and match every non-empty string (returns 2 rows).
    const { rows: byWildcard } = await listInventory({ tenantId: tenantC, userId: null }, { q: '%' });
    expect(byWildcard).toHaveLength(1);        // only '50% Off' contains a literal percent
    expect(byWildcard[0].title).toBe('50% Off');
  });

  it('literal _ in q returns 0 rows (not wildcard-matching all rows)', async () => {
    // With correct escaping, q='_' → pattern %\_% → matches strings containing a literal underscore.
    // If _ were unescaped it would produce %_% which matches any string with ≥1 character (returns all rows).
    const { rows } = await listInventory({ tenantId: tenantC, userId: null }, { q: '_' });
    expect(rows).toHaveLength(0); // no tenantC record title contains a literal underscore
  });
});

describe('inventoryAggregates — genreOptions cross-tenant isolation', () => {
  it('tenant A genreOptions does not contain genres present only in other tenants', async () => {
    // tenantD has a record with genre ['Reggae']; tenantA has no Reggae records.
    // If genreOptions leaked across tenants (missing WHERE tenant_id), 'Reggae' would appear.
    const agg = await inventoryAggregates({ tenantId: tenantA, userId: null }, {});
    expect(agg.genreOptions).not.toContain('Reggae');
    expect(agg.genreOptions).toEqual(['Electronic', 'Jazz', 'Rock']); // unchanged from baseline
  });
});

describe('inventoryAggregates — formatSplit other bucket', () => {
  it('Kassette format is counted in the other bucket, not vinyl or cd', async () => {
    // tenantD has one verfuegbar Kassette copy — the only format that hits the else branch.
    const agg = await inventoryAggregates({ tenantId: tenantD, userId: null }, {});
    expect(agg.formatSplit.other).toBeGreaterThanOrEqual(1);
    expect(agg.formatSplit.vinyl).toBe(0);
    expect(agg.formatSplit.cd).toBe(0);
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

describe('cursor encode/decode', () => {
  it('round-trips artist/title/copyId', () => {
    const c = { artist: 'Miles Davis', title: 'Kind of Blue', copyId: 42 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('returns null for malformed input', () => {
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(Buffer.from('{"x":1}').toString('base64url'))).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });
});

describe('listInventory — keyset pagination', () => {
  it('paginates tenant A in pages of 2 with no dupes or gaps', async () => {
    const all = (await listInventory({ tenantId: tenantA, userId: null }, {})).rows;
    expect(all).toHaveLength(5);

    const collected: typeof all = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page = await listInventory(
        { tenantId: tenantA, userId: null },
        {},
        { limit: 2, cursor: cursor ?? undefined },
      );
      expect(page.rows.length).toBeLessThanOrEqual(2);
      collected.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor && ++guard < 10);

    expect(cursor).toBeNull();
    expect(collected.map((r) => r.copyId)).toEqual(all.map((r) => r.copyId)); // same order, no dupes/gaps
    expect(new Set(collected.map((r) => r.copyId)).size).toBe(5);
  });

  it('nextCursor is null when the page is not full', async () => {
    const page = await listInventory({ tenantId: tenantA, userId: null }, {}, { limit: 50 });
    expect(page.rows).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it('a full page yields a non-null cursor; garbage cursor falls back to first page', async () => {
    const page = await listInventory({ tenantId: tenantA, userId: null }, {}, { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    const garbage = await listInventory(
      { tenantId: tenantA, userId: null },
      {},
      { limit: 2, cursor: 'not-a-cursor' },
    );
    expect(garbage.rows.map((r) => r.copyId)).toEqual(page.rows.map((r) => r.copyId));
  });

  it('limit "all" returns every row with a null cursor (unbounded restore)', async () => {
    const page = await listInventory({ tenantId: tenantA, userId: null }, {}, { limit: 'all' });
    expect(page.rows).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });
});

describe('inventoryAggregates — NULL target_price', () => {
  it('valueAvailable is 0 when the only verfuegbar copy has NULL vk (coalesce)', async () => {
    const agg = await inventoryAggregates({ tenantId: tenantE, userId: null }, {});
    expect(agg.byStatus.verfuegbar).toBe(1);
    expect(agg.valueAvailable).toBe(0);
    expect(agg.formatSplit).toEqual({ vinyl: 1, cd: 0, other: 0 });
  });
});

describe('paginateInventory — re-derives filters from the query string', () => {
  it('applies the params filter and continues from a cursor without overlap', async () => {
    const first = await listInventory({ tenantId: tenantA, userId: null }, { format: 'Vinyl' }, { limit: 2 });
    expect(first.rows).toHaveLength(2); // Vinyl has 4 copies (a1×2 + a3×2)
    expect(first.nextCursor).not.toBeNull();

    const next = await paginateInventory(
      { tenantId: tenantA, userId: null },
      'format=Vinyl',
      first.nextCursor!,
    );
    expect(next.rows).toHaveLength(2); // the remaining 2 Vinyl copies
    const firstIds = new Set(first.rows.map((r) => r.copyId));
    expect(next.rows.every((r) => !firstIds.has(r.copyId))).toBe(true);
    expect(next.nextCursor).toBeNull();
  });

  it('ignores non-whitelisted params (server-side re-validation)', async () => {
    // evil status is dropped by parseInventoryFilters → full tenant set, not a filtered/injected one
    const page = await paginateInventory({ tenantId: tenantA, userId: null }, 'status=evil', '');
    expect(page.rows.length).toBeGreaterThan(0);
  });
});
