# /inventar Performance — Keyset-Paging, records-Indexes, SQL-Aggregate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/inventar` von ~22 s auf < 1 s bringen, indem die Zeilen-Liste per Keyset gepagt (erste 50 + „Mehr laden"), die Aggregate SQL-seitig (eine `FILTER`-Query) und die `records`-Tabelle passend indiziert wird.

**Architecture:** Bleibt SSR + searchParams-getrieben. `listInventory` liefert statt eines nackten Arrays `{ rows, nextCursor }` und begrenzt per Keyset-Cursor auf 50 Zeilen; eine neue Server-Action `loadMoreInventory` liefert Folgeseiten; ein Client-Wrapper (`ViewToggle`) akkumuliert die Rows. `inventoryAggregates` rechnet total/byStatus/valueAvailable/formatSplit in einer einzigen `count(*) filter (...)`-Query statt tausende Rows nach JS zu ziehen. Zwei neue Indexes auf `records` decken Tenant-Filter, `(artist,title)`-Sort und Keyset ab.

**Tech Stack:** Next.js 15 (App Router, RSC + Server Actions), React 19, Drizzle ORM (node-postgres), PostgreSQL mit RLS, zod, Vitest (Testcontainers-Integration), Playwright (E2E), pnpm.

## Global Constraints

- **RLS + Defence-in-Depth:** Jeder Tenant-Zugriff läuft durch `withTenant(ctx, …)`; `basePreds` fügt IMMER `eq(records.tenantId, tenantId)` UND `eq(purchases.tenantId, tenantId)` hinzu. Tenant/`ctx` kommen NIE vom Client, immer aus `requireSession()`.
- **Server-Action-Guards (verbatim-Muster aus `actions.ts`):** `const user = await requireSession()` → `if (user.role === 'kunde') forbidden()` → `if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' }` → `zod.safeParse` → bei Fehler `{ ok: false, reason: 'validation', message: 'Ungültige Eingaben.' }`.
- **KI-Modus unangetastet:** `kiSearch()` bleibt auf `KI_SEARCH_LIMIT = 50` gecappt, kein „Mehr laden". Paging betrifft nur den klassischen Modus (`listInventory`).
- **Cursor ist opak:** an allen Grenzen (`listInventory`, Action) ein `string`; interne Form `{ artist, title, copyId }` bleibt Implementierungsdetail in `inventory.ts`.
- **Kein neuer Infra-Baustein:** kein Cache-Server, kein pgvector-Index, kein Trigram-Index (bewusst außen vor, siehe Spec).
- **Test-Import-Ordnung (Integrationstests):** NIE `@/db/*` oder `@/lib/*` statisch importieren — erst `await setupTestDatabase()`, `process.env.DATABASE_URL/OWNER_URL` setzen, `vi.resetModules()`, DANN dynamisch importieren (sonst liest `@/env` die DB-URL vor Testcontainers).
- **Verifikations-Gate vor PR (Memory `sdd-final-review-build-gate`):** `pnpm build` UND `docker compose build` grün · volle `pnpm test` (vitest) · E2E gegen frisch `docker compose down -v && up` hochgezogenen Stack. tsc/lint/unit sind blind für Layout-Intercepts und `'use server'`-Regressionen → E2E ist Pflicht.

---

### Task 1: records-Indexes (Schema + Migration)

**Files:**
- Modify: `src/db/schema.ts:201-204` (records-Index-Callback)
- Create: `drizzle/<generierte-nummer>_*.sql` (via `pnpm db:generate`)
- Test: `tests/db/records-indexes.integration.test.ts`

**Interfaces:**
- Consumes: nichts (erste Aufgabe).
- Produces: Indexes `records_tenant_artist_title_idx` (btree auf `tenant_id, artist, title, id`) und `records_tenant_format_idx` (btree auf `tenant_id, format`).

- [ ] **Step 1: Write the failing test**

Create `tests/db/records-indexes.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase } from '../helpers/db';

let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let sqlTag: (typeof import('drizzle-orm'))['sql'];
let teardown: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const testDb = await setupTestDatabase();
  teardown = testDb.teardown;
  process.env.DATABASE_URL = testDb.appUrl;
  process.env.DATABASE_OWNER_URL = testDb.ownerUrl;

  vi.resetModules();
  ({ withOwner } = await import('@/db/tenant'));
  ({ sql: sqlTag } = await import('drizzle-orm'));
}, 180_000);

afterAll(async () => {
  await teardown?.();
});

describe('records indexes', () => {
  it('has the tenant/artist/title/id and tenant/format btree indexes', async () => {
    const res = await withOwner((tx) =>
      tx.execute(sqlTag`SELECT indexname FROM pg_indexes WHERE tablename = 'records'`),
    );
    const names = (res.rows as { indexname: string }[]).map((r) => r.indexname);
    expect(names).toContain('records_tenant_artist_title_idx');
    expect(names).toContain('records_tenant_format_idx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/db/records-indexes.integration.test.ts`
Expected: FAIL — assertion `expect(names).toContain('records_tenant_artist_title_idx')` fails (index does not exist yet).

- [ ] **Step 3: Add the indexes to the schema**

In `src/db/schema.ts`, replace the records index callback (currently lines 201-204):

```ts
  (t) => ({
    hashTenantUnique: unique('records_hash_tenant').on(t.hash, t.tenantId),
  }),
```

with:

```ts
  (t) => ({
    hashTenantUnique: unique('records_hash_tenant').on(t.hash, t.tenantId),
    // Deckt Tenant-Filter + (artist,title)-Sort + Keyset-Cursor (…, id) in EINEM Index —
    // der Haupt-Hebel gegen den vollen Seq-Scan/Sort auf /inventar.
    tenantArtistTitleIdx: index('records_tenant_artist_title_idx').on(
      t.tenantId,
      t.artist,
      t.title,
      t.id,
    ),
    // Format-Facette (Alle Formate / Vinyl / CD / Kassette).
    tenantFormatIdx: index('records_tenant_format_idx').on(t.tenantId, t.format),
  }),
```

(`index` ist bereits importiert — siehe `src/db/schema.ts:5`.)

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `drizzle/NNNN_*.sql` is created containing (Reihenfolge/Quoting kann leicht abweichen):

```sql
CREATE INDEX "records_tenant_artist_title_idx" ON "records" USING btree ("tenant_id","artist","title","id");
CREATE INDEX "records_tenant_format_idx" ON "records" USING btree ("tenant_id","format");
```

Open the generated file and confirm it contains exactly these two `CREATE INDEX` statements and no unintended changes (no table drops/renames). If drizzle emitted anything else, stop and investigate before continuing.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/db/records-indexes.integration.test.ts`
Expected: PASS (the Testcontainers harness applies the new migration in `beforeAll`, so both indexes now exist).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/ tests/db/records-indexes.integration.test.ts
git commit -m "perf(inventar): add records(tenant,artist,title,id) + (tenant,format) indexes"
```

---

### Task 2: Keyset-Cursor + gepagtes `listInventory`

**Files:**
- Modify: `src/lib/inventory.ts` (Konstante + Typen + Cursor-Helfer + `listInventory`)
- Modify: `src/app/(app)/inventar/page.tsx:40-49` (neue Rückgabe-Form konsumieren)
- Test: `tests/inventory.integration.test.ts` (bestehende Calls anpassen + neue Keyset-Tests)

**Interfaces:**
- Consumes: `records`, `purchases` aus `@/db/schema`; `withTenant`; `basePreds` (unverändert).
- Produces:
  - `export const INVENTORY_PAGE_SIZE = 50`
  - `export type InventoryCursor = { artist: string; title: string; copyId: number }`
  - `export type ListInventoryResult = { rows: InventoryRow[]; nextCursor: string | null }`
  - `export function encodeCursor(c: InventoryCursor): string`
  - `export function decodeCursor(raw: string): InventoryCursor | null`
  - `listInventory(ctx, f, opts?: { limit?: number; cursor?: string }): Promise<ListInventoryResult>` (Rückgabe geändert von `InventoryRow[]` → `ListInventoryResult`)

- [ ] **Step 1: Write the failing tests (cursor + keyset)**

In `tests/inventory.integration.test.ts`, add `encodeCursor`, `decodeCursor` to the dynamic-import bindings. Change the binding block near the top:

```ts
let listInventory: (typeof import('@/lib/inventory'))['listInventory'];
let inventoryAggregates: (typeof import('@/lib/inventory'))['inventoryAggregates'];
let parseInventoryFilters: (typeof import('@/lib/inventory'))['parseInventoryFilters'];
let encodeCursor: (typeof import('@/lib/inventory'))['encodeCursor'];
let decodeCursor: (typeof import('@/lib/inventory'))['decodeCursor'];
```

and the import inside `beforeAll` (currently line 80):

```ts
  ({ listInventory, inventoryAggregates, parseInventoryFilters, encodeCursor, decodeCursor } =
    await import('@/lib/inventory'));
```

Then append these new describe blocks at the end of the file:

```ts
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
});
```

- [ ] **Step 2: Update the existing `listInventory` assertions to the new shape**

`listInventory` now returns `{ rows, nextCursor }`. Update every existing call in `tests/inventory.integration.test.ts` that used the array directly:

- Line 146: `const rows = await listInventory({ tenantId: tenantA, userId: null }, {});` → `const { rows } = await listInventory({ tenantId: tenantA, userId: null }, {});`
- Line 152: `const rows = await listInventory({ tenantId: tenantB, userId: null }, {});` → `const { rows } = await listInventory({ tenantId: tenantB, userId: null }, {});`
- Lines 162-164: wrap each in `.rows`, e.g.
  `expect(await listInventory(…, { q: 'MILES' })).toHaveLength(2);` → `expect((await listInventory(…, { q: 'MILES' })).rows).toHaveLength(2);` (same for `'columbia'` and `'discovery'`).
- Lines 168-171: wrap each in `.rows`, e.g.
  `expect((await listInventory(…, { format: 'Vinyl' })).rows).toHaveLength(4);` (same for `genre: 'Jazz'`, `condition: 'mint_nm'`, `condition: 'vg'`).
- Line 175: `const rows = await listInventory(…, { status: 'verkauft' });` → `const { rows } = await listInventory(…, { status: 'verkauft' });`
- Line 182: `const rows = await listInventory({ tenantId: tenantA, userId: null }, {});` → `const { rows } = await listInventory({ tenantId: tenantA, userId: null }, {});`
- Line 192: `const rows = await listInventory({ tenantId: tenantA, userId: null }, {});` → `const { rows } = await listInventory({ tenantId: tenantA, userId: null }, {});`
- Lines 224, 230, 238 (ILIKE block): `const byFull = await listInventory(…);` → `const { rows: byFull } = await listInventory(…);`, `const byWildcard = await listInventory(…);` → `const { rows: byWildcard } = await listInventory(…);`, `const rows = await listInventory(…, { q: '_' });` → `const { rows } = await listInventory(…, { q: '_' });`.

The assertion bodies (`.toHaveLength`, `.title`, `.ek`, etc.) stay unchanged — they now operate on the destructured `rows`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test tests/inventory.integration.test.ts`
Expected: FAIL — `encodeCursor`/`decodeCursor` are `undefined` and `listInventory(...).rows` is `undefined` (function still returns an array). TypeScript/`.rows` access errors are expected.

- [ ] **Step 4: Implement cursor helpers + keyset `listInventory`**

In `src/lib/inventory.ts`, add near the other module constants (after line 47, `const STATUS_VALUES = …`):

```ts
/** Default page size for the classic inventory list ("Mehr laden" lädt je 50). */
export const INVENTORY_PAGE_SIZE = 50;

/** Opaque keyset position — the (artist, title, copyId) of the last row of a page. */
export type InventoryCursor = { artist: string; title: string; copyId: number };

export type ListInventoryResult = { rows: InventoryRow[]; nextCursor: string | null };

/** base64url of [artist, title, copyId]. Opaque to callers; only carries sort position. */
export function encodeCursor(c: InventoryCursor): string {
  return Buffer.from(JSON.stringify([c.artist, c.title, c.copyId]), 'utf8').toString('base64url');
}

/** Inverse of encodeCursor. Returns null for anything malformed — a bad cursor is treated
 *  as "no cursor" (first page); it can never leak across tenants (RLS + tenant preds still apply). */
export function decodeCursor(raw: string): InventoryCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      Number.isInteger(parsed[2])
    ) {
      return { artist: parsed[0], title: parsed[1], copyId: parsed[2] };
    }
  } catch {
    // malformed → treat as no cursor
  }
  return null;
}
```

Then replace the whole `listInventory` function (currently lines 68-98) with:

```ts
export async function listInventory(
  ctx: { tenantId: number; userId: number | null },
  f: InventoryFilters,
  opts?: { limit?: number; cursor?: string },
): Promise<ListInventoryResult> {
  const limit = opts?.limit ?? INVENTORY_PAGE_SIZE;
  const cursor = opts?.cursor ? decodeCursor(opts.cursor) : null;
  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const preds = basePreds(ctx.tenantId, f);
    if (f.status) preds.push(eq(purchases.status, f.status));
    if (cursor) {
      // Keyset: strictly after the last row, in the SAME total order as the ORDER BY below.
      // Row-value comparison uses the columns' default collation → consistent with the sort.
      preds.push(
        sql`(${records.artist}, ${records.title}, ${purchases.id}) > (${cursor.artist}, ${cursor.title}, ${cursor.copyId}::int)`,
      );
    }
    const rows = await tx
      .select({
        copyId: purchases.id,
        recordId: records.id,
        title: records.title,
        artist: records.artist,
        label: records.label,
        releaseYear: records.releaseYear,
        country: records.country,
        format: records.format,
        genre: records.genre,
        ek: purchases.purchasePrice,
        vk: purchases.targetPrice,
        status: purchases.status,
        conditionRecord: purchases.conditionRecord,
        conditionCover: purchases.conditionCover,
        discogsId: records.discogsId,
      })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(and(...preds))
      .orderBy(asc(records.artist), asc(records.title), asc(purchases.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ artist: last.artist, title: last.title, copyId: last.copyId })
        : null;
    return { rows: pageRows, nextCursor };
  });
}
```

- [ ] **Step 5: Keep `page.tsx` compiling with the new shape**

In `src/app/(app)/inventar/page.tsx`, replace lines 44-49 (the `Array.isArray(rowsResult)` block) with an explicit branch on `kiMode` (both result shapes expose `.rows`):

```ts
  // listInventory() → { rows, nextCursor }; kiSearch() → { rows, unavailable? }.
  // Branch on kiMode (a plain boolean) — cleaner than sniffing the union.
  let rows: (InventoryRow & { score?: number })[];
  let kiUnavailable = false;
  if (kiMode) {
    const r = rowsResult as { rows: (InventoryRow & { score?: number })[]; unavailable?: boolean };
    rows = r.rows;
    kiUnavailable = r.unavailable ?? false;
  } else {
    const r = rowsResult as import('@/lib/inventory').ListInventoryResult;
    rows = r.rows;
  }
```

(The `nextCursor` is not consumed yet — that wiring lands in Task 5. The page now renders the first 50 rows.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test tests/inventory.integration.test.ts`
Expected: PASS — all existing assertions (now reading `.rows`) plus the new cursor + keyset blocks are green.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (page.tsx consumes the new `ListInventoryResult`).

- [ ] **Step 8: Commit**

```bash
git add src/lib/inventory.ts src/app/(app)/inventar/page.tsx tests/inventory.integration.test.ts
git commit -m "perf(inventar): keyset-paginate listInventory (50/page, opaque cursor)"
```

---

### Task 3: SQL-seitige Aggregate (eine `FILTER`-Query)

**Files:**
- Modify: `src/lib/inventory.ts` (`inventoryAggregates`, currently lines 100-151)
- Test: `tests/inventory.integration.test.ts` (bestehende Aggregat-Tests = Paritäts-Anker; + neuer NULL-vk-Test)

**Interfaces:**
- Consumes: `basePreds`, `records`, `purchases`, `withTenant`.
- Produces: unveränderte Signatur/Rückgabe `inventoryAggregates(ctx, f): Promise<InventoryAggregates>` — nur die Implementierung wird SQL-seitig. Zusätzliches Fixture `tenantE` (nur Test).

- [ ] **Step 1: Write the failing test (NULL target_price coalesce)**

In `tests/inventory.integration.test.ts`, add a `tenantE` declaration next to the others (near line 18):

```ts
let tenantE: number; // NULL target_price → valueAvailable coalesce path
```

At the end of `beforeAll` (after the tenant D block, before the closing `}, 180_000);`), add:

```ts
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
```

Then add this describe block at the end of the file:

```ts
describe('inventoryAggregates — NULL target_price', () => {
  it('valueAvailable is 0 when the only verfuegbar copy has NULL vk (coalesce)', async () => {
    const agg = await inventoryAggregates({ tenantId: tenantE, userId: null }, {});
    expect(agg.byStatus.verfuegbar).toBe(1);
    expect(agg.valueAvailable).toBe(0);
    expect(agg.formatSplit).toEqual({ vinyl: 1, cd: 0, other: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or errors)**

Run: `pnpm test tests/inventory.integration.test.ts -t "NULL target_price"`
Expected: FAIL/ERROR — `tenantE` fixture exists but the assertion set is new; run confirms the test is wired and red before the refactor. (If it passes accidentally against the old JS impl, that is fine — Step 4 must keep it green.)

- [ ] **Step 3: Rewrite `inventoryAggregates` to a single FILTER query**

Replace the body of `inventoryAggregates` (lines 100-151) with:

```ts
export async function inventoryAggregates(
  ctx: { tenantId: number; userId: number | null },
  f: InventoryFilters,
): Promise<InventoryAggregates> {
  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const preds = basePreds(ctx.tenantId, f); // NB: status intentionally excluded

    // total + per-status counts + valueAvailable + formatSplit in ONE pass —
    // no more pulling thousands of rows to sum in JS.
    const [agg] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        verfuegbar: sql<number>`count(*) filter (where ${purchases.status} = 'verfuegbar')::int`,
        reserviert: sql<number>`count(*) filter (where ${purchases.status} = 'reserviert')::int`,
        verkauft: sql<number>`count(*) filter (where ${purchases.status} = 'verkauft')::int`,
        verliehen: sql<number>`count(*) filter (where ${purchases.status} = 'verliehen')::int`,
        valueAvailable: sql<number>`coalesce(sum(${purchases.targetPrice}) filter (where ${purchases.status} = 'verfuegbar'), 0)::float8`,
        splitVinyl: sql<number>`count(*) filter (where ${purchases.status} = 'verfuegbar' and ${records.format} = 'Vinyl')::int`,
        splitCd: sql<number>`count(*) filter (where ${purchases.status} = 'verfuegbar' and ${records.format} = 'CD')::int`,
      })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(and(...preds));

    const byStatus: Record<InventoryStatus, number> = {
      verfuegbar: agg.verfuegbar,
      reserviert: agg.reserviert,
      verkauft: agg.verkauft,
      verliehen: agg.verliehen,
    };
    const total = agg.total;
    const valueAvailable = Number(agg.valueAvailable);
    // "other" = alle verfügbaren Kopien minus Vinyl minus CD (NULL-Format zählt zu other,
    // NULL-sicher durch Subtraktion statt NOT IN).
    const formatSplit = {
      vinyl: agg.splitVinyl,
      cd: agg.splitCd,
      other: agg.verfuegbar - agg.splitVinyl - agg.splitCd,
    };

    // genreOptions — distinct genres for the tenant, independent of the active filters.
    const genreRes = await tx.execute(
      sql`SELECT DISTINCT unnest(genre) AS g FROM records WHERE tenant_id = ${ctx.tenantId} ORDER BY g`,
    );
    const genreOptions = (genreRes.rows as { g: string }[]).map((row) => row.g);

    return { total, byStatus, valueAvailable, formatSplit, genreOptions };
  });
}
```

- [ ] **Step 4: Run the full aggregates test group to verify parity**

Run: `pnpm test tests/inventory.integration.test.ts -t "inventoryAggregates"`
Expected: PASS — the pre-existing parity assertions stay green:
- no-filter: `total=5`, `byStatus={verfuegbar:3,reserviert:0,verkauft:1,verliehen:1}`, `valueAvailable=63`, `formatSplit={vinyl:2,cd:1,other:0}`, `genreOptions=['Electronic','Jazz','Rock']`
- format=Vinyl+status filter: `total=4`, `valueAvailable=48`, `formatSplit={vinyl:2,cd:0,other:0}`
- genreOptions cross-tenant isolation (no 'Reggae'); formatSplit other bucket (tenant D Kassette); and the new NULL-vk test.

- [ ] **Step 5: Run the whole inventory suite**

Run: `pnpm test tests/inventory.integration.test.ts`
Expected: PASS (all groups).

- [ ] **Step 6: Commit**

```bash
git add src/lib/inventory.ts tests/inventory.integration.test.ts
git commit -m "perf(inventar): compute aggregates in one SQL FILTER query (no JS row scan)"
```

---

### Task 4: `paginateInventory`-Helfer + `loadMoreInventory`-Server-Action

**Files:**
- Modify: `src/lib/inventory.ts` (neuer `paginateInventory`-Helfer)
- Modify: `src/app/(app)/inventar/actions.ts` (neue Action + Imports + zod-Schema)
- Test: `tests/inventory.integration.test.ts` (Helfer-Tests — der Helfer ist auth-frei/pur)

**Interfaces:**
- Consumes: `parseInventoryFilters`, `listInventory` (aus Task 2), `requireSession`, `isValidOrigin`, `forbidden`, `z`.
- Produces:
  - `paginateInventory(ctx, paramsString: string, cursor: string): Promise<ListInventoryResult>`
  - `loadMoreInventory(input: unknown): Promise<{ ok: true; rows: InventoryRow[]; nextCursor: string | null } | ActionErr>`

- [ ] **Step 1: Write the failing test for `paginateInventory`**

In `tests/inventory.integration.test.ts`, add the binding:

```ts
let paginateInventory: (typeof import('@/lib/inventory'))['paginateInventory'];
```

extend the dynamic import in `beforeAll`:

```ts
  ({ listInventory, inventoryAggregates, parseInventoryFilters, encodeCursor, decodeCursor, paginateInventory } =
    await import('@/lib/inventory'));
```

and append:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/inventory.integration.test.ts -t "paginateInventory"`
Expected: FAIL — `paginateInventory` is `undefined`.

- [ ] **Step 3: Implement `paginateInventory`**

In `src/lib/inventory.ts`, add directly after `parseInventoryFilters` (after line 183):

```ts
/** Server-action core for "Mehr laden": re-derives the filters from the raw query string
 *  (single source of truth = parseInventoryFilters) and returns the next keyset page.
 *  Auth-agnostic — the calling server action enforces session/role/CSRF. */
export async function paginateInventory(
  ctx: { tenantId: number; userId: number | null },
  paramsString: string,
  cursor: string,
): Promise<ListInventoryResult> {
  const sp = Object.fromEntries(new URLSearchParams(paramsString));
  const filters = parseInventoryFilters(sp);
  return listInventory(ctx, filters, { cursor });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/inventory.integration.test.ts -t "paginateInventory"`
Expected: PASS.

- [ ] **Step 5: Implement the `loadMoreInventory` server action**

In `src/app/(app)/inventar/actions.ts`, extend the import from `@/lib/inventory` (there is currently no such import — add it near the other `@/lib` imports, e.g. after line 12):

```ts
import { paginateInventory, type InventoryRow } from '@/lib/inventory';
```

Then add the action at the end of the file:

```ts
// ── "Mehr laden" — nächste Keyset-Seite der Lagerbestand-Liste ────────────────
const loadMoreSchema = z.object({
  params: z.string().max(2000), // searchParams.toString() vom Client (server-seitig re-validiert)
  cursor: z.string().min(1).max(2000),
});

export async function loadMoreInventory(
  input: unknown,
): Promise<{ ok: true; rows: InventoryRow[]; nextCursor: string | null } | ActionErr> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };

  const parsed = loadMoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'validation', message: 'Ungültige Eingaben.' };

  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { rows, nextCursor } = await paginateInventory(ctx, parsed.data.params, parsed.data.cursor);
    return { ok: true, rows, nextCursor };
  } catch (err) {
    console.error('[inventar] loadMoreInventory failed', err);
    return { ok: false, reason: 'error' };
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/inventory.ts src/app/(app)/inventar/actions.ts tests/inventory.integration.test.ts
git commit -m "feat(inventar): loadMoreInventory server action (guards + keyset page)"
```

---

### Task 5: Client-Akkumulation + „Mehr laden"-Button (ViewToggle + page.tsx)

**Files:**
- Modify: `src/app/(app)/inventar/_components/ViewToggle.tsx`
- Modify: `src/app/(app)/inventar/page.tsx` (initialCursor berechnen + `key` + Prop)
- Test: `tests/inventar/lagerbestand.test.tsx` (Mocks erweitern + neue ViewToggle-Tests)

**Interfaces:**
- Consumes: `loadMoreInventory` (Task 4), `ListInventoryResult.nextCursor` (Task 2).
- Produces: `ViewToggleProps` erhält `initialCursor?: string | null`.

- [ ] **Step 1: Write the failing component tests**

In `tests/inventar/lagerbestand.test.tsx`, add a hoisted mock for the inventar action and extend the `next/navigation` mock. After the existing `vi.mock('next/navigation', …)` (line 33), replace it with:

```ts
const mockLoadMore = vi.hoisted(() =>
  vi.fn(
    async (): Promise<
      | { ok: true; rows: InventoryRow[]; nextCursor: string | null }
      | { ok: false; reason: 'validation' | 'error'; message?: string }
    > => ({ ok: true, rows: [], nextCursor: null }),
  ),
);

// InventoryList calls useRouter().refresh(); ViewToggle reads useSearchParams() for load-more.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
  useSearchParams: () => new URLSearchParams('status=verfuegbar'),
}));

// ViewToggle imports loadMoreInventory from ../actions (a 'use server' module) — mock it.
vi.mock('@/app/(app)/inventar/actions', () => ({ loadMoreInventory: mockLoadMore }));
```

Add `mockLoadMore.mockReset(); mockLoadMore.mockResolvedValue({ ok: true, rows: [], nextCursor: null });` to the `beforeEach` block (near line 60-68).

Then add this describe block (place it after the existing ViewToggle-related tests; if none, at the end of the file). It reuses the file's existing `ROWS` fixture:

```ts
describe('ViewToggle — Mehr laden', () => {
  it('renders no "Mehr laden" button when initialCursor is null', () => {
    render(<ViewToggle rows={ROWS} total={ROWS.length} initialCursor={null} />);
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('shows the button for a non-null cursor, appends rows on click, and hides it when exhausted', async () => {
    const user = userEvent.setup();
    const extraRow: InventoryRow = { ...ROWS[0], copyId: 99999, title: 'Nachgeladen' };
    mockLoadMore.mockResolvedValueOnce({ ok: true, rows: [extraRow], nextCursor: null });

    render(<ViewToggle rows={ROWS} total={ROWS.length + 1} initialCursor="cur-1" />);

    const btn = screen.getByTestId('load-more');
    expect(btn).toBeInTheDocument();

    await user.click(btn);

    // Action called with the current searchParams string + the cursor.
    expect(mockLoadMore).toHaveBeenCalledWith({ params: 'status=verfuegbar', cursor: 'cur-1' });
    // Appended row is now visible …
    await waitFor(() => expect(screen.getByText('Nachgeladen')).toBeInTheDocument());
    // … and the button is gone (nextCursor was null).
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('surfaces an inline error and keeps the button on action failure', async () => {
    const user = userEvent.setup();
    mockLoadMore.mockResolvedValueOnce({ ok: false, reason: 'error' });

    render(<ViewToggle rows={ROWS} total={ROWS.length + 1} initialCursor="cur-1" />);
    await user.click(screen.getByTestId('load-more'));

    await waitFor(() =>
      expect(screen.getByText(/konnten nicht geladen werden/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId('load-more')).toBeInTheDocument(); // cursor unchanged → still there
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/inventar/lagerbestand.test.tsx -t "Mehr laden"`
Expected: FAIL — `ViewToggle` does not accept `initialCursor` and renders no `load-more` button.

- [ ] **Step 3: Implement load-more in `ViewToggle`**

Replace the imports and component in `src/app/(app)/inventar/_components/ViewToggle.tsx`. Update the top imports:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { InventoryList } from './InventoryList';
import { InventoryTiles } from './InventoryTiles';
import { loadMoreInventory } from '../actions';
import type { InventoryRow } from '@/lib/inventory';
```

Update the props interface:

```tsx
export interface ViewToggleProps {
  rows: (InventoryRow & { score?: number })[];
  total: number;
  kiUnavailable?: boolean;
  initialCursor?: string | null;
}
```

Replace the component signature + top of the body (the `useState` for `view`) with:

```tsx
export function ViewToggle({
  rows: initialRows,
  total,
  kiUnavailable,
  initialCursor = null,
}: ViewToggleProps) {
  const [view, setView] = useState<'list' | 'tiles'>('list');
  const searchParams = useSearchParams();
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const onLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    const result = await loadMoreInventory({ params: searchParams.toString(), cursor });
    if (result.ok) {
      setRows((prev) => [...prev, ...result.rows]);
      setCursor(result.nextCursor);
    } else {
      setLoadError('Weitere Einträge konnten nicht geladen werden. Bitte erneut versuchen.');
    }
    setLoadingMore(false);
  };
```

In the two early-return guards, change `if (rows.length === 0)` to use the state variable (it now shadows the prop — the code already reads `rows`, which is now the state; no further change needed since the guard already says `rows.length === 0`). The `kiUnavailable` guard is unchanged.

Replace the final `return (...)` block (the list/tiles render) with:

```tsx
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={view}
          onChange={(v) => setView(v as 'list' | 'tiles')}
          aria-label="Ansicht wechseln"
        />
      </div>
      {view === 'list' ? (
        <InventoryList rows={rows} total={total} />
      ) : (
        <InventoryTiles rows={rows} />
      )}
      {cursor && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '4px 0 8px',
          }}
        >
          {loadError && (
            <p role="alert" style={{ margin: 0, fontSize: '12.5px', color: 'var(--bad)' }}>
              {loadError}
            </p>
          )}
          <button
            type="button"
            data-testid="load-more"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="focus-ring-button"
            style={{
              minHeight: 40,
              padding: '0 20px',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: 13,
              cursor: loadingMore ? 'progress' : 'pointer',
            }}
          >
            {loadingMore ? 'Lädt …' : 'Mehr laden'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire `initialCursor` + reset-`key` in `page.tsx`**

In `src/app/(app)/inventar/page.tsx`, extend the branch from Task 2 to also compute `initialCursor` in the classic branch:

```ts
  let rows: (InventoryRow & { score?: number })[];
  let kiUnavailable = false;
  let initialCursor: string | null = null;
  if (kiMode) {
    const r = rowsResult as { rows: (InventoryRow & { score?: number })[]; unavailable?: boolean };
    rows = r.rows;
    kiUnavailable = r.unavailable ?? false;
  } else {
    const r = rowsResult as import('@/lib/inventory').ListInventoryResult;
    rows = r.rows;
    initialCursor = r.nextCursor;
  }
```

Then update the `<ViewToggle …>` render (currently line 75) to pass the cursor and a reset key that changes on any filter/search/tab/mode change (forces a fresh client accumulation on navigation):

```tsx
      <ViewToggle
        key={JSON.stringify({ ...filters, mode: kiMode ? 'ki' : 'classic', q: query })}
        rows={rows}
        total={aggs.total}
        kiUnavailable={kiUnavailable}
        initialCursor={initialCursor}
      />
```

- [ ] **Step 5: Run component tests to verify they pass**

Run: `pnpm test tests/inventar/lagerbestand.test.tsx`
Expected: PASS — the three "Mehr laden" tests plus all pre-existing InventoryList/Tiles/ViewToggle tests (the extended `next/navigation` mock keeps them green).

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/inventar/_components/ViewToggle.tsx src/app/(app)/inventar/page.tsx tests/inventar/lagerbestand.test.tsx
git commit -m "feat(inventar): client accumulation + Mehr laden button (keyset)"
```

---

### Task 6: Stress-Tenant im Seed + E2E „Mehr laden"

**Files:**
- Modify: `scripts/seed.ts` (dedizierter Stress-Tenant mit > 50 Kopien)
- Modify: `e2e/helpers.ts` (Konstanten für den Stress-Tenant)
- Create: `e2e/inventory-paging.spec.ts`

**Interfaces:**
- Consumes: bestehende `provisionTenant`/`ensureRecord`/`ensurePurchase`-Helfer in `seed.ts`; `login`, `DEMO_PASSWORD` aus `e2e/helpers.ts`.
- Produces: Seed-Tenant `stress` (slug `stress`, admin `admin@stress.test`, ≥ 70 verfügbare Kopien) + E2E-Coverage für den Load-More-Pfad.

> **Note on scope:** Der Stress-Tenant lebt NUR im Seed (`scripts/seed.ts`), der dev/compose/e2e-Stacks befüllt. Prod wird über `scripts/bootstrap-prod.ts` provisioniert und ist NICHT betroffen.

- [ ] **Step 1: Inspect the existing seed helpers**

Run: `sed -n '350,480p' scripts/seed.ts`
Expected: confirm the exact signatures of the idempotent `ensureRecord`/`ensurePurchase` (names/params) and how `provisionTenant` is invoked for `DEMO_TENANT`. Use those exact signatures in Step 2 (adapt the calls below if the helper names differ — do not invent new ones).

- [ ] **Step 2: Add the stress tenant to the seed**

In `scripts/seed.ts`, after the DEMO/VINYLCAVE tenants are provisioned and seeded, add a stress tenant. Use the same `provisionTenant` call shape already used for `DEMO_TENANT` (copy its option object, change slug/name/adminEmail to `stress` / `Stress Store` / `admin@stress.test`). Then generate ≥ 70 copies:

```ts
// ── Stress tenant: > 1 page (50) of copies so the /inventar "Mehr laden" flow is E2E-testable.
// Seed-only (dev/compose/e2e). Prod is provisioned via bootstrap-prod.ts and is unaffected.
const STRESS_COUNT = 70;
const genres = ['Jazz', 'Rock', 'Electronic', 'Pop', 'Reggae'];
const formats = ['Vinyl', 'CD', 'Kassette'];
for (let i = 0; i < STRESS_COUNT; i++) {
  const n = String(i).padStart(3, '0');
  const recordId = await ensureRecord(db, {
    tenantId: stressTenantId,
    title: `Stress Title ${n}`,
    artist: `Stress Artist ${n}`,
    label: ['StressLabel'],
    format: formats[i % formats.length],
    genre: [genres[i % genres.length]],
    releaseYear: 1970 + (i % 50),
    country: 'US',
    hash: `stress-${n}`,
  });
  await ensurePurchase(db, {
    tenantId: stressTenantId,
    recordId,
    status: 'verfuegbar',
    conditionRecord: 5,
    conditionCover: 5,
    ek: '5.00',
    vk: '15.00',
  });
}
```

Adapt `ensureRecord`/`ensurePurchase`/`db`/`stressTenantId` to the actual names discovered in Step 1. (`ensureRecord`/`ensurePurchase` are idempotent by design — re-running the seed is safe.)

- [ ] **Step 3: Add stress-tenant constants to the E2E helpers**

In `e2e/helpers.ts`, after the `VINYLCAVE_URL` constant, add:

```ts
export const STRESS_URL = 'http://stress.localhost:3000';
export const STRESS_EMAIL = process.env.E2E_STRESS_EMAIL ?? 'admin@stress.test';
export const STRESS_PASSWORD = process.env.E2E_STRESS_PASSWORD ?? 'E2eDevPassword1!';
```

- [ ] **Step 4: Write the E2E paging spec**

Create `e2e/inventory-paging.spec.ts`:

```ts
/**
 * E2E — /inventar keyset pagination ("Mehr laden").
 * Runs against the seeded `stress` tenant (≥ 70 verfügbare Kopien > page size 50).
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web).
 */
import { test, expect } from '@playwright/test';
import { STRESS_URL, STRESS_EMAIL, STRESS_PASSWORD, login } from './helpers';

test.describe('Lagerbestand paging (/inventar)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, STRESS_URL, STRESS_EMAIL, STRESS_PASSWORD);
  });

  test('first page caps at 50 rows and "Mehr laden" appends the rest', async ({ page }) => {
    await page.goto(`${STRESS_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');

    // First page: exactly the page size (50), not all 70.
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBe(50);

    const loadMore = page.getByTestId('load-more');
    await expect(loadMore).toBeVisible();

    await loadMore.click();

    // After one load-more the accumulated rows exceed the first page …
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBeGreaterThan(50);

    // … and with 70 total (< 2×50) the cursor is exhausted → button gone.
    await expect(page.getByTestId('load-more')).toHaveCount(0);
  });
});
```

- [ ] **Step 5: Bring up a fresh stack and run the spec**

Run:
```bash
docker compose down -v && docker compose up -d --build
pnpm e2e e2e/inventory-paging.spec.ts
```
Expected: PASS — 50 rows initially, > 50 after clicking, button removed at the end.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed.ts e2e/helpers.ts e2e/inventory-paging.spec.ts
git commit -m "test(inventar): stress-tenant seed + E2E for Mehr laden paging"
```

---

### Task 7: Verifikations-Gate (Build + volle Suite + E2E)

**Files:** keine (reine Verifikation vor PR).

**Interfaces:** Consumes alle vorherigen Tasks.

- [ ] **Step 1: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 2: Full unit/integration suite**

Run: `pnpm test`
Expected: all suites green. (Falls die Suite mit Exit≠0 trotz grüner Files endet — bekannter Testcontainer-`57P01`-Flake, Memory `vitest-suite-flaky-under-parallel-load` — gezielt erneut laufen lassen; kein Code-Bug.)

- [ ] **Step 3: Production build (Next.js)**

Run: `pnpm build`
Expected: build succeeds (RSC/`'use server'`-Regressionen tauchen erst hier auf).

- [ ] **Step 4: Docker build**

Run: `docker compose build`
Expected: image builds.

- [ ] **Step 5: Full E2E against a fresh stack**

Run:
```bash
docker compose down -v && docker compose up -d --build
pnpm e2e
```
Expected: the whole Playwright suite (inkl. `inventory.spec.ts` und `inventory-paging.spec.ts`) is green against the freshly seeded stack.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin perf/inventar-paging
gh pr create --fill --base main
```
PR-Body soll auf die Spec (`docs/superpowers/specs/2026-07-15-inventar-performance-paging-design.md`) verweisen und das erwartete Ergebnis nennen (~22 s → < 1 s; kein neuer Infra-Baustein; Cache-Server bewusst aufgeschoben).

---

## Self-Review

**1. Spec coverage:**
- Keyset-Paging (opaker String-Cursor, Sort `artist,title,copyId`, Page-Size 50) → Task 2. ✔
- Load-More-Server-Action mit Auth/CSRF/Tenant-Guards + serverseitiger Filter-Re-Validierung → Task 4. ✔
- Client-Akkumulation + „Mehr laden", KI-Modus unangetastet, Reset bei Filterwechsel → Task 5. ✔
- Aggregate in einer SQL-`FILTER`-Query, `valueAvailable` coalesce, `formatSplit.other` per Subtraktion, `genreOptions` separat → Task 3. ✔
- Indexes `records(tenant_id,artist,title,id)` + `records(tenant_id,format)` via Drizzle-Migration → Task 1. ✔
- Tests: Keyset (keine Dupes/Lücken), Aggregat-Parität (bestehende Tests bleiben grün) + NULL-vk, Cursor-Round-Trip, Action-Core (`paginateInventory`) inkl. Re-Validierung, E2E Load-More → Tasks 1-6. ✔
- Verifikations-Gate (build + docker build + volle vitest + E2E gegen `down -v`) → Task 7. ✔
- Nicht-Ziele (kein Cache-Server / pgvector / Trigram) → nirgends implementiert. ✔

**2. Placeholder scan:** Keine TBD/TODO; jeder Code-Step zeigt vollständigen Code; das einzige „adapt to actual names" (Task 6 Step 2) ist bewusst, weil es an bestehende Seed-Helfer andockt und Step 1 die echten Signaturen zuerst ermittelt.

**3. Type consistency:** `ListInventoryResult = { rows: InventoryRow[]; nextCursor: string | null }` konsistent in Task 2 (Rückgabe `listInventory`), Task 3 (unverändert), Task 4 (`paginateInventory` Rückgabe, Action liefert `rows`/`nextCursor`), Task 5 (page `initialCursor = r.nextCursor`, ViewToggle-Prop `initialCursor?: string | null`). `loadMoreInventory({ params, cursor })` — Client (Task 5, `searchParams.toString()` + `cursor`) == zod-Schema (Task 4, `{ params, cursor }`). `encodeCursor`/`decodeCursor`/`InventoryCursor`/`INVENTORY_PAGE_SIZE` durchgängig gleich benannt. `data-testid="load-more"` identisch in Komponente (Task 5) und beiden Test-Ebenen (Task 5 unit + Task 6 E2E).
