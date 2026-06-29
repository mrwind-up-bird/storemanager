# Slice 1 — Inventar + Dashboard + Schaufenster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Date:** 2026-06-29
**Spec:** `docs/superpowers/specs/2026-06-29-qrecords-v2-slice1-inventory-dashboard-storefront-design.md`
**Branch:** `feat/v2-slice1-inventory` (off the Slice-0 tip)

**Goal:** Build the bestand data model + the three read screens — Lagerbestand (list/tile/filter/status), Übersicht (real KPIs + graceful empties), public Schaufenster (availability, no price/condition) — read-only over a rich seed.

**Architecture:** `records` is the catalog/release; `purchases` is the physical COPY = the inventory unit (status + condition + EK/VK live on the copy). Screens are React Server Components reading tenant-scoped data through `withTenant` via two query modules (`src/lib/inventory.ts`, `src/lib/storefront.ts`); search/filter/status state is in URL query params (SSR + shareable); list/tile toggle is client state. All mutation CTAs are disabled placeholders.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, Drizzle ORM, PostgreSQL 17, Vitest + @testcontainers/postgresql, Playwright (all from Slice 0).

## Global Constraints

- **Inventory unit = copy** (`purchases ⋈ records`). `records.recordStatus` is REMOVED; the 4-value status enum lives on `purchases.status`. EK = `purchases.purchasePrice`, VK = `purchases.targetPrice`. Condition (record+cover, smallint 0–7) lives on `purchases`.
- **Only `withTenant`/`withSuperadmin`/`withOwner` touch tenant data.** Tenant-scoped reads use `withTenant({tenantId, userId})`; storefront public reads use `withTenant({tenantId, userId: null})`. Explicit `eq(x.tenantId, tenantId)` in every query (defence-in-depth alongside RLS).
- **No mutations in Slice 1.** Verkaufen/Ankauf/Vormerken/Benachrichtigen = disabled placeholder controls.
- **Public storefront leaks nothing private:** only title/artist/meta/availability — NEVER price, condition, EK, or internal status in the rendered output.
- **Reuse Slice-0 tokens + primitives verbatim** (`src/components/ui/*`, `src/styles/tokens.css`). No new raw hex; no inline focus/hover (use the focus utilities). A11y: text+icon+colour, `:focus-visible`, `--tap` min.
- TS strict, no `any`. `drizzle-kit generate` (never `push`). Commit per task (conventional commit) on `feat/v2-slice1-inventory`.
- URL filter params are strictly whitelisted/validated (enum/length) before hitting the DB.

## Task Order & Dependencies

1 Migration 0003 → 2 Inventory module → {3 Lagerbestand, 4 Dashboard} → 5 Storefront → 6 Seed → 7 E2E. Tasks 3/4 depend on 2; Task 5 is self-contained with its own test harness; Task 7 needs Task 6 seeded. Suggested execution = numeric.

---

## Tasks

- Task 1: Migration 0003: schema (copy-as-inventory) + consumer updates
- Task 2: Inventory query module
- Task 3: Lagerbestand screen
- Task 4: Dashboard (Übersicht)
- Task 5: Public storefront
- Task 6: Seed enrichment
- Task 7: E2E acceptance

---

### Task 1: Migration 0003: schema (copy-as-inventory) + consumer updates

Moves the inventory status off the catalog `records` row and onto the physical copy `purchases`: drops `records.record_status`, adds `purchases.status` (reusing the existing `record_status` enum) plus `condition_record` / `condition_cover` smallints with 0–7 CHECKs and two aggregate indexes. The `record_status` enum **type** stays (now used by `purchases.status`). Read the Global Constraints (copy-as-inventory) and PART C `src/db/schema.ts` section of the SPINE before starting.

**Files:**
- Modify: `src/db/schema.ts` (records −`recordStatus`; purchases +`status`/`conditionRecord`/`conditionCover` + CHECKs + indexes; add `export type RecordStatus`)
- Create (generated): `drizzle/0003_*.sql` + updated `drizzle/meta/_journal.json` + `drizzle/meta/0003_snapshot.json` (via `pnpm db:generate`)
- Modify: `scripts/seed.ts` (stop setting `recordStatus` on the record insert — do NOT create purchases yet; that is Task 6)
- Test: `tests/migration0003.integration.test.ts`
- No change needed: `src/app/s/[permalink]/page.tsx` selects only from `permalinks`, and `src/components/ui/StatusBadge.tsx` declares its own 4-value `RecordStatus` literal union (no reference to `records.recordStatus`). Verify this in Step 3 — do not edit them.

**Interfaces:**
- Consumes (Slice 0, verbatim): `recordStatusEnum = pgEnum('record_status', ['verfuegbar','reserviert','verkauft','verliehen'])`; `withTenant(ctx: { tenantId: number; userId: number | null }, fn)`; `setupTestDatabase(): Promise<TestDatabase>` + `seedTenant({ slug, name }): Promise<{ tenantId, adminUserId }>` from `tests/helpers/db.ts`; `assertDatabaseSafety(): Promise<void>` from `@/db/assertions`; `runMigrations(url?)` from `@/db/migrate`.
- Produces (later tasks rely on these — verbatim from SPINE PART C):
  - `records`: NO `recordStatus` column.
  - `export type RecordStatus = (typeof recordStatusEnum.enumValues)[number]` in `@/db/schema` (Task 2 `InventoryStatus = RecordStatus`).
  - `purchases.status: recordStatusEnum('status').notNull().default('verfuegbar')`, `purchases.conditionRecord: smallint('condition_record')` (nullable), `purchases.conditionCover: smallint('condition_cover')` (nullable); CHECK `condition_record/condition_cover BETWEEN 0 AND 7`; indexes `purchases_tenant_status_idx` on `(tenant_id, status)` and `purchases_record_idx` on `(record_id)`.

- [ ] **Step 1: Write the failing test**

Create `tests/migration0003.integration.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

// Migration 0003 — copy-as-inventory. Boots a real PG17 via the Slice-0 harness, runs ALL
// migrations (0000..0003) AS qr_owner, then asserts the schema move + the CHECK + a live
// withTenant insert + the boot drift-guard. Env is published by setupTestDatabase BEFORE any
// @/db import, so @/db/client/@/db/tenant/@/db/assertions/@/db/schema are pulled in via dynamic
// import() strictly afterwards.

let dbh: TestDatabase;
let tenantId: number;
let recordId: number;

beforeAll(async () => {
  dbh = await setupTestDatabase();
  const seeded = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantId = seeded.tenantId;

  const { ownerPool } = await import('@/db/client');
  const rec = await ownerPool.query<{ id: number }>(
    `INSERT INTO records (tenant_id, title, artist, hash)
       VALUES ($1, 'Kind of Blue', 'Miles Davis', 'm0003-hash') RETURNING id`,
    [tenantId],
  );
  recordId = Number(rec.rows[0].id);
}, 180_000);

afterAll(async () => {
  await dbh.teardown();
});

describe('migration 0003 — records.record_status removed', () => {
  it('records no longer has a record_status column (status moved to the copy)', async () => {
    const pool = new Pool({ connectionString: dbh.ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'records'`,
      );
      const names = rows.map((r) => r.column_name);
      expect(names).not.toContain('record_status');
      // sanity: the catalog columns we keep are still present
      expect(names).toEqual(expect.arrayContaining(['title', 'artist', 'label', 'genre', 'hash']));
    } finally {
      await pool.end();
    }
  });
});

describe('migration 0003 — purchases is the inventory copy', () => {
  it('purchases has status (default verfuegbar) + condition_record/condition_cover smallints', async () => {
    const pool = new Pool({ connectionString: dbh.ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query<{ column_name: string; data_type: string; column_default: string | null }>(
        `SELECT column_name, data_type, column_default
           FROM information_schema.columns WHERE table_name = 'purchases'`,
      );
      const byName = new Map(rows.map((r) => [r.column_name, r]));

      const status = byName.get('status');
      expect(status, 'purchases.status exists').toBeDefined();
      expect(status?.column_default ?? '').toContain('verfuegbar');

      const condR = byName.get('condition_record');
      expect(condR, 'purchases.condition_record exists').toBeDefined();
      expect(condR?.data_type).toBe('smallint');

      const condC = byName.get('condition_cover');
      expect(condC, 'purchases.condition_cover exists').toBeDefined();
      expect(condC?.data_type).toBe('smallint');
    } finally {
      await pool.end();
    }
  });

  it('rejects a condition outside 0..7 via the CHECK constraint', async () => {
    const { ownerPool } = await import('@/db/client');
    await expect(
      ownerPool.query(
        `INSERT INTO purchases (tenant_id, record_id, status, condition_record)
           VALUES ($1, $2, 'verfuegbar', 8)`,
        [tenantId, recordId],
      ),
    ).rejects.toThrow(/purchases_condition_record_range/);
  });

  it('a withTenant insert of a copy with status + conditions succeeds and defaults status to verfuegbar', async () => {
    const { withTenant } = await import('@/db/tenant');
    const { purchases } = await import('@/db/schema');

    // explicit status + both conditions
    const explicit = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .insert(purchases)
        .values({ tenantId, recordId, status: 'verliehen', conditionRecord: 6, conditionCover: 5 })
        .returning({ id: purchases.id, status: purchases.status }),
    );
    expect(explicit).toHaveLength(1);
    expect(explicit[0]?.status).toBe('verliehen');

    // omitted status → DB default 'verfuegbar'
    const defaulted = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .insert(purchases)
        .values({ tenantId, recordId })
        .returning({ status: purchases.status }),
    );
    expect(defaulted[0]?.status).toBe('verfuegbar');
  });
});

describe('migration 0003 — boot safety holds (no new tenant table)', () => {
  it('assertDatabaseSafety still passes (RLS + tenant-table drift guard)', async () => {
    const { assertDatabaseSafety } = await import('@/db/assertions');
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it (FAIL expected: `record_status` still on `records` / `purchases.status` undefined / no `0003` migration)**  Run: `pnpm test -- tests/migration0003.integration.test.ts`

- [ ] **Step 3: Implement**

3a. Update the `drizzle-orm/pg-core` import in `src/db/schema.ts` to add `check`, `index`, `smallint`:
```ts
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

3b. Add the `RecordStatus` type right after the `recordStatusEnum` declaration (the enum stays — it is now the type for `purchases.status`):
```ts
export const recordStatusEnum = pgEnum('record_status', [
  'verfuegbar',
  'reserviert',
  'verkauft',
  'verliehen',
]);
export type RecordStatus = (typeof recordStatusEnum.enumValues)[number];
```

3c. Remove `recordStatus` from the `records` table. Replace this block:
```ts
    /** sha256 hex — dedup key; see src/db/hash.ts */
    hash: varchar('hash', { length: 64 }).notNull(),
    recordStatus: recordStatusEnum('record_status')
      .notNull()
      .default('verfuegbar'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
```
with:
```ts
    /** sha256 hex — dedup key; see src/db/hash.ts */
    hash: varchar('hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
```

3d. Replace the entire `purchases` table definition with the copy-as-inventory shape (adds `status`/`conditionRecord`/`conditionCover` + CHECKs + indexes via the table-config callback):
```ts
export const purchases = pgTable(
  'purchases',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    recordId: integer('record_id')
      .notNull()
      .references(() => records.id),
    purchasePrice: numeric('purchase_price', { precision: 10, scale: 2 }),
    targetPrice: numeric('target_price', { precision: 10, scale: 2 }),
    soldPrice: numeric('sold_price', { precision: 10, scale: 2 }),
    soldDate: timestamp('sold_date', { withTimezone: true }),
    paymentMethod: text('payment_method'),
    // ── copy-as-inventory (Slice 1): status + condition live on the physical copy ──
    status: recordStatusEnum('status').notNull().default('verfuegbar'),
    conditionRecord: smallint('condition_record'),
    conditionCover: smallint('condition_cover'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('purchases_tenant_status_idx').on(t.tenantId, t.status),
    recordIdx: index('purchases_record_idx').on(t.recordId),
    conditionRecordRange: check(
      'purchases_condition_record_range',
      sql`${t.conditionRecord} BETWEEN 0 AND 7`,
    ),
    conditionCoverRange: check(
      'purchases_condition_cover_range',
      sql`${t.conditionCover} BETWEEN 0 AND 7`,
    ),
  }),
);
```

3e. Update the seed so the build stays green — `scripts/seed.ts` must stop setting `recordStatus` (full purchase/permalink enrichment is Task 6). Replace:
```ts
  await db.insert(schema.records).values({
    tenantId,
    title: rec.title,
    artist: rec.artist,
    label: rec.label,
    country: rec.country,
    releaseYear: rec.releaseYear,
    format: 'Vinyl',
    genre: [],
    hash,
    recordStatus: 'verfuegbar',
  });
```
with:
```ts
  await db.insert(schema.records).values({
    tenantId,
    title: rec.title,
    artist: rec.artist,
    label: rec.label,
    country: rec.country,
    releaseYear: rec.releaseYear,
    format: 'Vinyl',
    genre: [],
    hash,
  });
```

3f. Confirm no other consumer references the dropped column (must print nothing):
```bash
grep -rn "recordStatus\|record_status" src/ scripts/ | grep -v "recordStatusEnum\|pgEnum('record_status'"
```
(`src/app/s/[permalink]/page.tsx` reads only `permalinks`, and `src/components/ui/StatusBadge.tsx` keeps its own 4-value `RecordStatus` literal union — leave both untouched.)

3g. Generate the migration:
```bash
pnpm db:generate
```
This diffs `src/db/schema.ts` and writes `drizzle/0003_*.sql` + updates `drizzle/meta/_journal.json` and `drizzle/meta/0003_snapshot.json`. drizzle-kit may prompt whether `record_status` was *renamed* to a new column — answer **"create column"** (i.e. NOT a rename) for each of `status`, `condition_record`, `condition_cover`, so `record_status` is emitted as a `DROP COLUMN`. Open the generated `drizzle/0003_*.sql` and confirm it contains exactly these statements (append any missing CHECK/index statement by hand if drizzle omitted it):
```sql
ALTER TABLE "purchases" ADD COLUMN "status" "record_status" DEFAULT 'verfuegbar' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "condition_record" smallint;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "condition_cover" smallint;--> statement-breakpoint
ALTER TABLE "records" DROP COLUMN "record_status";--> statement-breakpoint
CREATE INDEX "purchases_tenant_status_idx" ON "purchases" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "purchases_record_idx" ON "purchases" USING btree ("record_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_condition_record_range" CHECK ("purchases"."condition_record" BETWEEN 0 AND 7);--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_condition_cover_range" CHECK ("purchases"."condition_cover" BETWEEN 0 AND 7);
```
The `record_status` enum **type** is intentionally NOT dropped (it now backs `purchases.status`).

- [ ] **Step 4: Run it (PASS)**  Run: `pnpm test -- tests/migration0003.integration.test.ts`
  Then confirm the whole gate is green:
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 5: Commit**
```bash
git add src/db/schema.ts scripts/seed.ts drizzle/0003_*.sql drizzle/meta/_journal.json drizzle/meta/0003_snapshot.json tests/migration0003.integration.test.ts
git commit -m "feat(slice1): migration 0003 — copy-as-inventory (purchases status/condition, drop records.recordStatus)"
```

**Acceptance:** `pnpm db:generate` produces a clean `0003` (records `DROP COLUMN record_status`; purchases `ADD` status/condition_record/condition_cover + CHECK 0..7 + two indexes); migrations apply clean on a fresh PG17; `records` has no `record_status` column; `purchases.status` defaults to `verfuegbar`; the CHECK rejects condition `8`; a `withTenant` copy insert succeeds; `assertDatabaseSafety()` (incl. tenant-table drift guard — no new tenant table added) still passes; `pnpm typecheck`/`lint`/`test`/`build` all green.

---

### Task 2: Inventory query module

Server-only data layer for the Lagerbestand screen + Dashboard. Implements the LOCKED query shapes from SPINE PART C: `listInventory` (one row per copy = `purchases ⋈ records`), `inventoryAggregates` (status counts/value/format-split/genre-options that ignore the status tab), and `parseInventoryFilters` (strict whitelist for URL params). All DB work runs inside `withTenant`; every query carries an explicit `eq(records.tenantId, ctx.tenantId)` (defence-in-depth alongside RLS). This task assumes Task 1's migration 0003 is applied (records has NO `record_status`; `purchases` has `status`/`condition_record`/`condition_cover`).

**Files:**
- Create: `src/lib/inventory.ts`
- Test: `tests/inventory.integration.test.ts`

**Interfaces:**
- Consumes (Slice-0 + Task 1, verbatim):
  - `withTenant<T>(ctx: { tenantId: number; userId: number | null }, fn: (tx: Tx) => Promise<T>): Promise<T>` from `@/db/tenant`
  - `withOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T>` from `@/db/tenant` (test seeding only)
  - schema `records`, `purchases` from `@/db/schema`; `purchases.status` (enum), `purchases.conditionRecord`, `purchases.conditionCover`, `purchases.purchasePrice` (EK), `purchases.targetPrice` (VK)
  - `RecordStatus = (typeof recordStatusEnum.enumValues)[number]` from `@/db/schema` (`'verfuegbar'|'reserviert'|'verkauft'|'verliehen'`)
  - test harness `setupTestDatabase()` + `seedTenant()` from `./helpers/db`
- Produces (later tasks 3 & 4 rely on these verbatim):
  - `export type InventoryStatus = RecordStatus`
  - `export type ConditionBand = 'mint_nm' | 'vgplus' | 'vg'`
  - `export type InventoryFilters = { q?: string; format?: string; genre?: string; condition?: ConditionBand; status?: InventoryStatus }`
  - `export type InventoryRow = { copyId; recordId; title; artist; label; releaseYear; country; format; genre; ek; vk; status; conditionRecord; conditionCover }` (exact shape below)
  - `export type InventoryAggregates = { total; byStatus; valueAvailable; formatSplit; genreOptions }`
  - `export async function listInventory(ctx: { tenantId: number; userId: number | null }, f: InventoryFilters): Promise<InventoryRow[]>`
  - `export async function inventoryAggregates(ctx: { tenantId: number; userId: number | null }, f: InventoryFilters): Promise<InventoryAggregates>`
  - `export function parseInventoryFilters(sp: Record<string, string | string[] | undefined>): InventoryFilters`

---

- [ ] **Step 1: Write the failing test**

Create `tests/inventory.integration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it (FAIL expected: `Cannot find module '@/lib/inventory'` / import resolution error)**  Run: `pnpm test tests/inventory.integration.test.ts`

- [ ] **Step 3: Implement**

Create `src/lib/inventory.ts`:

```ts
import 'server-only';
import { and, asc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';
import { records, purchases, type RecordStatus } from '@/db/schema';

export type InventoryStatus = RecordStatus; // 'verfuegbar'|'reserviert'|'verkauft'|'verliehen'
export type ConditionBand = 'mint_nm' | 'vgplus' | 'vg'; // ≥6, ≥5, ≥4 on conditionRecord

export type InventoryFilters = {
  q?: string;
  format?: string;
  genre?: string;
  condition?: ConditionBand;
  status?: InventoryStatus;
};

export type InventoryRow = {
  copyId: number;
  recordId: number;
  title: string;
  artist: string;
  label: string[];
  releaseYear: number | null;
  country: string | null;
  format: string | null;
  genre: string[];
  ek: string | null; // numeric(10,2) → string from pg
  vk: string | null;
  status: InventoryStatus;
  conditionRecord: number | null;
  conditionCover: number | null;
};

export type InventoryAggregates = {
  total: number;
  byStatus: Record<InventoryStatus, number>;
  valueAvailable: number; // Σ vk of 'verfuegbar' copies in the q+filter set (euros)
  formatSplit: { vinyl: number; cd: number; other: number };
  genreOptions: string[];
};

const CONDITION_BANDS: Record<ConditionBand, number> = { mint_nm: 6, vgplus: 5, vg: 4 };
const KNOWN_FORMATS = ['Vinyl', 'CD', 'Kassette'] as const;
const STATUS_VALUES: readonly InventoryStatus[] = ['verfuegbar', 'reserviert', 'verkauft', 'verliehen'];

/** base predicates (tenant + q + format + genre + condition) — the status tab is NEVER part of this set. */
function basePreds(tenantId: number, f: InventoryFilters): SQL[] {
  const preds: SQL[] = [
    eq(records.tenantId, tenantId),
    eq(purchases.tenantId, tenantId), // defence-in-depth alongside RLS (Global Constraint)
  ];
  if (f.q) {
    const esc = f.q.replace(/[\\%_]/g, (c) => '\\' + c);
    const like = `%${esc}%`;
    preds.push(
      sql`(${records.title} ILIKE ${like} OR ${records.artist} ILIKE ${like} OR array_to_string(${records.label}, ' ') ILIKE ${like})`,
    );
  }
  if (f.format) preds.push(eq(records.format, f.format));
  if (f.genre) preds.push(sql`${f.genre} = ANY(${records.genre})`);
  if (f.condition) preds.push(gte(purchases.conditionRecord, CONDITION_BANDS[f.condition]));
  return preds;
}

export async function listInventory(
  ctx: { tenantId: number; userId: number | null },
  f: InventoryFilters,
): Promise<InventoryRow[]> {
  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const preds = basePreds(ctx.tenantId, f);
    if (f.status) preds.push(eq(purchases.status, f.status));
    return tx
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
      })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(and(...preds))
      .orderBy(asc(records.artist), asc(records.title));
  });
}

export async function inventoryAggregates(
  ctx: { tenantId: number; userId: number | null },
  f: InventoryFilters,
): Promise<InventoryAggregates> {
  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const preds = basePreds(ctx.tenantId, f); // NB: status intentionally excluded

    // byStatus + total — counts within the q+filter set, grouped by status.
    const statusRows = await tx
      .select({ status: purchases.status, count: sql<number>`count(*)::int` })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(and(...preds))
      .groupBy(purchases.status);

    const byStatus: Record<InventoryStatus, number> = {
      verfuegbar: 0,
      reserviert: 0,
      verkauft: 0,
      verliehen: 0,
    };
    let total = 0;
    for (const r of statusRows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }

    // valueAvailable + formatSplit — verfuegbar copies only, within the same q+filter set.
    const availRows = await tx
      .select({ format: records.format, vk: purchases.targetPrice })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(and(...preds, eq(purchases.status, 'verfuegbar')));

    let valueAvailable = 0;
    const formatSplit = { vinyl: 0, cd: 0, other: 0 };
    for (const r of availRows) {
      if (r.vk) valueAvailable += Number(r.vk);
      if (r.format === 'Vinyl') formatSplit.vinyl += 1;
      else if (r.format === 'CD') formatSplit.cd += 1;
      else formatSplit.other += 1;
    }

    // genreOptions — distinct genres present for the tenant, independent of the active filters.
    const genreRes = await tx.execute(
      sql`SELECT DISTINCT unnest(genre) AS g FROM records WHERE tenant_id = ${ctx.tenantId} ORDER BY g`,
    );
    const genreOptions = (genreRes.rows as { g: string }[]).map((row) => row.g);

    return { total, byStatus, valueAvailable, formatSplit, genreOptions };
  });
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseInventoryFilters(
  sp: Record<string, string | string[] | undefined>,
): InventoryFilters {
  const out: InventoryFilters = {};

  const q = first(sp.q);
  if (q) {
    const trimmed = q.trim().slice(0, 80);
    if (trimmed) out.q = trimmed;
  }

  const format = first(sp.format);
  if (format && (KNOWN_FORMATS as readonly string[]).includes(format)) out.format = format;

  const genre = first(sp.genre);
  if (genre && genre.trim().length > 0) out.genre = genre.trim();

  const condition = first(sp.condition);
  if (condition && condition in CONDITION_BANDS) out.condition = condition as ConditionBand;

  const status = first(sp.status);
  if (status && (STATUS_VALUES as readonly string[]).includes(status)) {
    out.status = status as InventoryStatus;
  }

  return out;
}
```

- [ ] **Step 4: Run it (PASS)**  Run: `pnpm test tests/inventory.integration.test.ts` then `pnpm typecheck && pnpm lint`

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory.ts tests/inventory.integration.test.ts
git commit -m "feat(slice1): inventory query module (listInventory/inventoryAggregates/parseInventoryFilters)"
```

**Acceptance:** `pnpm test tests/inventory.integration.test.ts` green; aggregates equal the hand-computed seed numbers (total 5, byStatus {verfuegbar:3,reserviert:0,verkauft:1,verliehen:1}, valueAvailable 63, formatSplit {vinyl:2,cd:1,other:0}, genreOptions ['Electronic','Jazz','Rock']); RLS proven (tenant A never sees 'Blue Train', tenant B sees only its copy); status tab ignored in aggregates; `parseInventoryFilters` drops bad input and caps q at 80; `pnpm typecheck` + `pnpm lint` green (TS strict, no `any`). Only `withTenant` touches tenant data; every query carries explicit `eq(records.tenantId, ctx.tenantId)`.

---

### Task 3: Lagerbestand screen

**Files:**
- Rebuild: `src/app/(app)/inventar/page.tsx`
- Create: `src/app/(app)/inventar/_components/FilterBar.tsx`
- Create: `src/app/(app)/inventar/_components/StatusTabs.tsx`
- Create: `src/app/(app)/inventar/_components/ViewToggle.tsx`
- Create: `src/app/(app)/inventar/_components/InventoryList.tsx`
- Create: `src/app/(app)/inventar/_components/InventoryTiles.tsx`
- Test: `tests/inventar/lagerbestand.test.tsx`

**Interfaces:**

Consumes from SPINE Part C (`src/lib/inventory.ts`, Task 2):
```ts
export type InventoryStatus = RecordStatus; // 'verfuegbar'|'reserviert'|'verkauft'|'verliehen'
export type ConditionBand = 'mint_nm' | 'vgplus' | 'vg';
export type InventoryFilters = { q?: string; format?: string; genre?: string; condition?: ConditionBand; status?: InventoryStatus };
export type InventoryRow = {
  copyId: number; recordId: number; title: string; artist: string; label: string[];
  releaseYear: number | null; country: string | null; format: string | null; genre: string[];
  ek: string | null; vk: string | null;
  status: InventoryStatus; conditionRecord: number | null; conditionCover: number | null;
};
export type InventoryAggregates = {
  total: number;
  byStatus: Record<InventoryStatus, number>;
  valueAvailable: number;
  formatSplit: { vinyl: number; cd: number; other: number };
  genreOptions: string[];
};
export async function listInventory(ctx: { tenantId: number; userId: number | null }, f: InventoryFilters): Promise<InventoryRow[]>;
export async function inventoryAggregates(ctx: { tenantId: number; userId: number | null }, f: InventoryFilters): Promise<InventoryAggregates>;
export function parseInventoryFilters(sp: Record<string, string | string[] | undefined>): InventoryFilters;
```

Consumes from Slice 0:
- `requireSession(): Promise<SessionUser>` from `@/auth/session` — `{ id: number; tenantId: number; email: string; role: Role; isSuperadmin: boolean }`
- `getCurrentTenant(): Promise<Tenant>` from `@/lib/tenant` — `{ id: number; name: string; ... }`
- `StatusBadge`, `ConditionPill`, `SegmentedControl`, `SearchField`, `Select` from `@/components/ui/*`
- Design tokens from `src/styles/tokens.css` — use verbatim, no new raw hex

Produces (contract for Task 7 E2E):
- `/inventar` renders a `<table>` in list view; `role="article"` cards in tile view
- FilterBar: `aria-label` on each Select (`"Format filtern"`, `"Genre filtern"`, `"Zustand filtern"`); barcode button `aria-label="Barcode scannen"` disabled
- StatusTabs: `aria-pressed` on active pill button
- Empty state: contains text `"Kein Treffer im Sortiment"`
- Verkauft rows in list view: `opacity: 0.62`; disabled Aktion button

---

- [ ] **Step 1: Write the failing test**

Create `tests/inventar/lagerbestand.test.tsx`:

```tsx
// tests/inventar/lagerbestand.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach as _ae } from 'vitest';

// Components under test — imported AFTER env, no async DB imports here
import { InventoryList } from '@/app/(app)/inventar/_components/InventoryList';
import { InventoryTiles } from '@/app/(app)/inventar/_components/InventoryTiles';
import { ViewToggle } from '@/app/(app)/inventar/_components/ViewToggle';
import type { InventoryRow } from '@/lib/inventory';

afterEach(cleanup);

const ROWS: InventoryRow[] = [
  {
    copyId: 1,
    recordId: 10,
    title: 'Violator',
    artist: 'Depeche Mode',
    label: ['Mute'],
    releaseYear: 1990,
    country: 'DE',
    format: 'Vinyl',
    genre: ['Electronic'],
    ek: '8.00',
    vk: '28.00',
    status: 'verfuegbar',
    conditionRecord: 5,
    conditionCover: 5,
  },
  {
    copyId: 2,
    recordId: 11,
    title: 'Remain in Light',
    artist: 'Talking Heads',
    label: ['Sire'],
    releaseYear: 1980,
    country: 'US',
    format: 'Vinyl',
    genre: ['Rock'],
    ek: '5.00',
    vk: '22.00',
    status: 'verkauft',
    conditionRecord: 4,
    conditionCover: 3,
  },
];

// ── InventoryList smoke ────────────────────────────────────────────────────────

describe('InventoryList', () => {
  it('renders a <table> with correct column headers', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Artikel')).toBeInTheDocument();
    expect(screen.getByText('Zustand')).toBeInTheDocument();
    expect(screen.getByText('EK / VK')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Aktion')).toBeInTheDocument();
  });

  it('shows title and artist for each row', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.getByText('Violator')).toBeInTheDocument();
    expect(screen.getByText('Depeche Mode')).toBeInTheDocument();
    expect(screen.getByText('Remain in Light')).toBeInTheDocument();
    expect(screen.getByText('Talking Heads')).toBeInTheDocument();
  });

  it('shows EK and VK values', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.getByText('8.00')).toBeInTheDocument();
    expect(screen.getByText('28.00')).toBeInTheDocument();
  });

  it('renders StatusBadge with correct label', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.getByText('im Lager')).toBeInTheDocument();
    expect(screen.getByText('Verkauft')).toBeInTheDocument();
  });

  it('renders ConditionPill for rows with conditionRecord', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    // conditionRecord=5 → VG+, conditionRecord=4 → VG
    expect(screen.getByText('VG+')).toBeInTheDocument();
    expect(screen.getByText('VG')).toBeInTheDocument();
  });

  it('applies opacity .62 to verkauft rows', () => {
    const { container } = render(<InventoryList rows={ROWS} total={ROWS.length} />);
    const rows = container.querySelectorAll('tbody tr');
    // First row (verfuegbar): opacity 1 (or default)
    expect((rows[0] as HTMLElement).style.opacity).toBe('');
    // Second row (verkauft): opacity 0.62
    expect((rows[1] as HTMLElement).style.opacity).toBe('0.62');
  });

  it('all Aktion buttons are disabled (no mutations in Slice 1)', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    const btns = screen.getAllByRole('button', { name: /Verkauf/i });
    btns.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('shows footer with row count', () => {
    render(<InventoryList rows={ROWS} total={10} />);
    expect(screen.getByText(/2 von 10/)).toBeInTheDocument();
  });

  it('shows — for null EK/VK', () => {
    const rowsWithNull: InventoryRow[] = [
      { ...ROWS[0], ek: null, vk: null },
    ];
    render(<InventoryList rows={rowsWithNull} total={1} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders nothing for null conditionRecord (no pill)', () => {
    const rowsNoCond: InventoryRow[] = [
      { ...ROWS[0], conditionRecord: null },
    ];
    const { container } = render(<InventoryList rows={rowsNoCond} total={1} />);
    // VG+ won't be in document
    expect(container.querySelector('[class*="pill"]')).toBeNull();
    expect(screen.queryByText('VG+')).not.toBeInTheDocument();
  });
});

// ── InventoryTiles smoke ───────────────────────────────────────────────────────

describe('InventoryTiles', () => {
  it('renders article cards for each row', () => {
    render(<InventoryTiles rows={ROWS} />);
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(ROWS.length);
  });

  it('shows title and artist in each card', () => {
    render(<InventoryTiles rows={ROWS} />);
    expect(screen.getByText('Violator')).toBeInTheDocument();
    expect(screen.getByText('Depeche Mode')).toBeInTheDocument();
  });

  it('all Aktion buttons are disabled', () => {
    render(<InventoryTiles rows={ROWS} />);
    const btns = screen.getAllByRole('button', { name: /Verkauf/i });
    btns.forEach((btn) => expect(btn).toBeDisabled());
  });
});

// ── ViewToggle ─────────────────────────────────────────────────────────────────

describe('ViewToggle', () => {
  it('defaults to list view — renders a table', () => {
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('switches to tile view on Kacheln click — shows article cards, no table', async () => {
    const user = userEvent.setup();
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    await user.click(screen.getByRole('radio', { name: /Kacheln/i }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(ROWS.length);
  });

  it('switches back to list on Liste click', async () => {
    const user = userEvent.setup();
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    await user.click(screen.getByRole('radio', { name: /Kacheln/i }));
    await user.click(screen.getByRole('radio', { name: /Liste/i }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows SegmentedControl radiogroup for view toggle', () => {
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe('Empty state', () => {
  it('shows empty state card when rows is empty', () => {
    render(<ViewToggle rows={[]} total={0} />);
    expect(screen.getByText('Kein Treffer im Sortiment')).toBeInTheDocument();
  });

  it('empty state does not render a table or articles', () => {
    render(<ViewToggle rows={[]} total={0} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('empty state shows a reset link', () => {
    render(<ViewToggle rows={[]} total={0} />);
    expect(screen.getByRole('link', { name: /Filter zurücksetzen/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (FAIL expected: "Cannot find module '@/app/(app)/inventar/_components/InventoryList'")**

```bash
pnpm test tests/inventar/lagerbestand.test.tsx
```

- [ ] **Step 3: Implement InventoryList, InventoryTiles, ViewToggle**

**3a. `src/app/(app)/inventar/_components/InventoryList.tsx`**

Columns verbatim from `Q-Records App.dc.html` lines 296–319 (Lagerbestand table section):
- Artikel | Jahr · Label | Zustand | EK / VK | Status | Aktion
- Verkauft rows: `opacity: 0.62`. All Aktion buttons `disabled`.

```tsx
import type { InventoryRow } from '@/lib/inventory';
import type { Condition } from '@/components/ui/ConditionPill';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConditionPill } from '@/components/ui/ConditionPill';

export interface InventoryListProps {
  rows: InventoryRow[];
  total: number; // from inventoryAggregates.total (ignores status tab) → footer
}

export function InventoryList({ rows, total }: InventoryListProps) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-1)',
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 14,
            minWidth: 720,
          }}
        >
          <thead>
            <tr
              style={{
                textAlign: 'left',
                color: 'var(--text-3)',
                background: 'var(--surface-2)',
              }}
            >
              <th
                scope="col"
                style={{
                  padding: '12px 18px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                Artikel
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 12px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                Jahr · Label
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 12px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                Zustand
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 12px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  textAlign: 'right',
                }}
              >
                EK / VK
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 12px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                Status
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 18px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  textAlign: 'right',
                }}
              >
                Aktion
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.copyId}
                style={{
                  borderTop: '1px solid var(--border)',
                  opacity: row.status === 'verkauft' ? 0.62 : undefined,
                }}
              >
                {/* Artikel: 36×36 cover thumb + title + artist */}
                <td style={{ padding: '13px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Cover thumbnail — hatched placeholder (36×36, r-xs=6px) */}
                    <span
                      aria-hidden="true"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 6,
                        flexShrink: 0,
                        background:
                          'repeating-linear-gradient(135deg,var(--surface-3) 0 5px,var(--surface-2) 5px 10px)',
                      }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ fontWeight: 700 }}>{row.title}</strong>
                      <br />
                      <span style={{ color: 'var(--text-2)', fontSize: 13 }}>
                        {row.artist}
                      </span>
                    </span>
                  </div>
                </td>

                {/* Jahr · Label */}
                <td
                  style={{
                    padding: '13px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12.5px',
                    color: 'var(--text-2)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {[row.releaseYear, row.label.join('/')]
                    .filter(Boolean)
                    .join(' · ')}
                </td>

                {/* Zustand — ConditionPill on conditionRecord */}
                <td style={{ padding: '13px 12px' }}>
                  {row.conditionRecord !== null && (
                    <ConditionPill condition={row.conditionRecord as Condition} />
                  )}
                </td>

                {/* EK / VK — right-aligned, mono */}
                <td
                  style={{
                    padding: '13px 12px',
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: 'var(--text-3)' }}>{row.ek ?? '—'}</span>
                  {' · '}
                  <strong style={{ fontWeight: 700 }}>{row.vk ?? '—'}</strong>
                </td>

                {/* Status — StatusBadge (dot + label) */}
                <td style={{ padding: '13px 12px' }}>
                  <StatusBadge status={row.status} />
                </td>

                {/* Aktion — disabled placeholder (no mutations in Slice 1) */}
                <td style={{ padding: '13px 18px', textAlign: 'right' }}>
                  <button
                    type="button"
                    disabled
                    style={{
                      minHeight: 34,
                      padding: '0 14px',
                      border: 'none',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--surface-3)',
                      color: 'var(--text-3)',
                      fontFamily: 'var(--font-body)',
                      fontWeight: 600,
                      fontSize: '12.5px',
                      cursor: 'not-allowed',
                    }}
                  >
                    {row.status === 'verkauft' ? 'Verkauft' : 'Verkaufen'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: n von total + mobile hint */}
      <div
        style={{
          padding: '13px 18px',
          borderTop: '1px solid var(--border)',
          fontSize: '12.5px',
          color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          {rows.length} von {total}
        </span>
        <span>↔ scrollt auf Mobile</span>
      </div>
    </div>
  );
}
```

**3b. `src/app/(app)/inventar/_components/InventoryTiles.tsx`**

> **Prerequisite — extend Slice-0 primitive:** Before implementing InventoryTiles, add an optional `labelColor?: string` prop to `src/components/ui/VinylDisc.tsx` (default keeps the existing `--disc-label` token so the sidebar logo is unchanged). The prop controls the label-ring gradient stop, enabling format-aware disc colours on both the Lagerbestand tiles and the public storefront without duplicating disc-rendering logic.

Tile header: `aspect-ratio:1.9`, cover at 62% width, disc peeking from `right:-26%` at 64% width — verbatim from `Q-Records App.dc.html` lines 269–288 (LAGERBESTAND tile section, NOT the storefront 1:1 card). Disc label-ring colour: Vinyl→`var(--accent)`, CD→`var(--info)`, else `var(--disc-label)` — passed via the `labelColor` prop of the `VinylDisc` Slice-0 primitive (do NOT inline a raw disc div; reuse the primitive verbatim).

```tsx
import type { InventoryRow } from '@/lib/inventory';
import type { Condition } from '@/components/ui/ConditionPill';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConditionPill } from '@/components/ui/ConditionPill';
import { VinylDisc } from '@/components/ui/VinylDisc';

export interface InventoryTilesProps {
  rows: InventoryRow[];
}

export function InventoryTiles({ rows }: InventoryTilesProps) {
  return (
    <div
      data-testid="inventory-tiles"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))',
        gap: 16,
      }}
    >
      {rows.map((row) => (
        <article
          key={row.copyId}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-1)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            opacity: row.status === 'verkauft' ? 0.62 : undefined,
          }}
        >
          {/* Card header — aspect-ratio:1.9, 62% cover, disc from right:-26% */}
          <div style={{ position: 'relative', aspectRatio: '1.9', overflow: 'hidden' }}>
            {/* Disc peeking from right — VinylDisc primitive with format-aware labelColor */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: '-26%',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '64%',
              }}
            >
              <VinylDisc
                size={160}
                variant="card"
                labelColor={row.format === 'Vinyl' ? 'var(--accent)' : row.format === 'CD' ? 'var(--info)' : 'var(--disc-label)'}
              />
            </div>
            {/* Cover placeholder — 62% of width, hatched */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: '62%',
                background:
                  'repeating-linear-gradient(135deg,var(--surface-3) 0 11px,var(--surface-2) 11px 22px)',
                display: 'grid',
                placeItems: 'center',
                borderRight: '1px solid var(--border)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-3)',
                }}
              >
                cover
              </span>
            </div>
            {/* StatusBadge overlay — top-left, backdrop-blur */}
            <span
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
              }}
            >
              <StatusBadge status={row.status} />
            </span>
          </div>

          {/* Card body */}
          <div
            style={{
              padding: '14px 16px 16px',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
            }}
          >
            {/* Title + artist row, ConditionPill top-right */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '16.5px',
                    lineHeight: 1.2,
                    letterSpacing: '-.01em',
                  }}
                >
                  {row.title}
                </div>
                <div
                  style={{
                    fontSize: '13.5px',
                    color: 'var(--text-2)',
                    marginTop: 2,
                  }}
                >
                  {row.artist}
                </div>
              </div>
              {row.conditionRecord !== null && (
                <span style={{ flexShrink: 0 }}>
                  <ConditionPill condition={row.conditionRecord as Condition} />
                </span>
              )}
            </div>

            {/* Meta: Jahr · Label · Format */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11.5px',
                color: 'var(--text-3)',
                marginTop: 8,
              }}
            >
              {[row.releaseYear, row.label.join('/'), row.format]
                .filter(Boolean)
                .join(' · ')}
            </div>

            {/* EK · VK + disabled Aktion button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginTop: 'auto',
                paddingTop: 14,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                }}
              >
                <span style={{ color: 'var(--text-3)' }}>EK {row.ek ?? '—'}</span>
                {' · '}
                <strong style={{ fontWeight: 700, fontSize: 17 }}>
                  {row.vk ?? '—'}
                </strong>
              </span>
              <button
                type="button"
                disabled
                style={{
                  minHeight: 34,
                  padding: '0 12px',
                  border: 'none',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--surface-3)',
                  color: 'var(--text-3)',
                  fontFamily: 'var(--font-body)',
                  fontWeight: 600,
                  fontSize: '12.5px',
                  cursor: 'not-allowed',
                }}
              >
                {row.status === 'verkauft' ? 'Verkauft' : 'Verkaufen'}
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
```

**3c. `src/app/(app)/inventar/_components/ViewToggle.tsx`**

Client component: holds `view` state, renders SegmentedControl + InventoryList/InventoryTiles or empty state when `rows.length === 0`. Empty state verbatim from handoff lines 257-263.

```tsx
'use client';

import { useState } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { InventoryList } from './InventoryList';
import { InventoryTiles } from './InventoryTiles';
import type { InventoryRow } from '@/lib/inventory';

const VIEW_OPTIONS = [
  { value: 'list', label: '☰ Liste' },
  { value: 'tiles', label: '▦ Kacheln' },
];

export interface ViewToggleProps {
  rows: InventoryRow[];
  total: number;
}

export function ViewToggle({ rows, total }: ViewToggleProps) {
  const [view, setView] = useState<'list' | 'tiles'>('list');

  // Empty state (verbatim from Q-Records App.dc.html lines 257-263)
  if (rows.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--text-3)',
        }}
      >
        <div aria-hidden="true" style={{ fontSize: 34, marginBottom: 8 }}>
          ⌕
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 17,
            color: 'var(--text-2)',
          }}
        >
          Kein Treffer im Sortiment
        </div>
        <p
          style={{
            fontSize: '13.5px',
            lineHeight: 1.6,
            margin: '6px auto 16px',
            maxWidth: '38ch',
          }}
        >
          Andere Schreibweise probieren, Filter lockern — oder die Platte direkt
          über die Discogs-Suche ankaufen.
        </p>
        {/* Link clears all params — works as a plain anchor for the reset */}
        <a
          href="/inventar"
          className="focus-ring-button"
          style={{
            display: 'inline-block',
            minHeight: 40,
            padding: '0 18px',
            lineHeight: '40px',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-pill)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          Filter zurücksetzen
        </a>
      </div>
    );
  }

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
    </div>
  );
}
```

- [ ] **Step 4: Run it (PASS)**

```bash
pnpm test tests/inventar/lagerbestand.test.tsx
```

- [ ] **Step 5: Implement FilterBar, StatusTabs, and page.tsx**

**5a. `src/app/(app)/inventar/_components/FilterBar.tsx`**

Client component; debounced `q` state pushes to URL after 300 ms. Select changes push immediately. Zurücksetzen navigates to bare `/inventar`.

```tsx
'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useEffect } from 'react';
import { SearchField } from '@/components/ui/SearchField';
import { Select } from '@/components/ui/Select';

const FORMAT_OPTIONS = [
  { value: '', label: 'Alle Formate' },
  { value: 'Vinyl', label: 'Vinyl' },
  { value: 'CD', label: 'CD' },
  { value: 'Kassette', label: 'Kassette' },
];

const CONDITION_OPTIONS = [
  { value: '', label: 'Jeder Zustand' },
  { value: 'mint_nm', label: 'Mint – NM (≥6)' },
  { value: 'vgplus', label: 'VG+ und besser (≥5)' },
  { value: 'vg', label: 'VG und besser (≥4)' },
];

export interface FilterBarProps {
  genreOptions: string[];
  resultCount: number;
  valueAvailable: number;
}

export function FilterBar({ genreOptions, resultCount, valueAvailable }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Controlled search field — debounced URL push
  const [q, setQ] = useState(searchParams.get('q') ?? '');

  // Keep local q in sync on URL change (back-navigation, StatusTabs push, etc.)
  useEffect(() => {
    setQ(searchParams.get('q') ?? '');
  }, [searchParams]);

  // Debounce: push URL 300 ms after q changes, skip if already matches URL
  useEffect(() => {
    const trimmed = q.trim();
    const urlQ = searchParams.get('q') ?? '';
    if (trimmed === urlQ) return;
    const tid = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed) {
        params.set('q', trimmed);
      } else {
        params.delete('q');
      }
      router.push(`${pathname}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]); // intentionally only q — avoid infinite loop from searchParams/router/pathname deps

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const reset = useCallback(() => {
    router.push(pathname);
  }, [router, pathname]);

  const genreSelectOptions = [
    { value: '', label: 'Alle Genres' },
    ...genreOptions.map((g) => ({ value: g, label: g })),
  ];

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-1)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Row 1: search + barcode placeholder */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 230 }}>
          <SearchField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Im Sortiment suchen — Titel, Artist, Label, Katalog-Nr…"
          />
        </div>
        {/* Barcode scanner — disabled placeholder (Slice 5) */}
        <button
          type="button"
          aria-label="Barcode scannen"
          disabled
          style={{
            flexShrink: 0,
            width: 'var(--tap)',
            height: 'var(--tap)',
            border: 'none',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-3)',
            color: 'var(--text-3)',
            fontSize: 21,
            display: 'grid',
            placeItems: 'center',
            cursor: 'not-allowed',
          }}
        >
          ▥
        </button>
      </div>

      {/* Row 2: selects + reset + count/value */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          options={FORMAT_OPTIONS}
          value={searchParams.get('format') ?? ''}
          onChange={(v) => setParam('format', v)}
          aria-label="Format filtern"
          style={{ minWidth: 140 }}
        />
        <Select
          options={genreSelectOptions}
          value={searchParams.get('genre') ?? ''}
          onChange={(v) => setParam('genre', v)}
          aria-label="Genre filtern"
          style={{ minWidth: 150 }}
        />
        <Select
          options={CONDITION_OPTIONS}
          value={searchParams.get('condition') ?? ''}
          onChange={(v) => setParam('condition', v)}
          aria-label="Zustand filtern"
          style={{ minWidth: 180 }}
        />
        <button
          type="button"
          onClick={reset}
          className="focus-ring-button"
          style={{
            minHeight: 40,
            padding: '0 14px',
            border: 'none',
            borderRadius: 'var(--r-pill)',
            background: 'transparent',
            color: 'var(--accent-ink)',
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Zurücksetzen
        </button>
        {/* Treffer + Wert (server-computed, SSR-updated on each URL change) */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              color: 'var(--text-3)',
            }}
          >
            <strong style={{ color: 'var(--text)' }}>{resultCount}</strong> Treffer
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              color: 'var(--text-3)',
            }}
          >
            Wert{' '}
            <strong style={{ color: 'var(--text)' }}>
              € {valueAvailable.toFixed(2)}
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
}
```

**5b. `src/app/(app)/inventar/_components/StatusTabs.tsx`**

Tabs: Alle / im Lager / Verliehen / Verkauft. Reserviert has no own tab (shown in Alle via StatusBadge). Active tab: `--accent` bg / `--on-accent` text. Counts from `byStatus` (Alle = `total` which ignores the status tab).

```tsx
'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { InventoryStatus } from '@/lib/inventory';

type TabValue = InventoryStatus | '';

interface TabDef {
  label: string;
  value: TabValue;
}

const TABS: TabDef[] = [
  { label: 'Alle', value: '' },
  { label: 'im Lager', value: 'verfuegbar' },
  { label: 'Verliehen', value: 'verliehen' },
  { label: 'Verkauft', value: 'verkauft' },
];

export interface StatusTabsProps {
  byStatus: Record<InventoryStatus, number>;
  total: number; // count matching q+format+genre+condition, ignoring status tab
}

export function StatusTabs({ byStatus, total }: StatusTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get('status') ?? '') as TabValue;

  const setStatus = useCallback(
    (value: TabValue) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set('status', value);
      } else {
        params.delete('status');
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const countFor = (value: TabValue): number => {
    if (value === '') return total;
    return byStatus[value] ?? 0;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {TABS.map((tab) => {
        const active = current === tab.value;
        return (
          <button
            key={tab.value || 'alle'}
            type="button"
            onClick={() => setStatus(tab.value)}
            aria-pressed={active}
            className="focus-ring-button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 14px',
              minHeight: 'var(--tap)',
              borderRadius: 'var(--r-pill)',
              border: active ? 'none' : '1px solid var(--border-strong)',
              background: active ? 'var(--accent)' : 'var(--surface)',
              color: active ? 'var(--on-accent)' : 'var(--text-2)',
              fontFamily: 'var(--font-body)',
              fontWeight: active ? 700 : 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {tab.label}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                opacity: 0.7,
                fontSize: 12,
              }}
            >
              {countFor(tab.value)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

**5c. `src/app/(app)/inventar/page.tsx`** (rebuild)

React Server Component. Next.js 15 async `searchParams`. Fetches `listInventory` + `inventoryAggregates` in parallel via `Promise.all`. Passes data to client children as serializable props.

```tsx
// src/app/(app)/inventar/page.tsx
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import {
  listInventory,
  inventoryAggregates,
  parseInventoryFilters,
} from '@/lib/inventory';
import { FilterBar } from './_components/FilterBar';
import { StatusTabs } from './_components/StatusTabs';
import { ViewToggle } from './_components/ViewToggle';

export default async function InventarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // requireSession: auth gate + tenant↔session invariant check
  const user = await requireSession();
  // getCurrentTenant: React cache — deduped within this request
  const tenant = await getCurrentTenant();

  const sp = await searchParams;
  const filters = parseInventoryFilters(sp);

  // Explicit tenantId in ctx (defence-in-depth alongside RLS per Global Constraints)
  const ctx = { tenantId: tenant.id, userId: user.id };

  // Parallel fetch — both are read-only; no shared write-state risk.
  // Note: two short read transactions per request are acceptable for Slice 1 (read-only, no concurrent writes);
  // single-withTenant-pass optimisation (exposing _tx variants) is deferred to a later slice.
  const [rows, aggs] = await Promise.all([
    listInventory(ctx, filters),
    inventoryAggregates(ctx, filters),
  ]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1200,
      }}
    >
      {/* Filter card: search + barcode + format/genre/condition + treffer/wert */}
      <FilterBar
        genreOptions={aggs.genreOptions}
        resultCount={aggs.total}
        valueAvailable={aggs.valueAvailable}
      />

      {/* Status tabs: Alle / im Lager / Verliehen / Verkauft with counts */}
      <StatusTabs byStatus={aggs.byStatus} total={aggs.total} />

      {/* List/tile toggle + active view + empty state */}
      <ViewToggle rows={rows} total={aggs.total} />
    </div>
  );
}
```

- [ ] **Step 6: Typecheck, lint, and build (PASS)**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: zero errors. If `@/lib/inventory` does not exist yet (Task 2 not merged), stub it:

```ts
// src/lib/inventory.ts — STUB (replace with Task 2 implementation before merging)
import 'server-only';
export type InventoryStatus = 'verfuegbar' | 'reserviert' | 'verkauft' | 'verliehen';
export type ConditionBand = 'mint_nm' | 'vgplus' | 'vg';
export type InventoryFilters = { q?: string; format?: string; genre?: string; condition?: ConditionBand; status?: InventoryStatus };
export type InventoryRow = {
  copyId: number; recordId: number; title: string; artist: string; label: string[];
  releaseYear: number | null; country: string | null; format: string | null; genre: string[];
  ek: string | null; vk: string | null;
  status: InventoryStatus; conditionRecord: number | null; conditionCover: number | null;
};
export type InventoryAggregates = {
  total: number;
  byStatus: Record<InventoryStatus, number>;
  valueAvailable: number;
  formatSplit: { vinyl: number; cd: number; other: number };
  genreOptions: string[];
};
export async function listInventory(_ctx: { tenantId: number; userId: number | null }, _f: InventoryFilters): Promise<InventoryRow[]> { return []; }
export async function inventoryAggregates(_ctx: { tenantId: number; userId: number | null }, _f: InventoryFilters): Promise<InventoryAggregates> {
  return { total: 0, byStatus: { verfuegbar: 0, reserviert: 0, verkauft: 0, verliehen: 0 }, valueAvailable: 0, formatSplit: { vinyl: 0, cd: 0, other: 0 }, genreOptions: [] };
}
export function parseInventoryFilters(_sp: Record<string, string | string[] | undefined>): InventoryFilters { return {}; }
```

- [ ] **Step 7: Run all tests to confirm no regressions**

```bash
pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add \
  src/app/\(app\)/inventar/page.tsx \
  src/app/\(app\)/inventar/_components/FilterBar.tsx \
  src/app/\(app\)/inventar/_components/StatusTabs.tsx \
  src/app/\(app\)/inventar/_components/ViewToggle.tsx \
  src/app/\(app\)/inventar/_components/InventoryList.tsx \
  src/app/\(app\)/inventar/_components/InventoryTiles.tsx \
  tests/inventar/lagerbestand.test.tsx
git commit -m "$(cat <<'EOF'
feat(slice1): Lagerbestand screen — list/tile/filter/status/empty-state

- Rebuild /inventar page (RSC): parallel listInventory + inventoryAggregates,
  async searchParams (Next.js 15), explicit tenantId ctx.
- FilterBar (client, URL state): debounced search, format/genre/condition
  selects, Zurücksetzen, disabled barcode placeholder; shows Treffer + Wert.
- StatusTabs (client, URL state): Alle/im Lager/Verliehen/Verkauft with
  counts from byStatus; aria-pressed on active; accent bg when active.
- ViewToggle (client, useState): SegmentedControl ☰/▦; default list;
  renders InventoryList or InventoryTiles; empty state when rows=[].
- InventoryList: table (Artikel/Jahr·Label/Zustand/EK·VK/Status/Aktion);
  ConditionPill on conditionRecord; StatusBadge; verkauft opacity 0.62;
  all Aktion buttons disabled; footer n von total.
- InventoryTiles: grid cards; aspect-ratio 1.9 header; disc label-ring
  Vinyl→--accent, CD→--info; StatusBadge overlay; ConditionPill top-right;
  EK·VK; disabled Aktion; verkauft opacity 0.62.
- Component tests: ViewToggle switches list↔tiles; InventoryList renders
  title/EK/VK/StatusBadge/ConditionPill; empty state; 11 assertions total.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dashboard (Übersicht)

**Files:**
- Rebuild: `src/app/(app)/page.tsx`
- Create: `src/app/(app)/_components/dashboard/KpiCard.tsx`
- Create: `src/app/(app)/_components/dashboard/InventoryKpi.tsx`
- Create: `src/app/(app)/_components/dashboard/EmptyPanel.tsx`
- Test: `tests/ui/dashboard.test.tsx`

**Interfaces:**

Consumes (exact SPINE PART C signatures):
- `inventoryAggregates(ctx: { tenantId: number; userId: number | null }, f: InventoryFilters): Promise<InventoryAggregates>` — from `src/lib/inventory.ts` (Task 2 output)
- `InventoryAggregates` type — `{ total: number; byStatus: Record<InventoryStatus, number>; valueAvailable: number; formatSplit: { vinyl: number; cd: number; other: number }; genreOptions: string[] }` — from `src/lib/inventory.ts`
- `requireSession(): Promise<SessionUser>` — from `src/auth/session`
- `getCurrentTenant(): Promise<Tenant>` — from `src/lib/tenant`
- `Card`, `CardProps` — from `src/components/ui` (Slice-0 primitive)

Produces (for Task 7 E2E):
- `/` page — server-rendered dashboard with real "Artikel im Lager" count + calm empty panels; exercised by `e2e/dashboard.spec.ts`

---

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/dashboard.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { InventoryAggregates } from '@/lib/inventory';
import { InventoryKpi } from '@/app/(app)/_components/dashboard/InventoryKpi';
import { EmptyPanel } from '@/app/(app)/_components/dashboard/EmptyPanel';

afterEach(cleanup);

const MOCK_AGG: InventoryAggregates = {
  total: 12,
  byStatus: { verfuegbar: 8, reserviert: 1, verkauft: 2, verliehen: 1 },
  valueAvailable: 240,
  formatSplit: { vinyl: 5, cd: 2, other: 1 },
  genreOptions: ['Jazz', 'Rock'],
};

describe('InventoryKpi', () => {
  it('shows the available-copy count from byStatus.verfuegbar', () => {
    render(<InventoryKpi aggregates={MOCK_AGG} />);
    // 8 is byStatus.verfuegbar; toLocaleString('de-DE') of 8 = '8'
    expect(screen.getByText('8')).toBeDefined();
  });

  it('shows the label "Artikel im Lager"', () => {
    render(<InventoryKpi aggregates={MOCK_AGG} />);
    expect(screen.getByText('Artikel im Lager')).toBeDefined();
  });

  it('renders format-split caption with Vinyl/CD/Andere percentages', () => {
    render(<InventoryKpi aggregates={MOCK_AGG} />);
    // vinyl=5 cd=2 other=1 total=8 → Vinyl 63% · CD 25% · Andere 12%
    const caption = screen.getByTestId('format-caption');
    expect(caption.textContent).toMatch(/^Vinyl \d+% · CD \d+% · Andere \d+%$/);
  });

  it('shows Inventarwert when valueAvailable > 0', () => {
    render(<InventoryKpi aggregates={MOCK_AGG} />);
    expect(screen.getByTestId('inventarwert')).toBeDefined();
  });

  it('hides Inventarwert when valueAvailable is 0', () => {
    render(<InventoryKpi aggregates={{ ...MOCK_AGG, valueAvailable: 0 }} />);
    expect(screen.queryByTestId('inventarwert')).toBeNull();
  });

  it('shows zero available as "0" when byStatus.verfuegbar is 0', () => {
    const agg: InventoryAggregates = {
      ...MOCK_AGG,
      byStatus: { verfuegbar: 0, reserviert: 0, verkauft: 0, verliehen: 0 },
      valueAvailable: 0,
      formatSplit: { vinyl: 0, cd: 0, other: 0 },
    };
    render(<InventoryKpi aggregates={agg} />);
    expect(screen.getByText('0')).toBeDefined();
  });
});

describe('EmptyPanel', () => {
  it('renders the title and calm empty-state message', () => {
    render(
      <EmptyPanel
        title="Letzte Verkäufe"
        emptyMessage="Noch keine Verkäufe — Verkauf folgt (Slice 3)."
      />,
    );
    expect(screen.getByText('Letzte Verkäufe')).toBeDefined();
    expect(screen.getByText('Noch keine Verkäufe — Verkauf folgt (Slice 3).')).toBeDefined();
  });

  it('contains no monetary figure in the empty-panel output', () => {
    render(
      <EmptyPanel
        title="Letzte Verkäufe"
        emptyMessage="Noch keine Verkäufe — Verkauf folgt (Slice 3)."
      />,
    );
    const text = document.body.textContent ?? '';
    // must not contain any "€ 1.284" or similar fake sales number
    expect(text).not.toMatch(/€\s*[\d.,]+/);
  });

  it('renders Wunschlisten-Treffer panel with placeholder copy', () => {
    render(
      <EmptyPanel
        title="Wunschlisten-Treffer"
        emptyMessage="Noch keine Treffer — Wunschlisten folgt (Slice 3)."
      />,
    );
    expect(screen.getByText('Wunschlisten-Treffer')).toBeDefined();
    expect(screen.getByText('Noch keine Treffer — Wunschlisten folgt (Slice 3).')).toBeDefined();
  });

  it('renders optional titlePrefix slot', () => {
    render(
      <EmptyPanel
        title="Wunschlisten-Treffer"
        emptyMessage="Noch keine Treffer — Wunschlisten folgt (Slice 3)."
        titlePrefix={<span data-testid="honey-dot" />}
      />,
    );
    expect(screen.getByTestId('honey-dot')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it (FAIL expected: "Cannot find module")**

```bash
pnpm test tests/ui/dashboard.test.tsx
```

Expected failure: `Error: Cannot find module '@/app/(app)/_components/dashboard/InventoryKpi'` — the dashboard components do not exist yet.

- [ ] **Step 3: Implement the dashboard components and page**

**3a.** Create `src/app/(app)/_components/dashboard/KpiCard.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

export interface KpiCardProps {
  label: string;
  icon?: ReactNode;
  /** When true renders the accent (coral) variant — Ankäufe heute card */
  accent?: boolean;
  children: ReactNode;
}

/**
 * Generic KPI card wrapper.
 * Verbatim layout from Q-Records App.dc.html DASHBOARD section:
 *   border: 1px solid var(--border), border-radius: var(--r-lg), padding: 20px,
 *   shadow-1 (default) / shadow-2 (accent). Label 13px text-2 600, icon 15px text-3.
 */
export function KpiCard({ label, icon, accent = false, children }: KpiCardProps) {
  return (
    <Card
      elevation={accent ? 2 : 1}
      style={{
        padding: '20px',
        ...(accent
          ? { background: 'var(--accent)', color: 'var(--on-accent)' }
          : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            ...(accent ? { opacity: 0.9 } : { color: 'var(--text-2)' }),
          }}
        >
          {label}
        </span>
        {icon != null && (
          <span
            aria-hidden="true"
            style={{
              fontSize: '15px',
              ...(accent ? { opacity: 0.8 } : { color: 'var(--text-3)' }),
            }}
          >
            {icon}
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}
```

**3b.** Create `src/app/(app)/_components/dashboard/InventoryKpi.tsx`:

```tsx
import type { InventoryAggregates } from '@/lib/inventory';
import { KpiCard } from './KpiCard';

/**
 * Formats a euro amount for German locale display (e.g. 84210 → "84.210 €").
 * maximumFractionDigits:0 suppresses cents for large totals (clean KPI display).
 */
function formatEuro(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export interface InventoryKpiProps {
  aggregates: InventoryAggregates;
}

/**
 * "Artikel im Lager" KPI card — the only card on the dashboard with REAL data.
 *
 * Verbatim layout from Q-Records App.dc.html DASHBOARD section (card 2):
 *   count: font-mono 500 32px mt-10px ls--.02em
 *   format bar: mt-16px h-8px r-pill bg-surface-3 overflow-hidden flex
 *     Vinyl → --ok · CD → --info · Andere → --honey
 *   caption: font-mono 11.5px text-3 mt-8px
 *   Inventarwert: font-mono 11.5px text-3 mt-4px (extra line, not in handoff KPI)
 */
export function InventoryKpi({ aggregates }: InventoryKpiProps) {
  const { byStatus, valueAvailable, formatSplit } = aggregates;
  const available = byStatus.verfuegbar;

  const fsTotal = formatSplit.vinyl + formatSplit.cd + formatSplit.other;
  const vinylPct = fsTotal > 0 ? Math.round((formatSplit.vinyl / fsTotal) * 100) : 0;
  const cdPct    = fsTotal > 0 ? Math.round((formatSplit.cd    / fsTotal) * 100) : 0;
  const otherPct = fsTotal > 0 ? 100 - vinylPct - cdPct : 0;

  return (
    <KpiCard label="Artikel im Lager" icon="⬤">
      {/* big count — font-mono 500 32px */}
      <div
        data-testid="kpi-inventory-available"
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 500,
          fontSize: '32px',
          marginTop: '10px',
          letterSpacing: '-.02em',
        }}
      >
        {new Intl.NumberFormat('de-DE').format(available)}
      </div>

      {/* segmented progress bar — Vinyl/CD/Andere */}
      <div
        aria-hidden="true"
        style={{
          marginTop: '16px',
          height: '8px',
          borderRadius: 'var(--r-pill)',
          background: 'var(--surface-3)',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <span style={{ width: `${vinylPct}%`, background: 'var(--ok)' }} />
        <span style={{ width: `${cdPct}%`,    background: 'var(--info)' }} />
        <span style={{ width: `${otherPct}%`, background: 'var(--honey)' }} />
      </div>

      {/* caption: e.g. "Vinyl 64% · CD 22% · Andere 14%" */}
      <div
        data-testid="format-caption"
        style={{
          fontSize: '11.5px',
          color: 'var(--text-3)',
          marginTop: '8px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {`Vinyl ${vinylPct}% · CD ${cdPct}% · Andere ${otherPct}%`}
      </div>

      {/* Inventarwert — spec §6.2: may appear as subtle additional line */}
      {valueAvailable > 0 && (
        <div
          data-testid="inventarwert"
          style={{
            fontSize: '11.5px',
            color: 'var(--text-3)',
            marginTop: '4px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {`Inventarwert ${formatEuro(valueAvailable)}`}
        </div>
      )}
    </KpiCard>
  );
}
```

**3c.** Create `src/app/(app)/_components/dashboard/EmptyPanel.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

export interface EmptyPanelProps {
  /** Panel header title (Bricolage Grotesque 700 16px) */
  title: string;
  /** Calm placeholder copy — no fake numbers, no "Error" language */
  emptyMessage: string;
  /** Optional right-side header element (e.g. disabled "Alle →" button) */
  headerExtra?: ReactNode;
  /** Optional element prepended to title in the header (e.g. honey dot for Wunschlisten) */
  titlePrefix?: ReactNode;
  /** Optional testid for E2E locators; spread as data-testid on the outer Card. */
  testId?: string;
}

/**
 * Generic empty-state panel for deferred features (Letzte Verkäufe, Wunschlisten-Treffer).
 *
 * Verbatim layout from Q-Records App.dc.html DASHBOARD section (panel row):
 *   header: flex items-center justify-between p-[16px 18px] border-b text
 *   body:   p-[48px 24px] text-center text-3 (calm empty, no "Error")
 */
export function EmptyPanel({ title, emptyMessage, headerExtra, titlePrefix, testId }: EmptyPanelProps) {
  return (
    <Card elevation={1} style={{ overflow: 'hidden' }} {...(testId ? { 'data-testid': testId } : {})}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 18px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          {titlePrefix}
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '16px',
            }}
          >
            {title}
          </span>
        </div>
        {headerExtra}
      </div>
      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--text-3)',
        }}
      >
        <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.6 }}>
          {emptyMessage}
        </p>
      </div>
    </Card>
  );
}
```

**3d.** Rebuild `src/app/(app)/page.tsx`:

```tsx
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { inventoryAggregates } from '@/lib/inventory';
import { KpiCard } from './_components/dashboard/KpiCard';
import { InventoryKpi } from './_components/dashboard/InventoryKpi';
import { EmptyPanel } from './_components/dashboard/EmptyPanel';

/**
 * Dashboard (Übersicht) — `/`
 *
 * Server Component. Real data: "Artikel im Lager" + formatSplit + Inventarwert
 * via inventoryAggregates(ctx, {}) (no filters = tenant-wide picture).
 * Everything else is a calm placeholder for Slice 2/3 features.
 *
 * Verbatim layout from Q-Records App.dc.html DASHBOARD section:
 *   outer: flex col gap-20 max-w-1200
 *   KPI row: grid repeat(auto-fit, minmax(min(100%,230px),1fr)) gap-16
 *   panel row: grid 1.55fr 1fr gap-20
 */
export default async function DashboardPage() {
  const [user, tenant] = await Promise.all([requireSession(), getCurrentTenant()]);
  const agg = await inventoryAggregates({ tenantId: tenant.id, userId: user.id }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1200px' }}>

      {/* ── KPI Row — 4 cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
          gap: '16px',
        }}
      >
        {/* 1. Tagesumsatz — calm placeholder, no fake number, flat sparkline */}
        <KpiCard label="Tagesumsatz">
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: '32px',
              marginTop: '10px',
              letterSpacing: '-.02em',
              color: 'var(--text-3)',
            }}
          >
            € 0
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '8px' }}>
            Noch keine Verkäufe (Slice 3)
          </div>
          {/* flat sparkline — equal height bars, surface-3, no fake data */}
          <div
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '5px',
              height: '34px',
              marginTop: '14px',
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: '20%',
                  background: 'var(--surface-3)',
                  borderRadius: '3px 3px 0 0',
                }}
              />
            ))}
          </div>
        </KpiCard>

        {/* 2. Artikel im Lager — REAL data */}
        <InventoryKpi aggregates={agg} />

        {/* 3. Ankäufe heute — accent card, calm placeholder */}
        <KpiCard label="Ankäufe heute" icon="⤓" accent>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: '32px',
              marginTop: '10px',
              letterSpacing: '-.02em',
            }}
          >
            0
          </div>
          <div style={{ fontSize: '13px', marginTop: '16px', opacity: 0.92 }}>
            Ankauf folgt (Slice 2)
          </div>
        </KpiCard>

        {/* 4. Offene Wunschtreffer — disabled CTA placeholder */}
        <KpiCard label="Offene Wunschtreffer" icon="♡">
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: '32px',
              marginTop: '10px',
              letterSpacing: '-.02em',
              color: 'var(--text-3)',
            }}
          >
            0
          </div>
          {/* disabled placeholder CTA — no onClick, inert */}
          <button
            type="button"
            disabled
            style={{
              marginTop: '14px',
              minHeight: '34px',
              padding: '0 14px',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)',
              background: 'transparent',
              color: 'var(--text-3)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: '12.5px',
              cursor: 'not-allowed',
            }}
          >
            Treffer ansehen → (Slice 3)
          </button>
        </KpiCard>
      </div>

      {/* ── Panel Row — 2 panels ── */}
      {/*
        Verbatim: grid-template-columns 1.55fr 1fr, gap 20px
        Source: Q-Records App.dc.html line 128 (.qr-dash-cols)
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.55fr 1fr',
          gap: '20px',
          alignItems: 'start',
        }}
      >
        {/* Letzte Verkäufe — wide panel, calm empty, disabled "Alle →" */}
        <EmptyPanel
          title="Letzte Verkäufe"
          testId="panel-letzte-verkaeufe"
          emptyMessage="Noch keine Verkäufe — Verkauf folgt (Slice 3)."
          headerExtra={
            <button
              type="button"
              disabled
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-3)',
                fontFamily: 'var(--font-body)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'not-allowed',
              }}
            >
              Alle →
            </button>
          }
        />

        {/* Wunschlisten-Treffer — narrow panel, honey dot prefix, calm empty */}
        <EmptyPanel
          title="Wunschlisten-Treffer"
          testId="panel-wunschlisten"
          emptyMessage="Noch keine Treffer — Wunschlisten folgt (Slice 3)."
          titlePrefix={
            /*
             * Verbatim from Q-Records App.dc.html line 150:
             *   width:9px height:9px border-radius:50% background:var(--honey)
             *   box-shadow:0 0 0 4px var(--honey-soft)
             */
            <span
              aria-hidden="true"
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                background: 'var(--honey)',
                boxShadow: '0 0 0 4px var(--honey-soft)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          }
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests (PASS expected)**

```bash
pnpm test tests/ui/dashboard.test.tsx
```

All 9 tests in the `InventoryKpi` and `EmptyPanel` suites must be green.

- [ ] **Step 5: Typecheck, lint, build**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

All three must exit 0 before committing.

- [ ] **Step 6: Commit**

```bash
git add \
  src/app/\(app\)/page.tsx \
  src/app/\(app\)/_components/dashboard/KpiCard.tsx \
  src/app/\(app\)/_components/dashboard/InventoryKpi.tsx \
  src/app/\(app\)/_components/dashboard/EmptyPanel.tsx \
  tests/ui/dashboard.test.tsx
git commit -m "$(cat <<'EOF'
feat(slice1): dashboard – real Artikel-im-Lager KPI + calm empty panels

Rebuilds / to show live byStatus.verfuegbar count + format-split bar +
Inventarwert from inventoryAggregates; all deferred panels (Tagesumsatz,
Ankäufe, Wunschtreffer, Verkäufe) show calm placeholders with no fake
numbers. Adds KpiCard / InventoryKpi / EmptyPanel primitives (design-token
verbatim from Q-Records App handoff). Component tests: 9 assertions green.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

**Design fidelity notes (verbatim from Q-Records App.dc.html DASHBOARD section):**

| Element | Source token / value |
|---|---|
| KPI row grid | `repeat(auto-fit, minmax(min(100%, 230px), 1fr))` gap `16px` |
| Panel row grid | `1.55fr 1fr` gap `20px` alignItems `start` |
| Card padding | `20px` |
| KPI label | `font-size 13px color var(--text-2) font-weight 600` |
| KPI number | `font-family var(--font-mono) font-weight 500 font-size 32px margin-top 10px letter-spacing -.02em` |
| Format bar | `height 8px border-radius var(--r-pill) background var(--surface-3) overflow hidden flex` |
| Format bar Vinyl | `background var(--ok)` |
| Format bar CD | `background var(--info)` |
| Format bar Andere | `background var(--honey)` |
| Format caption | `font-size 11.5px color var(--text-3) margin-top 8px font-family var(--font-mono)` |
| Accent card | `background var(--accent) color var(--on-accent) box-shadow var(--shadow-2)` |
| Panel header | `font-family var(--font-display) font-weight 700 font-size 16px padding 16px 18px border-bottom 1px solid var(--border)` |
| Honey dot | `width 9px height 9px border-radius 50% background var(--honey) box-shadow 0 0 0 4px var(--honey-soft)` |

**Global constraints honoured:**
- No `'use client'` — `DashboardPage`, `KpiCard`, `InventoryKpi`, `EmptyPanel` are all pure server/presentational (no hooks, no event handlers that require hydration). All mutation CTAs (`disabled` buttons) are truly inert.
- `inventoryAggregates` called with `{ tenantId: tenant.id, userId: user.id }` — only `withTenant` touches tenant data inside the module.
- No new raw hex values — all colours are design-token references.
- No fake numbers in placeholder cards — `Tagesumsatz` shows `€ 0` with sub-label "Noch keine Verkäufe (Slice 3)", `Offene Wunschtreffer` shows `0` (spec §6.1 verbatim).
- TS strict, no `any`.

---

### Task 5: Public storefront

Implements the public, unauthenticated Schaufenster: the `src/lib/storefront.ts` query module (LOCKED shapes from SPINE PART C) and the rebuilt `s/[permalink]` page + its two view components. The module runs every read in `withTenant({ tenantId, userId: null })`, fail-closes unknown slugs to `notFound()`, and SELECTs only public columns so no price/condition/EK can ever reach the rendered output. Mutation CTAs render as disabled placeholders (Slice 3).

**Files:**
- Create: `src/lib/storefront.ts`
- Modify (rebuild): `src/app/s/[permalink]/page.tsx`
- Create: `src/app/s/[permalink]/_components/StorefrontGrid.tsx`
- Create: `src/app/s/[permalink]/_components/StorefrontSearch.tsx`
- Test: `tests/storefront.integration.test.ts`

**Interfaces:**
- Consumes (from Slice 0, verbatim):
  - `withTenant(ctx: { tenantId: number; userId: number | null }, fn: (tx: Tx) => Promise<T>): Promise<T>` from `@/db/tenant`
  - `withOwner(fn: (tx: Tx) => Promise<T>): Promise<T>` from `@/db/tenant` (test seeding only)
  - `records`, `purchases`, `permalinks` from `@/db/schema` (post-Task-1 shape: `records` has NO `recordStatus`; `purchases` has `status` / `conditionRecord` / `conditionCover`)
  - `getCurrentTenant(): Promise<{ id: number; name: string; slug: string; ... }>` from `@/lib/tenant`
  - `setupTestDatabase()`, `seedTenant({ slug, name, primaryColor? })` from `tests/helpers/db`
  - UI primitives from `@/components/ui`: `CoverPlaceholder`, `VinylDisc`, `Button`, `SearchField`
- Produces (LOCKED — SPINE PART C `src/lib/storefront.ts`, relied on by Task 7 E2E):
  ```ts
  export type PermalinkFilter = { title?: string; genre?: string[]; format?: string[] };
  export type Availability = 'in' | 'low';
  export type StorefrontRecord = { recordId: number; title: string; artist: string; format: string | null; meta: string; availability: Availability };
  export type ResolvedPermalink = { slug: string; title: string; filter: PermalinkFilter };
  export async function resolvePermalink(ctx: { tenantId: number }, slug: string): Promise<ResolvedPermalink | null>;
  export async function listStorefront(ctx: { tenantId: number }, filter: PermalinkFilter, q?: string): Promise<StorefrontRecord[]>;
  export function parsePermalinkFilter(raw: unknown): PermalinkFilter;
  ```

---

#### Cycle A — storefront query module

- [ ] **Step 1: Write the failing test** — `tests/storefront.integration.test.ts`

```ts
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
```

- [ ] **Step 2: Run it (FAIL expected: cannot resolve `@/lib/storefront`)**  Run: `pnpm test tests/storefront.integration.test.ts`

- [ ] **Step 3: Implement** — `src/lib/storefront.ts`

```ts
import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';
import { permalinks } from '@/db/schema';

export type PermalinkFilter = { title?: string; genre?: string[]; format?: string[] };
export type Availability = 'in' | 'low';
export type StorefrontRecord = {
  recordId: number;
  title: string;
  artist: string;
  format: string | null;
  meta: string;
  availability: Availability;
};
export type ResolvedPermalink = { slug: string; title: string; filter: PermalinkFilter };

/** Raw row shape from the grouped public query — internal only. */
type StorefrontQueryRow = {
  record_id: number;
  title: string;
  artist: string;
  release_year: number | null;
  label: string[] | null;
  country: string | null;
  format: string | null;
  avail_count: string | number;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
}

/** Validate/sanitise the jsonb permalink filter: title string, genre/format string[]; ignore unknown keys. */
export function parsePermalinkFilter(raw: unknown): PermalinkFilter {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: PermalinkFilter = {};
  if (typeof obj.title === 'string' && obj.title.trim().length > 0) out.title = obj.title.trim();
  const genre = toStringArray(obj.genre);
  if (genre.length > 0) out.genre = genre;
  const format = toStringArray(obj.format);
  if (format.length > 0) out.format = format;
  return out;
}

/** "new-arrivals" → "New Arrivals" (fallback H2 when the filter carries no explicit title). */
function humaniseSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolve a public slug WITHIN the tenant. null → caller notFound(). Runs with userId:null (public). */
export async function resolvePermalink(
  ctx: { tenantId: number },
  slug: string,
): Promise<ResolvedPermalink | null> {
  const row = await withTenant({ tenantId: ctx.tenantId, userId: null }, (tx) =>
    tx
      .select({ slug: permalinks.slug, filter: permalinks.filter })
      .from(permalinks)
      .where(and(eq(permalinks.slug, slug), eq(permalinks.tenantId, ctx.tenantId)))
      .then((rows) => rows[0] ?? null),
  );
  if (!row) return null;
  const filter = parsePermalinkFilter(row.filter);
  return { slug: row.slug, title: filter.title ?? humaniseSlug(row.slug), filter };
}

/**
 * Public live-stock listing. Returns records that match the filter (+ optional q on title/artist)
 * and have >=1 'verfuegbar' copy, grouped per record. SELECTS ONLY public columns — never price,
 * condition, EK/VK or internal status reach StorefrontRecord. availability = availCount>=2 ? in : low.
 */
export async function listStorefront(
  ctx: { tenantId: number },
  filter: PermalinkFilter,
  q?: string,
): Promise<StorefrontRecord[]> {
  // Defence-in-depth: explicit tenant predicate alongside RLS.
  const conds = [sql`r.tenant_id = ${ctx.tenantId}`];
  if (filter.title) { const escTitle = filter.title.replace(/[\\%_]/g, (c) => '\\' + c); conds.push(sql`r.title ILIKE ${`%${escTitle}%`}`); }
  if (filter.genre && filter.genre.length > 0) conds.push(sql`r.genre && ${filter.genre}::text[]`);
  if (filter.format && filter.format.length > 0) conds.push(sql`r.format = ANY(${filter.format}::text[])`);
  const trimmedQ = q?.trim();
  if (trimmedQ) {
    const esc = trimmedQ.replace(/[\\%_]/g, (c) => '\\' + c);
    const like = `%${esc}%`;
    conds.push(sql`(r.title ILIKE ${like} OR r.artist ILIKE ${like})`);
  }

  const rows = await withTenant({ tenantId: ctx.tenantId, userId: null }, async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        r.id           AS record_id,
        r.title        AS title,
        r.artist       AS artist,
        r.release_year AS release_year,
        r.label        AS label,
        r.country      AS country,
        r.format       AS format,
        COUNT(*) FILTER (WHERE p.status = 'verfuegbar') AS avail_count
      FROM records r
      JOIN purchases p ON p.record_id = r.id AND p.tenant_id = r.tenant_id
      WHERE ${sql.join(conds, sql` AND `)}
      GROUP BY r.id
      HAVING COUNT(*) FILTER (WHERE p.status = 'verfuegbar') >= 1
      ORDER BY r.artist, r.title
    `);
    return result.rows as StorefrontQueryRow[];
  });

  return rows.map((row): StorefrontRecord => {
    const meta = [
      row.release_year,
      Array.isArray(row.label) && row.label.length > 0 ? row.label.join('/') : null,
      row.country,
      row.format,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      recordId: Number(row.record_id),
      title: row.title,
      artist: row.artist,
      format: row.format ?? null,
      meta,
      availability: Number(row.avail_count) >= 2 ? 'in' : 'low',
    };
  });
}
```

- [ ] **Step 4: Run it (PASS)**  Run: `pnpm test tests/storefront.integration.test.ts`

- [ ] **Step 5: Commit**
```bash
git add src/lib/storefront.ts tests/storefront.integration.test.ts
git commit -m "feat(slice1): storefront query module (in-stock, tenant-scoped, no private-field leak)"
```

---

#### Cycle B — public page + view components

- [ ] **Step 6: Implement the in-results search component** — `src/app/s/[permalink]/_components/StorefrontSearch.tsx`

```tsx
'use client';
import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SearchField } from '@/components/ui';

export function StorefrontSearch({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQ);

  function submit(next: string): void {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = next.trim().slice(0, 80);
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      style={{ maxWidth: 520, marginBottom: 'clamp(18px,3vw,28px)' }}
    >
      <SearchField
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="In diesen Ergebnissen suchen — Titel oder Künstler…"
        aria-label="In diesen Ergebnissen suchen"
      />
    </form>
  );
}
```

- [ ] **Step 7: Implement the grid** — `src/app/s/[permalink]/_components/StorefrontGrid.tsx`

```tsx
import { CoverPlaceholder, VinylDisc, Button } from '@/components/ui';
import type { StorefrontRecord } from '@/lib/storefront';

const AVAILABILITY: Record<StorefrontRecord['availability'], { label: string; color: string }> = {
  in: { label: 'Verfügbar im Store', color: 'var(--ok)' },
  low: { label: 'Nur noch 1×', color: 'var(--honey-ink)' },
};

export function StorefrontGrid({ records }: { records: StorefrontRecord[] }) {
  if (records.length === 0) {
    return (
      <div
        style={{
          border: '1.5px dashed var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          padding: 'clamp(28px,6vw,56px)',
          textAlign: 'center',
          color: 'var(--text-2)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px', color: 'var(--text)' }}>
          Nichts gefunden
        </p>
        <p style={{ marginTop: 6, fontSize: '14px' }}>
          Aktuell ist kein passender Titel im Live-Bestand.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
        gap: 'clamp(14px,2vw,20px)',
      }}
    >
      {records.map((r) => {
        const avail = AVAILABILITY[r.availability];
        return (
          <article
            key={r.recordId}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-1)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ position: 'relative' }}>
              <CoverPlaceholder aspectRatio={1} />
              <div
                aria-hidden="true"
                style={{ position: 'absolute', right: '-26%', top: '50%', transform: 'translateY(-50%)' }}
              >
                <VinylDisc
                  size={120}
                  variant="card"
                  labelColor={r.format === 'Vinyl' ? 'var(--accent)' : r.format === 'CD' ? 'var(--info)' : 'var(--disc-label)'}
                />
              </div>
              <span
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: avail.color,
                  fontFamily: 'var(--font-body)',
                  fontWeight: 700,
                  fontSize: '12px',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: 7, height: 7, borderRadius: '50%', background: avail.color }}
                />
                {avail.label}
              </span>
            </div>

            <div style={{ padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '16px',
                  letterSpacing: '-.01em',
                  color: 'var(--text)',
                }}
              >
                {r.title}
              </p>
              <p style={{ fontSize: '14px', color: 'var(--text-2)' }}>{r.artist}</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-3)' }}>{r.meta}</p>
              <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                <Button variant="secondary" size="sm36" disabled aria-label="Im Laden vormerken — folgt">
                  Im Laden vormerken
                </Button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 8: Rebuild the public page** — `src/app/s/[permalink]/page.tsx`

```tsx
// src/app/s/[permalink]/page.tsx
import { notFound } from 'next/navigation';
import { getCurrentTenant } from '@/lib/tenant';
import { resolvePermalink, listStorefront } from '@/lib/storefront';
import { StorefrontGrid } from './_components/StorefrontGrid';
import { StorefrontSearch } from './_components/StorefrontSearch';

interface Props {
  params: Promise<{ permalink: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readQ(sp: Record<string, string | string[] | undefined>): string {
  const raw = sp.q;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

export default async function PublicStorefrontPage({ params, searchParams }: Props) {
  const { permalink: slug } = await params;
  const sp = await searchParams;
  const q = readQ(sp);

  // getCurrentTenant reads x-tenant-slug from headers — set by edge middleware. NO requireSession.
  const tenant = await getCurrentTenant();

  const resolved = await resolvePermalink({ tenantId: tenant.id }, slug);
  if (!resolved) {
    notFound(); // unknown permalink → 404, NEVER another tenant's data
  }

  const records = await listStorefront({ tenantId: tenant.id }, resolved.filter, q || undefined);

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: 'clamp(20px,4vw,40px)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          marginBottom: 6,
        }}
      >
        q·records · Live-Bestand
      </p>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 'clamp(28px,5vw,42px)',
          letterSpacing: '-.02em',
          marginBottom: 'clamp(16px,3vw,26px)',
          color: 'var(--text)',
        }}
      >
        {resolved.title}
      </h2>

      <StorefrontSearch initialQ={q} />
      <StorefrontGrid records={records} />

      <footer
        style={{
          marginTop: 'clamp(32px,6vw,56px)',
          paddingTop: 'clamp(16px,3vw,24px)',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-3)',
          fontSize: '13px',
        }}
      >
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-2)' }}>{tenant.name}</p>
        <p style={{ marginTop: 4 }}>
          Öffnungszeiten &amp; Adresse folgen · betrieben mit q·records
        </p>
      </footer>
    </main>
  );
}

export async function generateMetadata({ params }: Props) {
  const { permalink: slug } = await params;
  try {
    const tenant = await getCurrentTenant();
    const resolved = await resolvePermalink({ tenantId: tenant.id }, slug);
    return { title: resolved ? `${tenant.name} · ${resolved.title}` : tenant.name };
  } catch {
    return { title: slug };
  }
}
```

- [ ] **Step 9: Verify (PASS — typecheck/lint/build green; storefront test still green)**  Run: `pnpm typecheck && pnpm lint && pnpm test tests/storefront.integration.test.ts && pnpm build`

- [ ] **Step 10: Commit**
```bash
git add src/app/s/[permalink]/page.tsx src/app/s/[permalink]/_components/StorefrontGrid.tsx src/app/s/[permalink]/_components/StorefrontSearch.tsx
git commit -m "feat(slice1): public storefront page + grid + in-results search (no requireSession, no price/condition)"
```

---

**Acceptance (spec §10.4, SPINE Task 5):**
- RLS + explicit `tenant_id`: `listStorefront`/`resolvePermalink` only ever return the resolved tenant's rows; tenant B's `Blue Train` never appears for tenant A (test green).
- In-stock only: a record with all copies `verkauft` is excluded; `availability` is `in` (≥2 verfügbar) vs `low` (exactly 1) (test green).
- No private-field leak: every `StorefrontRecord` has exactly `{recordId,title,artist,meta,availability}`; no `price`/`condition`/`status`/EK/VK substring anywhere in the serialised object or rendered card (test green); page renders only title/artist/meta/availability.
- Fail-closed: unknown slug → `resolvePermalink` returns null → page `notFound()`; no `requireSession` on the public route.
- `parsePermalinkFilter` validates/sanitises jsonb (string title, string[] genre/format, unknown keys ignored, non-object → `{}`).
- `pnpm typecheck`, `pnpm lint`, `pnpm test tests/storefront.integration.test.ts`, `pnpm build` all green. (E2E string-scan of rendered HTML + cross-tenant `vinylcave.localhost` check is Task 7.)

---

### Task 6 — Seed enrichment

**Depends on:** Task 1 (schema has `purchases.status`, `purchases.conditionRecord`, `purchases.conditionCover`; `records` has NO `recordStatus`; `RecordStatus` type exported from `src/db/schema.ts`).

**Files:**
- Modify: `scripts/seed.ts`
- Create: `tests/seed.integration.test.ts`

**Interfaces:**
- Consumes from SPINE PART C / Task 1: `src/db/schema.ts` — `purchases` table with `.status`, `.conditionRecord`, `.conditionCover`; `permalinks` table; `records` table (no `recordStatus`); `export type RecordStatus = (typeof recordStatusEnum.enumValues)[number]`
- Consumes: `tests/helpers/db.ts` — `setupTestDatabase()`, `seedTenant()`, `type TestDatabase`
- Produces (Task 7 E2E relies on these):
  - `scripts/seed.ts` exports `ensurePurchase`, `ensurePermalink`, `seedTenantInventory`, `DEMO_RECORDS`, `DEMO_PURCHASES`, `DEMO_PERMALINKS`, `VINYLCAVE_RECORDS`, `VINYLCAVE_PURCHASES`, `VINYLCAVE_PERMALINKS`, `type PurchaseSpec`, `type PermalinkSpec`
  - Post-seed state for demo tenant: 15 records, 16 copies (11 `verfuegbar`, 3 `verkauft`, 2 `verliehen`), 2 permalinks created by `seedTenantInventory` (`jazz`, `neu`). Note: in production (via `pnpm db:seed` → `provisionTenant`) a third permalink `lager` is added by provisioning, for 3 total; integration tests via `seedTenant()` (raw insert) do not call provisioning and therefore have only 2.
  - Post-seed state for vinylcave tenant: 15 records, 16 copies (11 `verfuegbar`, 3 `verkauft`, 2 `verliehen`), 2 permalinks created by `seedTenantInventory` (`vinyl`, `neu`). Same note applies: 3 permalinks in production (lager + vinyl + neu).

---

- [ ] **Step 1: Write the failing test**

Create `tests/seed.integration.test.ts`:

```ts
// tests/seed.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant } from './helpers/db';
import type { TestDatabase } from './helpers/db';

let testDb: TestDatabase;
let ownerPool: Pool;

async function getInventoryCounts(pool: Pool, tenantId: number) {
  const r = await pool.query<{
    records: string;
    copies: string;
    available: string;
    permalinks: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM records   WHERE tenant_id = $1)                              AS records,
       (SELECT COUNT(*) FROM purchases WHERE tenant_id = $1)                              AS copies,
       (SELECT COUNT(*) FROM purchases WHERE tenant_id = $1 AND status = 'verfuegbar')   AS available,
       (SELECT COUNT(*) FROM permalinks WHERE tenant_id = $1)                             AS permalinks`,
    [tenantId],
  );
  const row = r.rows[0]!;
  return {
    records:   Number(row.records),
    copies:    Number(row.copies),
    available: Number(row.available),
    permalinks: Number(row.permalinks),
  };
}

describe('Seed enrichment', () => {
  beforeAll(async () => {
    testDb   = await setupTestDatabase();
    ownerPool = new Pool({ connectionString: testDb.ownerUrl });
  }, 60_000);

  afterAll(async () => {
    await ownerPool.end();
    await testDb.teardown();
  });

  it('exports ensurePurchase, ensurePermalink, seedTenantInventory and all dataset constants', async () => {
    const m = await import('../scripts/seed');
    expect(typeof m.ensurePurchase).toBe('function');
    expect(typeof m.ensurePermalink).toBe('function');
    expect(typeof m.seedTenantInventory).toBe('function');
    expect(Array.isArray(m.DEMO_RECORDS)).toBe(true);
    expect(Array.isArray(m.DEMO_PURCHASES)).toBe(true);
    expect(Array.isArray(m.DEMO_PERMALINKS)).toBe(true);
    expect(Array.isArray(m.VINYLCAVE_RECORDS)).toBe(true);
    expect(Array.isArray(m.VINYLCAVE_PURCHASES)).toBe(true);
    expect(Array.isArray(m.VINYLCAVE_PERMALINKS)).toBe(true);
  });

  it('seed is idempotent: two runs produce identical row counts', async () => {
    const { seedTenantInventory, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS } =
      await import('../scripts/seed');

    const { tenantId } = await seedTenant({ slug: 'idempotency-test', name: 'Idempotency Test' });

    await seedTenantInventory(ownerPool, tenantId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);
    const counts1 = await getInventoryCounts(ownerPool, tenantId);

    await seedTenantInventory(ownerPool, tenantId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);
    const counts2 = await getInventoryCounts(ownerPool, tenantId);

    expect(counts2).toEqual(counts1);
    expect(counts1.records).toBeGreaterThan(0);
    expect(counts1.copies).toBeGreaterThan(0);
  }, 60_000);

  it('demo dataset shape: 15 records, 16 copies, 11 available, 2 permalinks', async () => {
    const { seedTenantInventory, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS } =
      await import('../scripts/seed');

    const { tenantId } = await seedTenant({ slug: 'demo-shape-test', name: 'Demo Shape Test' });
    await seedTenantInventory(ownerPool, tenantId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);

    const counts = await getInventoryCounts(ownerPool, tenantId);

    expect(counts.records).toBe(15);
    expect(counts.copies).toBe(16);
    expect(counts.available).toBe(11);
    expect(counts.permalinks).toBe(2);
  }, 60_000);

  it('vinylcave dataset shape: 15 records, 16 copies, 11 available, 2 permalinks', async () => {
    const { seedTenantInventory, VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS } =
      await import('../scripts/seed');

    const { tenantId } = await seedTenant({ slug: 'vinyl-shape-test', name: 'Vinyl Shape Test' });
    await seedTenantInventory(ownerPool, tenantId, VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS);

    const counts = await getInventoryCounts(ownerPool, tenantId);

    expect(counts.records).toBe(15);
    expect(counts.copies).toBe(16);
    expect(counts.available).toBe(11);
    expect(counts.permalinks).toBe(2);
  }, 60_000);

  it('two tenants seeded from different datasets share no rows', async () => {
    const {
      seedTenantInventory,
      DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS,
      VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS,
    } = await import('../scripts/seed');

    const { tenantId: demoId }  = await seedTenant({ slug: 'iso-demo',  name: 'ISO Demo' });
    const { tenantId: vinylId } = await seedTenant({ slug: 'iso-vinyl', name: 'ISO Vinyl' });

    await seedTenantInventory(ownerPool, demoId,  DEMO_RECORDS,      DEMO_PURCHASES,      DEMO_PERMALINKS);
    await seedTenantInventory(ownerPool, vinylId, VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS);

    const demoCounts  = await getInventoryCounts(ownerPool, demoId);
    const vinylCounts = await getInventoryCounts(ownerPool, vinylId);

    expect(demoCounts.records).toBe(15);
    expect(vinylCounts.records).toBe(15);

    // Total records across both tenants = 30 (no shared rows)
    const total = await ownerPool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM records WHERE tenant_id = ANY($1)',
      [[demoId, vinylId]],
    );
    expect(Number(total.rows[0]!.n)).toBe(30);
  }, 60_000);
});
```

- [ ] **Step 2: Run it (FAIL expected: exports missing, main() runs on import and exits process)**

```bash
pnpm test tests/seed.integration.test.ts
```

Expected failures:
1. Importing `scripts/seed.ts` triggers `main()` unconditionally, which calls `process.exit(0)` — the vitest worker exits mid-run.
2. Even if that didn't happen, `ensurePurchase`, `ensurePermalink`, `seedTenantInventory` are `undefined`.

- [ ] **Step 3: Implement — rewrite `scripts/seed.ts`**

Replace `scripts/seed.ts` entirely with the following (the file grows substantially; every section is shown):

```ts
// Must be first: loads .env into process.env before any src/* imports.
import 'dotenv/config';

import { fileURLToPath } from 'url';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';
import type { RecordStatus } from '../src/db/schema';
import { provisionTenant, type ProvisionInput } from '../src/lib/provisioning';
import { DEFAULT_PRIMARY_COLOR } from '../src/lib/branding';
import { recordHash } from '../src/db/hash';
import { hashPassword } from '../src/lib/password';
import { getEmailAdapter, sendCredentialsEmail } from '../src/lib/email';

// ---------------------------------------------------------------------------
// Tenant definitions
// ---------------------------------------------------------------------------

const DEMO_TENANT: ProvisionInput = {
  slug: 'demo',
  name: 'Q-Records Demo',
  adminEmail: 'admin@demo.test',
  primaryColor: DEFAULT_PRIMARY_COLOR,
  plan: 'free',
};

const VINYLCAVE_TENANT: ProvisionInput = {
  slug: 'vinylcave',
  name: 'Vinyl Cave',
  adminEmail: 'admin@vinylcave.test',
  primaryColor: '#5B4FCF',
  plan: 'small',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecordSeed = {
  title: string;
  artist: string;
  country: string;
  releaseYear: number;
  label: string[];
  format?: string;
  genre?: string[];
};

/** A single physical copy to create for a record. recordIndex = 0-based index into the records array. */
export type PurchaseSpec = {
  recordIndex: number;
  ek: string;
  vk: string;
  status: RecordStatus;
  conditionRecord: number | null;
  conditionCover: number | null;
  soldPrice?: string;
  soldDate?: Date;
};

export type PermalinkSpec = {
  slug: string;
  filter: { title?: string; genre?: string[]; format?: string[] };
};

// ---------------------------------------------------------------------------
// Datasets — demo tenant (jazz catalogue)
// ---------------------------------------------------------------------------

export const DEMO_RECORDS: RecordSeed[] = [
  // 0 — existing
  { title: 'Kind of Blue',              artist: 'Miles Davis',                         country: 'US', releaseYear: 1959, label: ['Columbia'],   format: 'Vinyl',       genre: ['Jazz'] },
  // 1 — existing
  { title: 'Blue Train',                artist: 'John Coltrane',                       country: 'US', releaseYear: 1958, label: ['Blue Note'],  format: 'Vinyl',       genre: ['Jazz'] },
  // 2 — existing
  { title: 'Giant Steps',               artist: 'John Coltrane',                       country: 'US', releaseYear: 1960, label: ['Atlantic'],   format: 'Vinyl',       genre: ['Jazz'] },
  // 3–14 new
  { title: 'Bitches Brew',              artist: 'Miles Davis',                         country: 'US', releaseYear: 1970, label: ['Columbia'],   format: 'Vinyl',       genre: ['Jazz', 'Fusion'] },
  { title: 'Mingus Ah Um',              artist: 'Charles Mingus',                      country: 'US', releaseYear: 1959, label: ['Columbia'],   format: 'Vinyl',       genre: ['Jazz'] },
  { title: 'Head Hunters',              artist: 'Herbie Hancock',                      country: 'US', releaseYear: 1973, label: ['Columbia'],   format: 'Vinyl',       genre: ['Jazz', 'Funk'] },
  { title: 'A Love Supreme',            artist: 'John Coltrane',                       country: 'US', releaseYear: 1965, label: ['Impulse!'],  format: 'Vinyl',       genre: ['Jazz'] },
  { title: 'Maiden Voyage',             artist: 'Herbie Hancock',                      country: 'US', releaseYear: 1965, label: ['Blue Note'], format: 'Vinyl',       genre: ['Jazz'] },
  { title: 'The Shape of Jazz to Come', artist: 'Ornette Coleman',                     country: 'US', releaseYear: 1959, label: ['Atlantic'],  format: 'Vinyl',       genre: ['Jazz', 'Avant-Garde'] },
  { title: 'Time Out',                  artist: 'Dave Brubeck',                        country: 'US', releaseYear: 1959, label: ['Columbia'],  format: 'CD',       genre: ['Jazz'] },
  { title: 'Waltz for Debby',           artist: 'Bill Evans',                          country: 'US', releaseYear: 1962, label: ['Riverside'], format: 'CD',       genre: ['Jazz'] },
  { title: 'Saxophone Colossus',        artist: 'Sonny Rollins',                       country: 'US', releaseYear: 1956, label: ['Prestige'],  format: 'Vinyl',       genre: ['Jazz'] },
  { title: "Moanin'",                   artist: 'Art Blakey & The Jazz Messengers',    country: 'US', releaseYear: 1958, label: ['Blue Note'], format: 'Vinyl',       genre: ['Jazz'] },
  { title: 'Sketches of Spain',         artist: 'Miles Davis',                         country: 'US', releaseYear: 1960, label: ['Columbia'],  format: 'Vinyl',       genre: ['Jazz'] },
  { title: 'Speak No Evil',             artist: 'Wayne Shorter',                       country: 'US', releaseYear: 1966, label: ['Blue Note'], format: 'Kassette', genre: ['Jazz'] },
];

// 16 copies total for 15 records.
// Record index 8 gets 2 copies (verfuegbar + verkauft) — demonstrates multi-copy model.
// verfuegbar: 0,1,2,3,4,5,6,7,8(copy1),13,14  = 11
// verkauft:   8(copy2),9,10                     =  3
// verliehen:  11,12                              =  2
export const DEMO_PURCHASES: PurchaseSpec[] = [
  { recordIndex:  0, ek:  '8.00', vk: '24.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  1, ek: '10.00', vk: '29.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 6 },
  { recordIndex:  2, ek:  '9.00', vk: '27.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 5 },
  { recordIndex:  3, ek: '12.00', vk: '34.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
  { recordIndex:  4, ek:  '7.00', vk: '19.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  5, ek: '11.00', vk: '32.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 7 },
  { recordIndex:  6, ek: '15.00', vk: '44.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 5 },
  { recordIndex:  7, ek: '13.00', vk: '38.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 4 },
  // Two copies of record 8 — the verfuegbar one stays in-stock, the verkauft one is already gone.
  { recordIndex:  8, ek:  '9.00', vk: '25.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  8, ek:  '6.00', vk: '18.90', status: 'verkauft',   conditionRecord: 4, conditionCover: 3, soldPrice: '18.90', soldDate: new Date('2026-05-14') },
  { recordIndex:  9, ek:  '6.00', vk: '16.90', status: 'verkauft',   conditionRecord: 5, conditionCover: 5, soldPrice: '16.90', soldDate: new Date('2026-06-01') },
  { recordIndex: 10, ek:  '5.00', vk: '14.90', status: 'verkauft',   conditionRecord: 6, conditionCover: 5, soldPrice: '14.00', soldDate: new Date('2026-06-10') },
  { recordIndex: 11, ek:  '8.00', vk: '22.90', status: 'verliehen',  conditionRecord: 6, conditionCover: 6 },
  { recordIndex: 12, ek:  '7.00', vk: '18.90', status: 'verliehen',  conditionRecord: 5, conditionCover: 5 },
  { recordIndex: 13, ek: '10.00', vk: '28.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 6 },
  { recordIndex: 14, ek:  '4.00', vk:  '9.90', status: 'verfuegbar', conditionRecord: 4, conditionCover: 3 },
];

export const DEMO_PERMALINKS: PermalinkSpec[] = [
  { slug: 'jazz', filter: { genre: ['Jazz'] } },
  { slug: 'neu',  filter: {} },
];

// ---------------------------------------------------------------------------
// Datasets — vinylcave tenant (rock/electronic catalogue)
// ---------------------------------------------------------------------------

export const VINYLCAVE_RECORDS: RecordSeed[] = [
  // 0 — existing
  { title: 'The Dark Side of the Moon', artist: 'Pink Floyd',    country: 'UK', releaseYear: 1973, label: ['Harvest'],      format: 'Vinyl',       genre: ['Rock', 'Progressive Rock'] },
  // 1 — existing
  { title: 'Abbey Road',                artist: 'The Beatles',   country: 'UK', releaseYear: 1969, label: ['Apple'],        format: 'Vinyl',       genre: ['Rock'] },
  // 2 — existing
  { title: 'Led Zeppelin IV',           artist: 'Led Zeppelin',  country: 'UK', releaseYear: 1971, label: ['Atlantic'],    format: 'Vinyl',       genre: ['Rock', 'Hard Rock'] },
  // 3–14 new
  { title: 'Unknown Pleasures',         artist: 'Joy Division',  country: 'UK', releaseYear: 1979, label: ['Factory'],     format: 'Vinyl',       genre: ['Post-Punk'] },
  { title: 'Remain in Light',           artist: 'Talking Heads', country: 'US', releaseYear: 1980, label: ['Sire'],        format: 'Vinyl',       genre: ['New Wave', 'Post-Punk'] },
  { title: 'Violator',                  artist: 'Depeche Mode',  country: 'UK', releaseYear: 1990, label: ['Mute'],        format: 'Vinyl',       genre: ['Electronic', 'Synth-Pop'] },
  { title: 'OK Computer',               artist: 'Radiohead',     country: 'UK', releaseYear: 1997, label: ['Parlophone'], format: 'CD',       genre: ['Alternative', 'Rock'] },
  { title: 'The Queen Is Dead',         artist: 'The Smiths',    country: 'UK', releaseYear: 1986, label: ['Rough Trade'], format: 'Vinyl',      genre: ['Alternative', 'Indie'] },
  { title: 'Power, Corruption & Lies',  artist: 'New Order',     country: 'UK', releaseYear: 1983, label: ['Factory'],    format: 'Vinyl',       genre: ['Electronic', 'Post-Punk'] },
  { title: 'Never Mind the Bollocks',   artist: 'Sex Pistols',   country: 'UK', releaseYear: 1977, label: ['Virgin'],     format: 'Vinyl',       genre: ['Punk'] },
  { title: 'The Joshua Tree',           artist: 'U2',            country: 'IE', releaseYear: 1987, label: ['Island'],     format: 'CD',       genre: ['Rock', 'Alternative'] },
  { title: 'Pornography',               artist: 'The Cure',      country: 'UK', releaseYear: 1982, label: ['Fiction'],    format: 'Vinyl',       genre: ['Post-Punk', 'Gothic Rock'] },
  { title: 'Closer',                    artist: 'Joy Division',  country: 'UK', releaseYear: 1980, label: ['Factory'],    format: 'Vinyl',       genre: ['Post-Punk'] },
  { title: 'Music for the Masses',      artist: 'Depeche Mode',  country: 'UK', releaseYear: 1987, label: ['Mute'],       format: 'Vinyl',       genre: ['Electronic', 'Synth-Pop'] },
  { title: 'Blue Monday',               artist: 'New Order',     country: 'UK', releaseYear: 1983, label: ['Factory'],    format: 'Kassette', genre: ['Electronic'] },
];

// 16 copies total for 15 records.
// Record index 5 (Violator) gets 2 copies — demonstrates multi-copy model for vinylcave.
// verfuegbar: 0,1,2,3,4,5(copy1),6,7,12,13,14 = 11
// verkauft:   5(copy2),8,9                      =  3
// verliehen:  10,11                              =  2
export const VINYLCAVE_PURCHASES: PurchaseSpec[] = [
  { recordIndex:  0, ek: '15.00', vk: '45.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  1, ek: '12.00', vk: '39.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 6 },
  { recordIndex:  2, ek: '14.00', vk: '42.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
  { recordIndex:  3, ek:  '8.00', vk: '24.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 5 },
  { recordIndex:  4, ek: '10.00', vk: '29.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
  // Two copies of Violator — one in stock, one sold.
  { recordIndex:  5, ek: '11.00', vk: '34.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 6 },
  { recordIndex:  5, ek:  '8.00', vk: '24.90', status: 'verkauft',   conditionRecord: 5, conditionCover: 4, soldPrice: '24.90', soldDate: new Date('2026-05-20') },
  { recordIndex:  6, ek:  '7.00', vk: '19.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  7, ek:  '9.00', vk: '27.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 5 },
  { recordIndex:  8, ek:  '8.00', vk: '22.90', status: 'verkauft',   conditionRecord: 5, conditionCover: 5, soldPrice: '22.90', soldDate: new Date('2026-06-03') },
  { recordIndex:  9, ek:  '7.00', vk: '19.90', status: 'verkauft',   conditionRecord: 4, conditionCover: 4, soldPrice: '18.00', soldDate: new Date('2026-06-15') },
  { recordIndex: 10, ek:  '6.00', vk: '16.90', status: 'verliehen',  conditionRecord: 6, conditionCover: 6 },
  { recordIndex: 11, ek:  '9.00', vk: '26.90', status: 'verliehen',  conditionRecord: 5, conditionCover: 4 },
  { recordIndex: 12, ek:  '8.00', vk: '23.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex: 13, ek: '10.00', vk: '29.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
  { recordIndex: 14, ek:  '3.00', vk:  '8.90', status: 'verfuegbar', conditionRecord: 4, conditionCover: 3 },
];

export const VINYLCAVE_PERMALINKS: PermalinkSpec[] = [
  { slug: 'vinyl', filter: { format: ['Vinyl'] } },
  { slug: 'neu',   filter: {} },
];

// ---------------------------------------------------------------------------
// Internal helpers (not exported — use seedTenantInventory from tests)
// ---------------------------------------------------------------------------

async function ensureTenant(
  input: ProvisionInput,
  ownerPool: Pool,
): Promise<{ tenantId: number; usedPassword: string | null }> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, input.slug))
    .limit(1);

  const seedPassword = process.env['SEED_ADMIN_PASSWORD'];

  if (existing.length > 0 && existing[0]) {
    const tenantId = existing[0].id;
    console.log(`[seed] Tenant "${input.slug}" already exists (id=${tenantId}), skipping creation.`);

    if (seedPassword) {
      const newHash = await hashPassword(seedPassword);
      await db
        .update(schema.users)
        .set({ password: newHash })
        .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'admin')));
      console.log(`[seed]   Updated admin password for "${input.slug}" to SEED_ADMIN_PASSWORD value.`);
      return { tenantId, usedPassword: seedPassword };
    }

    return { tenantId, usedPassword: null };
  }

  const result = await provisionTenant({ ...input, password: seedPassword ?? undefined });
  console.log(`[seed] Provisioned tenant "${input.slug}" (id=${result.tenantId}).`);
  return { tenantId: result.tenantId, usedPassword: result.temporaryPassword };
}

/**
 * Idempotent record insert. Returns the record's id (existing or newly inserted).
 */
async function ensureRecord(
  tenantId: number,
  rec: RecordSeed,
  ownerPool: Pool,
): Promise<number> {
  const db = drizzle(ownerPool, { schema });

  const hash = recordHash({
    title: rec.title,
    artist: rec.artist,
    country: rec.country,
    year: rec.releaseYear,
    label: rec.label,
  });

  const existing = await db
    .select({ id: schema.records.id })
    .from(schema.records)
    .where(and(eq(schema.records.hash, hash), eq(schema.records.tenantId, tenantId)))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    console.log(`[seed]   Record "${rec.title}" already exists, skipping.`);
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(schema.records)
    .values({
      tenantId,
      title: rec.title,
      artist: rec.artist,
      label: rec.label,
      country: rec.country,
      releaseYear: rec.releaseYear,
      format: rec.format ?? 'Vinyl',
      genre: rec.genre ?? [],
      hash,
    })
    .returning({ id: schema.records.id });

  console.log(`[seed]   Inserted "${rec.title}" — ${rec.artist} (${rec.releaseYear}).`);
  return inserted!.id;
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Idempotent purchase (copy) insert. Skip if a row already exists with the
 * same (tenantId, recordId, purchasePrice, status) — sufficient uniqueness for
 * the deterministic seed dataset.
 */
export async function ensurePurchase(
  ownerPool: Pool,
  input: {
    tenantId: number;
    recordId: number;
    ek: string;
    vk: string;
    status: RecordStatus;
    conditionRecord: number | null;
    conditionCover: number | null;
    soldPrice?: string;
    soldDate?: Date;
  },
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.purchases.id })
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.tenantId, input.tenantId),
        eq(schema.purchases.recordId, input.recordId),
        eq(schema.purchases.purchasePrice, input.ek),
        eq(schema.purchases.status, input.status),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return; // already seeded
  }

  await db.insert(schema.purchases).values({
    tenantId: input.tenantId,
    recordId: input.recordId,
    purchasePrice: input.ek,
    targetPrice: input.vk,
    status: input.status,
    conditionRecord: input.conditionRecord,
    conditionCover: input.conditionCover,
    soldPrice: input.soldPrice ?? null,
    soldDate: input.soldDate ?? null,
  });

  console.log(`[seed]   Purchase for record ${input.recordId} (${input.status}) created.`);
}

/**
 * Idempotent permalink insert. Skip if (tenantId, slug) already exists.
 */
export async function ensurePermalink(
  ownerPool: Pool,
  input: {
    tenantId: number;
    slug: string;
    filter: PermalinkSpec['filter'];
  },
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.permalinks.id })
    .from(schema.permalinks)
    .where(and(eq(schema.permalinks.tenantId, input.tenantId), eq(schema.permalinks.slug, input.slug)))
    .limit(1);

  if (existing.length > 0) {
    return; // already seeded
  }

  await db.insert(schema.permalinks).values({
    tenantId: input.tenantId,
    slug: input.slug,
    filter: input.filter,
  });

  console.log(`[seed]   Permalink "/${input.slug}" created.`);
}

/**
 * Seeds records, purchases, and permalinks for a tenant.
 * Exported so integration tests can call it directly with a testcontainer ownerPool.
 */
export async function seedTenantInventory(
  ownerPool: Pool,
  tenantId: number,
  records: RecordSeed[],
  purchases: PurchaseSpec[],
  permalinks: PermalinkSpec[],
): Promise<void> {
  const recordIds: number[] = [];
  for (const rec of records) {
    const id = await ensureRecord(tenantId, rec, ownerPool);
    recordIds.push(id);
  }

  for (const spec of purchases) {
    const recordId = recordIds[spec.recordIndex];
    if (recordId === undefined) {
      throw new Error(`[seed] Invalid recordIndex ${spec.recordIndex} (records.length=${records.length})`);
    }
    await ensurePurchase(ownerPool, {
      tenantId,
      recordId,
      ek: spec.ek,
      vk: spec.vk,
      status: spec.status,
      conditionRecord: spec.conditionRecord,
      conditionCover: spec.conditionCover,
      soldPrice: spec.soldPrice,
      soldDate: spec.soldDate,
    });
  }

  for (const pl of permalinks) {
    await ensurePermalink(ownerPool, { tenantId, slug: pl.slug, filter: pl.filter });
  }
}

// ---------------------------------------------------------------------------
// CLI helpers (unchanged from Slice 0 except loginUrlFor / printCredentials)
// ---------------------------------------------------------------------------

function loginUrlFor(slug: string, protocol: string, rootDomain: string): string {
  const port = process.env['APP_PORT'] ?? '3000';
  const isDefault = (protocol === 'https' && port === '443') || (protocol === 'http' && port === '80');
  const portPart = isDefault ? '' : `:${port}`;
  return `${protocol}://${slug}.${rootDomain}${portPart}/login`;
}

async function sendCredentialMail(
  tenant: ProvisionInput,
  password: string | null,
  protocol: string,
  rootDomain: string,
): Promise<void> {
  if (password === null) return;
  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: tenant.adminEmail,
      tenantName: tenant.name,
      loginUrl: loginUrlFor(tenant.slug, protocol, rootDomain),
      temporaryPassword: password,
    });
    console.log(`[seed]   Credential mail dispatched to ${tenant.adminEmail} (${process.env['MAIL_DRIVER'] ?? 'console'}).`);
  } catch (err) {
    console.warn(`[seed]   WARN: credential mail to ${tenant.adminEmail} failed (non-fatal):`, err instanceof Error ? err.message : err);
  }
}

function printCredentials(tenant: ProvisionInput, password: string | null, protocol: string, rootDomain: string): void {
  console.log('[seed] ┌──────────────────────────────────────────────────────');
  console.log(`[seed] │  Tenant:   ${tenant.name} (${tenant.slug})`);
  console.log(`[seed] │  Email:    ${tenant.adminEmail}`);
  if (password !== null) {
    console.log(`[seed] │  Password: ${password}`);
  } else {
    console.log(`[seed] │  [skipped — password unchanged, SEED_ADMIN_PASSWORD not set]`);
  }
  console.log(`[seed] │  URL:      ${protocol}://${tenant.slug}.${rootDomain}`);
  console.log('[seed] └──────────────────────────────────────────────────────');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const ownerUrl = process.env['DATABASE_OWNER_URL'];
  if (!ownerUrl) {
    throw new Error('[seed] DATABASE_OWNER_URL is not set. Check your .env file.');
  }

  const protocol   = process.env['APP_PROTOCOL'] ?? 'http';
  const rootDomain = process.env['ROOT_DOMAIN']  ?? 'localhost';

  const ownerPool = new Pool({ connectionString: ownerUrl });

  try {
    console.log('[seed] Starting seed run...');

    // ── demo tenant ────────────────────────────────────────────────────────
    const { tenantId: demoId, usedPassword: demoPw } = await ensureTenant(DEMO_TENANT, ownerPool);
    printCredentials(DEMO_TENANT, demoPw, protocol, rootDomain);
    await sendCredentialMail(DEMO_TENANT, demoPw, protocol, rootDomain);

    console.log(`[seed] Seeding inventory for "${DEMO_TENANT.slug}"...`);
    await seedTenantInventory(ownerPool, demoId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);

    // ── vinylcave tenant ───────────────────────────────────────────────────
    const { tenantId: vinylId, usedPassword: vinylPw } = await ensureTenant(VINYLCAVE_TENANT, ownerPool);
    printCredentials(VINYLCAVE_TENANT, vinylPw, protocol, rootDomain);
    await sendCredentialMail(VINYLCAVE_TENANT, vinylPw, protocol, rootDomain);

    console.log(`[seed] Seeding inventory for "${VINYLCAVE_TENANT.slug}"...`);
    await seedTenantInventory(ownerPool, vinylId, VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS);

    console.log('[seed] Done. Safe to re-run (idempotent).');
  } finally {
    await ownerPool.end();
  }
}

// ---------------------------------------------------------------------------
// CLI entry guard — run main() only when executed directly, not on import.
// This allows tests to import and call the exported helpers safely.
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
if (
  process.argv[1] === __filename ||
  process.argv[1] === __filename.replace(/\.ts$/, '.js')
) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('[seed] Fatal error:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run it (PASS)**

```bash
pnpm test tests/seed.integration.test.ts
```

All five tests must pass:
1. `exports ensurePurchase, ensurePermalink, seedTenantInventory and all dataset constants` — PASS
2. `seed is idempotent: two runs produce identical row counts` — PASS
3. `demo dataset shape: 15 records, 16 copies, 11 available, 2 permalinks` — PASS
4. `vinylcave dataset shape: 15 records, 16 copies, 11 available, 2 permalinks` — PASS
5. `two tenants seeded from different datasets share no rows` — PASS

Then verify the CLI still works end-to-end:

```bash
pnpm typecheck
pnpm lint
pnpm db:seed
pnpm db:seed   # second run — must print "already exists / skipping" throughout, same exit 0
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts tests/seed.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(slice1): enrich seed with 15 records/tenant, copies, and permalinks

Adds ensurePurchase + ensurePermalink helpers (exported for integration tests),
expands DEMO and VINYLCAVE datasets to 15 records each with 16 copies per tenant
(status/condition/EK/VK mix: 11 verfuegbar, 3 verkauft, 2 verliehen) and 2
permalinks each. Seed is deterministic and idempotent; integration test verifies
both properties plus exact shape counts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: E2E acceptance

**Files:**
- Modify: `e2e/helpers.ts` (append 4 slug constants + `assertNoPrivateFields`)
- Create: `e2e/inventory.spec.ts`
- Create: `e2e/dashboard.spec.ts`
- Create: `e2e/storefront.spec.ts`

**Interfaces:**

Consumes — exact cross-task DOM contracts prior tasks must implement for these specs to pass:

| Contract | Provided by | Required value |
|---|---|---|
| `data-testid="kpi-inventory-available"` | Task 4 `InventoryKpi` (or `KpiCard`) | text content = integer string (e.g. `"11"`) — the count of `verfuegbar` copies |
| `data-testid="panel-letzte-verkaeufe"` | Task 4 `EmptyPanel` wrapper | wraps the "Letzte Verkäufe" empty panel |
| `data-testid="panel-wunschlisten"` | Task 4 `EmptyPanel` wrapper | wraps the "Wunschlisten-Treffer" panel |
| `data-testid="inventory-tiles"` | Task 3 `InventoryTiles` root element | present only in tiles view, absent in list view |
| `aria-label="Format filtern"` | Task 3 `FilterBar` `<select>` | design handoff verbatim |
| `aria-label="Zustand filtern"` | Task 3 `FilterBar` `<select>` | design handoff verbatim |
| `<button>` with text `/kacheln/i` | Task 3 `ViewToggle` SegmentedControl | tiles toggle button |
| `<button>` with text `/liste/i` | Task 3 `ViewToggle` SegmentedControl | list toggle button |
| `<button>` with text `/im lager/i` | Task 3 `StatusTabs` | verfuegbar tab |
| `<input placeholder="Im Sortiment suchen — Titel, Artist, Label, Katalog-Nr…">` | Task 3 `FilterBar` | design handoff verbatim |
| `<button>` with text `/zurücksetzen/i` | Task 3 `FilterBar` | Zurücksetzen ghost button |
| `<article>` elements in storefront grid | Task 5 `StorefrontGrid` | each record card rendered as `<article>` |
| `<input placeholder="In diesen Ergebnissen suchen — Titel oder Künstler…">` | Task 5 `StorefrontSearch` | design handoff verbatim |
| Availability badge text `"Verfügbar im Store"` / `"Nur noch 1×"` | Task 5 `StorefrontGrid` | from design handoff: `in.label` / `low.label` |
| Seeded slug `jazz` for both tenants | Task 6 `ensurePermalink` | `{genre:['Jazz']}` |
| Seeded slug `neu` for both tenants | Task 6 `ensurePermalink` | `{}` (full in-stock) |
| `DEMO_URL`, `VINYLCAVE_URL`, `DEMO_EMAIL`, `DEMO_PASSWORD`, `VC_EMAIL`, `VC_PASSWORD`, `login()` | `e2e/helpers.ts` (Slice 0) | already present |

Produces: three acceptance spec files that gate the Slice-1 merge. All tests must be green against `docker compose up -d && pnpm db:seed` before the branch may be merged.

---

- [ ] **Step 1: Extend `e2e/helpers.ts`**

Append after the existing `login` export (do not remove any existing code):

```ts
// ── Slice-1 additions ──────────────────────────────────────────────────────

/** Seeded public permalink slugs used in E2E specs (Task 6 ensurePermalink). */
export const DEMO_JAZZ_SLUG = 'jazz';
export const DEMO_NEU_SLUG  = 'neu';
export const VC_VINYL_SLUG  = 'vinyl';
export const VC_NEU_SLUG    = 'neu';

/**
 * Assert the full rendered HTML of the current page contains none of the private
 * inventory field names that must never appear on the public storefront.
 *
 * Covers: purchasePrice / targetPrice / conditionRecord / conditionCover
 * (both camelCase and snake_case forms, to catch RSC payloads and HTML attrs).
 */
export async function assertNoPrivateFields(page: Page): Promise<void> {
  const html = await page.content();
  // Field-name scan (camelCase + snake_case — catches RSC payloads and HTML attrs)
  expect(html).not.toMatch(/purchase_price|purchasePrice/i);
  expect(html).not.toMatch(/target_price|targetPrice/i);
  expect(html).not.toMatch(/condition_record|conditionRecord/i);
  expect(html).not.toMatch(/condition_cover|conditionCover/i);
  // Value-level scan — a known seeded VK must never appear in the rendered output
  // (guards against regressions that emit raw price values into meta strings or attrs)
  expect(html).not.toContain('24.90'); // seeded VK for Violator (Task 6 VINYLCAVE_PURCHASES[5])
}
```

- [ ] **Step 2: Write `e2e/inventory.spec.ts`** (FAIL until Tasks 1-6 merged + seeded)

```ts
/**
 * E2E acceptance — Lagerbestand screen (/inventar).
 *
 * Covers §10 criteria 2 (filter/search/status), 7 (E2E list↔tiles toggle,
 * format filter, status tab, search, reset).
 *
 * Prerequisites: docker compose up -d; pnpm db:migrate; pnpm db:seed.
 */
import { test, expect } from '@playwright/test';
import { DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD, login } from './helpers';

test.describe('Lagerbestand (/inventar)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
  });

  test('renders seeded copies in list view with Treffer count visible', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');
    // Default view: table is rendered
    const table = page.locator('table');
    await expect(table).toBeVisible();
    // At least one data row present (seed has copies for demo tenant)
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    // FilterBar right side shows "N Treffer"
    await expect(page.getByText(/treffer/i)).toBeVisible();
  });

  test('ViewToggle switches list → tiles → list', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');

    // Start in list view: table visible, tiles absent
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('[data-testid="inventory-tiles"]')).toHaveCount(0);

    // Click "Kacheln" segment
    await page.getByRole('button', { name: /kacheln/i }).click();
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.locator('[data-testid="inventory-tiles"]')).toBeVisible();

    // Click "Liste" segment to restore
    await page.getByRole('button', { name: /liste/i }).click();
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('[data-testid="inventory-tiles"]')).toHaveCount(0);
  });

  test('format filter sets URL param and returns matching rows', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');
    const totalRows = await page.locator('tbody tr').count();

    // Select "Vinyl" in the Format combobox (aria-label verbatim from handoff)
    await page.getByRole('combobox', { name: /format filtern/i }).selectOption('Vinyl');
    await page.waitForURL(/[?&]format=Vinyl/);

    // URL carries the filter param
    expect(page.url()).toContain('format=Vinyl');
    // At least one Vinyl row present; total ≤ unfiltered (seed has mixed formats)
    const filteredRows = await page.locator('tbody tr').count();
    expect(filteredRows).toBeGreaterThan(0);
    expect(filteredRows).toBeLessThanOrEqual(totalRows);
  });

  test('status tab "im Lager" updates URL to status=verfuegbar', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');

    // Click the "im Lager" status tab button (StatusTabs component)
    await page.getByRole('button', { name: /im lager/i }).click();
    await page.waitForURL(/status=verfuegbar/);

    expect(page.url()).toContain('status=verfuegbar');
    // verfuegbar rows visible (majority of seed copies are verfuegbar)
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  test('search input narrows rows and sets q URL param', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');
    const totalBefore = await page.locator('tbody tr').count();

    // FilterBar search field — placeholder verbatim from design handoff
    await page.getByPlaceholder(/Im Sortiment suchen/i).fill('a');
    // FilterBar pushes ?q=a via router.push
    await page.waitForURL(/[?&]q=a/i);

    const filteredCount = await page.locator('tbody tr').count();
    expect(filteredCount).toBeLessThanOrEqual(totalBefore);
  });

  test('"Zurücksetzen" clears all filter params and returns to bare /inventar', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar?format=Vinyl&status=verfuegbar&q=test`);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /zurücksetzen/i }).click();
    await page.waitForURL(`${DEMO_URL}/inventar`);

    const url = page.url();
    expect(url).not.toContain('format=');
    expect(url).not.toContain('status=');
    expect(url).not.toContain('q=');
  });
});
```

- [ ] **Step 3: Write `e2e/dashboard.spec.ts`** (FAIL until Task 4 merged + seeded)

```ts
/**
 * E2E acceptance — Dashboard / Übersicht (/).
 *
 * Covers §10 criterion 3 (real KPIs + calm empty states) and §10 criterion 7.
 *
 * Prerequisites: docker compose up -d; pnpm db:migrate; pnpm db:seed.
 */
import { test, expect } from '@playwright/test';
import { DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD, login } from './helpers';

test.describe('Dashboard / Übersicht (/)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
  });

  test('shows real "Artikel im Lager" KPI with a positive available-copy count', async ({ page }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    // Label visible
    await expect(page.getByText(/artikel im lager/i)).toBeVisible();

    // data-testid="kpi-inventory-available" must be present and hold a positive integer
    // (cross-task contract: Task 4 must add this testid to the count text node)
    const countEl = page.locator('[data-testid="kpi-inventory-available"]');
    await expect(countEl).toBeVisible();
    const raw = (await countEl.innerText()).trim();
    const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  test('format-split labels (Vinyl / CD) visible inside inventory KPI area', async ({ page }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    // At least one format-split label must appear (seed has Vinyl + CD copies)
    const vinylCount = await page.getByText(/\bvinyl\b/i).count();
    const cdCount    = await page.getByText(/\bcd\b/i).count();
    expect(vinylCount + cdCount).toBeGreaterThan(0);
  });

  test('"Tagesumsatz" card shows calm empty state — no fabricated non-zero revenue', async ({ page }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(/tagesumsatz/i)).toBeVisible();

    // An empty-state indicator must be present on the page:
    // "noch keine Verkäufe", "—", "Slice 3", or "folgt" are all acceptable.
    const emptyIndicators = page.getByText(/noch keine verkäufe|ankauf folgt|slice 3|folgt/i);
    await expect(emptyIndicators.first()).toBeVisible();

    // The page must NOT contain a non-zero euro amount attributed to Tagesumsatz.
    // Strategy: the full page body must not show a pattern like "€ 1.234" or "€ 99"
    // where the only legitimate non-zero € value is the Inventarwert (which uses
    // a different label). We scope the check by asserting the "Tagesumsatz" region
    // carries either "€ 0" or no euro amount at all.
    // (Inventarwert appearing elsewhere on the page is expected and allowed.)
    const tagesumsatzSection = page.getByText(/tagesumsatz/i)
      .locator('xpath=ancestor::*[self::section or self::article or self::div][1]');
    const sectionText = await tagesumsatzSection.innerText();
    // Must not match "€ <non-zero number>"
    expect(sectionText).not.toMatch(/€\s*[1-9][\d.,]*/);
  });

  test('"Letzte Verkäufe" panel shows its empty-state placeholder text', async ({ page }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    // data-testid="panel-letzte-verkaeufe" (cross-task contract: Task 4 EmptyPanel wrapper)
    const panel = page.locator('[data-testid="panel-letzte-verkaeufe"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/noch keine verkäufe/i)).toBeVisible();
  });

  test('"Wunschlisten-Treffer" panel shows its empty-state placeholder text', async ({ page }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    // data-testid="panel-wunschlisten" (cross-task contract: Task 4 EmptyPanel wrapper)
    const panel = page.locator('[data-testid="panel-wunschlisten"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/noch keine treffer/i)).toBeVisible();
  });
});
```

- [ ] **Step 4: Write `e2e/storefront.spec.ts`** (FAIL until Tasks 5-6 merged + seeded)

```ts
/**
 * E2E acceptance — Public Schaufenster (s/[permalink]).
 *
 * Covers §10 criteria 4 (no price leak, 404 on unknown, tenant isolation) and
 * §10 criterion 7 (grid + availability badges + in-results search).
 *
 * Prerequisites: docker compose up -d; pnpm db:migrate; pnpm db:seed.
 * No authentication required — this is a public route.
 */
import { test, expect } from '@playwright/test';
import {
  DEMO_URL,
  VINYLCAVE_URL,
  DEMO_JAZZ_SLUG,
  VC_VINYL_SLUG,
  assertNoPrivateFields,
} from './helpers';

test.describe('Public Schaufenster (s/[permalink])', () => {
  test('demo/jazz permalink renders grid of record cards with availability badges', async ({ page }) => {
    const res = await page.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    // Must not 404 (slug seeded by Task 6)
    expect(res?.status()).toBe(200);
    await page.waitForLoadState('domcontentloaded');

    // StorefrontGrid renders each record as <article> (cross-task contract: Task 5)
    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();

    // Availability badges — exact labels from design handoff (availability.in / availability.low)
    const badgesIn  = page.getByText('Verfügbar im Store');
    const badgesLow = page.getByText('Nur noch 1×');
    const badgeCount = (await badgesIn.count()) + (await badgesLow.count());
    expect(badgeCount).toBeGreaterThan(0);
  });

  test('in-results search narrows cards and sets ?q= URL param', async ({ page }) => {
    await page.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    await page.waitForLoadState('domcontentloaded');
    const totalCards = await page.getByRole('article').count();

    // StorefrontSearch input — placeholder verbatim from design handoff
    await page.getByPlaceholder(/In diesen Ergebnissen suchen/i).fill('a');
    await page.waitForURL(/[?&]q=a/i);

    const filteredCards = await page.getByRole('article').count();
    expect(filteredCards).toBeLessThanOrEqual(totalCards);
  });

  test('storefront page HTML exposes no private inventory field names', async ({ page }) => {
    await page.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    await page.waitForLoadState('domcontentloaded');
    // assertNoPrivateFields scans raw HTML for purchasePrice / targetPrice /
    // conditionRecord / conditionCover in both camelCase and snake_case forms.
    await assertNoPrivateFields(page);
  });

  test('unknown permalink slug returns 404', async ({ page }) => {
    const res = await page.goto(`${DEMO_URL}/s/nicht-vorhanden-xqz99`);
    expect(res?.status()).toBe(404);
  });

  test('vinylcave jazz permalink serves vinylcave records, never demo records', async ({ browser }) => {
    // 1. Collect all card titles visible on demo's jazz storefront.
    const demoCtx  = await browser.newContext();
    const demoPage = await demoCtx.newPage();
    await demoPage.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    await demoPage.waitForLoadState('domcontentloaded');
    // Collect artist/title texts from every article card's heading
    const demoTitles = await demoPage
      .getByRole('article')
      .locator('h3, h2, [data-slot="title"]')
      .allInnerTexts();
    await demoCtx.close();

    // 2. Load vinylcave jazz storefront (public — no auth).
    const vcCtx  = await browser.newContext();
    const vcPage = await vcCtx.newPage();
    const vcRes  = await vcPage.goto(`${VINYLCAVE_URL}/s/${VC_VINYL_SLUG}`);
    expect(vcRes?.status()).toBe(200);
    await vcPage.waitForLoadState('domcontentloaded');

    // Page stays on vinylcave domain
    expect(vcPage.url()).toMatch(/vinylcave\.localhost/);
    // Shows its own records
    await expect(vcPage.getByRole('article').first()).toBeVisible();

    // No cross-tenant contamination: demo.localhost must not appear in vc HTML
    const vcHtml = await vcPage.content();
    expect(vcHtml).not.toContain('demo.localhost');

    // Title-level isolation: none of demo's jazz titles may appear verbatim on vinylcave.
    // (Task 6 seed must use distinct title data per tenant; RLS correctness is proven
    // by Task 5 integration tests — this assertion is the E2E cross-check.)
    const vcTitles = await vcPage
      .getByRole('article')
      .locator('h3, h2, [data-slot="title"]')
      .allInnerTexts();
    for (const demoTitle of demoTitles.filter(Boolean)) {
      expect(vcTitles, `demo title "${demoTitle}" must not appear on vinylcave storefront`)
        .not.toContain(demoTitle);
    }

    // No private fields on vinylcave page either
    await assertNoPrivateFields(vcPage);
    await vcCtx.close();
  });
});
```

- [ ] **Step 5: Run FAIL (expected — Tasks 1-6 not yet merged)**

```bash
docker compose up -d
pnpm e2e
```

Expected failures (representative):
- `inventory.spec` → `expect(rows.first()).toBeVisible()` — table empty (no seed) or route 404 (Task 3 not merged)
- `dashboard.spec` → `expect(countEl).toBeVisible()` — `data-testid="kpi-inventory-available"` absent (Task 4 not merged)
- `storefront.spec` → `expect(res?.status()).toBe(200)` — 404 because `jazz` not seeded (Task 6 not run) and/or storefront route not implemented (Task 5 not merged)

- [ ] **Step 6: Prerequisites before PASS run**

Merge Tasks 1-6 onto `feat/v2-slice1-inventory` in order (1 → 2 → 3,4 → 5 → 6), then:

```bash
# ensure compose is running and DB is up to date
docker compose up -d
pnpm db:migrate
pnpm db:seed
```

Verify seed ran successfully (should emit counts per tenant, 2 permalinks/tenant, idempotent).

- [ ] **Step 7: Run PASS**

```bash
pnpm e2e
```

All 16 tests must be green. If any single spec file fails, check:
- `inventory.spec` row-count failures → inspect seed via `pnpm db:seed` re-run; verify `docker compose logs app` for route errors
- `dashboard.spec` `kpi-inventory-available` absent → Task 4 must add `data-testid="kpi-inventory-available"` to the count node
- `storefront.spec` title-overlap failure → Task 6 seed data for demo and vinylcave jazz collections must use distinct record titles
- `storefront.spec` private-field failure → Task 5 `listStorefront` query must not select `purchasePrice`/`targetPrice`/`conditionRecord`/`conditionCover`

- [ ] **Step 8: Commit**

```bash
git add e2e/helpers.ts e2e/inventory.spec.ts e2e/dashboard.spec.ts e2e/storefront.spec.ts
git commit -m "$(cat <<'EOF'
feat(slice1): e2e acceptance — inventory, dashboard, storefront

Covers §10 criteria 2-4, 7: list/tile toggle, format filter + status tab
+ search + reset (inventory); real KPI count + calm empty states (dashboard);
availability badges + in-results search + no-leak HTML scan + tenant
isolation (storefront). All 16 tests green against docker compose stack.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance-Criteria Mapping (spec §10 → tasks)

| §10 criterion | Verified by |
|---|---|
| 1. RLS isolation (inventory + storefront tenant-scoped, no cross-tenant) | Tasks 2, 5, 7 |
| 2. Filter/search/status correct subsets; counts/value == seed | Tasks 2, 7 |
| 3. Dashboard real KPIs == seed; calm empty states | Tasks 4, 7 |
| 4. Storefront in-stock only; no price/condition leaked; unknown permalink → 404 | Tasks 5, 7 |
| 5. Migration 0003 clean; recordStatus removed, purchases status/condition added; drift-guard green | Task 1 |
| 6. Design fidelity to handoff; a11y baseline | Tasks 3, 4, 5 |
| 7. E2E on demo.localhost (inventory list/tile/filter/status, dashboard, storefront, two-tenant isolation) | Task 7 |
