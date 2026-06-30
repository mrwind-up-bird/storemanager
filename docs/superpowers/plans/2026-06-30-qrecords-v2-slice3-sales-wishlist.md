# Slice 3 — Verkauf/POS + Wunschlisten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Locked contracts companion:** `docs/superpowers/plans/2026-06-30-qrecords-v2-slice3-CONTRACTS.md` (C1–C14). It is the single source of truth for every shared enum, table definition, signature, zod schema, QUEUE name, email copy, RLS SQL shape, and the FROZEN testid registry. Each task references it VERBATIM — when a name/type/testid appears in both, the contracts win.

**Goal:** Ship the canonical sale path (POS cart + handoff-true single-item sell modal), reservations, and staff-managed wishlists with Ankauf-triggered matching and staff-confirmed email notification — on the existing multi-tenant codebase.

**Architecture:** New `numeric(10,2)`-money tables (`quick_items`, `transactions`, `transaction_items`, `wishlists`, `wishlist_matches`) under the same Postgres-RLS regime as Slice 0–2. Sales/reservations run inside one `withTenant` transaction with `SELECT … FOR UPDATE` + status guard (no double-sell). Wishlist matching and notification are async pg-boss jobs (`tenant.wishlist.match`, `tenant.wishlist.notify`); `performAnkauf` enqueues the match job post-commit. UI follows the 2026 handoff visual language (the Kasse cart is a new screen in that language; the single-item sell modal is pixel-true to the handoff).

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript strict · Drizzle ORM ^0.38 · PostgreSQL 17 · pg-boss ^10 · Auth.js v5 · zod ^3.24 · Vitest ^2.1 + @testcontainers/postgresql · Playwright · pnpm · Node 22.

## Global Constraints

Every task's requirements implicitly include this section (exact values from the spec + CONTRACTS).

- **Money:** stored as `numeric(10,2)` (matches existing `purchases.purchasePrice/soldPrice`; drizzle returns it as a string). Exact arithmetic (subtotal, discount, percent→amount) is done INTERNALLY in integer cents via the `src/lib/money.ts` helper, then formatted back to a 2-decimal string. NEVER use JS float for money. `discount` is clamped `0 ≤ discount ≤ subtotal`; `total = subtotal − discount`; totals are recomputed SERVER-SIDE (client prices are never authoritative for inventory/quick lines).
- **Multi-tenant RLS:** the only runtime DB surface is `withTenant(ctx, fn)` (one tx, `set_config('app.current_tenant'/'app.current_user_id', …, true)`). All 5 new tables get `ENABLE`+`FORCE ROW LEVEL SECURITY`, the `tenant_id` GUC default, a `tenant_isolation` + `superadmin_bypass` policy (exact form of `drizzle/0005_discogs_rls.sql`), `GRANT SELECT,INSERT,UPDATE,DELETE` AND the load-bearing `GRANT USAGE, SELECT ON SEQUENCE <t>_id_seq TO qr_app`. `qr_app` stays NOBYPASSRLS. Add all 5 tables to `TENANT_SCOPED_TABLES` (`src/db/assertions.ts`) AND keep the mocked baseline `SOUND_TENANT_ID_TABLES` in `tests/db/assertions.test.ts` in lockstep (Slice-2 lesson — run full `pnpm test` before final review).
- **RBAC + CSRF:** every mutating server action starts `const user = await requireSession();` then gates staff-only `if (user.role === 'kunde') forbidden();` (allowed: `mitarbeiter`/`admin`/`superadmin`) and validates origin via `isValidOrigin()`. No customer name/email or sales internals ever reach the public storefront.
- **Status:** the existing `record_status` enum is `verfuegbar` (note spelling) | `reserviert` | `verkauft` | `verliehen`. This slice wires `verfuegbar→verkauft`, `verfuegbar→reserviert→verkauft`, `reserviert→verfuegbar`. The `verliehen` transition is OUT of scope (the value stays visible). A sale of a copy whose status ∉ {`verfuegbar`,`reserviert`} fails the whole tx (fail-closed).
- **`performSale`** also writes the existing `purchases` columns `soldPrice` (= line unitPrice), `soldDate` (= now), `paymentMethod` (= transaction method as string) on each sold inventory copy; `purchases.paymentMethod` stays `text`.
- **Jobs:** idempotent; `boss.send(QUEUE.x, payload, { retryLimit: 5, retryBackoff: true })`; transient errors RETHROW (retry), permanent errors return; post-commit `enqueue*` is isolated in its own try/catch so an enqueue failure never orphans committed state or double-writes on retry. Idempotency tests are NON-vacuous (spy the side effect, assert call count / newly-inserted rows).
- **Design system:** semantic CSS vars only — text on accent uses `var(--on-accent)`, never raw `#hex`; introduce NO new `var(--accent-ink)`. Status via `StatusBadge`. The Kasse screen is new but uses the handoff's payment-cluster tokens/components.
- **Testids:** use ONLY the FROZEN C12 registry. Controls without a registry testid (inventory "Verkaufen" trigger, Kasse search-result rows, ad-hoc inputs) are selected by accessible name/label — implementers must give them accessible names.
- **Migrations:** Drizzle DDL `drizzle/0006_*.sql`; hand-authored RLS `drizzle/0007_slice3_rls.sql`; both registered in `drizzle/meta/_journal.json` with snapshots.
- **Commits:** every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure (one responsibility per file; full map in CONTRACTS C14)

**Data layer**
- `src/db/schema.ts` (M) — 3 enums + 5 tables (`quickItems`, `transactions`, `transactionItems`, `wishlists`, `wishlistMatches`).
- `drizzle/0006_*.sql` (C, generated), `drizzle/0007_slice3_rls.sql` (C, hand-authored RLS), `drizzle/meta/*` (M).
- `src/db/assertions.ts` (M) — `TENANT_SCOPED_TABLES` += 5; `tests/db/assertions.test.ts` (M) baseline sync.

**Domain / services**
- `src/lib/money.ts` (C) — money helper (string↔cents, percent, clamp).
- `src/lib/sales.ts` (C) — cart types, `computeCartTotals`, `performSale`, `reserveCopy`, `cancelReservation`.
- `src/lib/quickItems.ts` (C) — quick-item catalogue queries.
- `src/lib/wishlist.ts` (C) — `matchWishlists` (pure), `findAndPersistWishlistMatches`, `createWishlist`, `listWishlists`, `listPendingMatches`.
- `src/lib/email/wishlistNotification.ts` (C) — `sendWishlistNotificationEmail` template.
- `src/lib/jobs.ts` (M) — `enqueueWishlistMatch`, `enqueueWishlistNotification`.
- `src/lib/ankauf.ts` (M) is unchanged; the post-commit match enqueue lives in `src/app/(app)/ankauf/actions.ts` (M).

**Worker**
- `src/worker/index.ts` (M) — `QUEUE.wishlistMatch`/`wishlistNotify` + registrations.
- `src/worker/jobs/wishlistMatch.ts` (C), `src/worker/jobs/wishlistNotify.ts` (C).

**App / UI**
- `src/app/(app)/kasse/{page.tsx,actions.ts,_components/*}` (C) — POS cart screen + `createSale`/reserve/quick actions.
- `src/app/(app)/inventar/_components/InventoryList.tsx` (M) + sell-modal/reserve wiring + `add-to-wishlist`.
- `src/app/(app)/wunschlisten/{page.tsx,actions.ts,_components/*}` (C/M) — wishlist CRUD + matches + Benachrichtigen-Modal.
- `src/app/(app)/_components/SidebarNav.tsx` (M) + `src/app/(app)/layout.tsx` (M) — staff-gated nav.
- `scripts/seed.ts` (M) — demo quick items + matching open wishlist.

**Tests:** colocated unit/integration per task (`tests/**`) + the E2E acceptance suite `e2e/sales-wishlist.spec.ts` and `e2e/helpers.ts` additions.

## Tasks

The 14 tasks below are ordered by dependency. Each is an independently testable deliverable that ends in a commit. Implement in order (T1 schema first; T14 E2E last).

---

### Task 1: Schema + migrations + RLS + assertions

**Files:**
- Modify: `src/db/schema.ts` — append C1 enums + C2 tables (+ exported TS types).
- Create: `drizzle/0006_slice3_sales_wishlist.sql` — drizzle-kit-generated DDL (3 enums, 5 tables, FKs, indexes, CHECK + UNIQUE constraints).
- Create: `drizzle/meta/0006_snapshot.json` — drizzle-kit-emitted snapshot.
- Create: `drizzle/0007_slice3_rls.sql` — hand-authored RLS (mirror of `drizzle/0005_discogs_rls.sql`, C13.2).
- Create: `drizzle/meta/0007_snapshot.json` — copy of `0006_snapshot.json` with bumped `id`/`prevId` (no schema delta; RLS is invisible to drizzle).
- Modify: `drizzle/meta/_journal.json` — register idx 6 (auto by drizzle-kit) + idx 7 (manual, `0007_slice3_rls`).
- Modify: `src/db/assertions.ts` — `TENANT_SCOPED_TABLES += 5`.
- Test (modify): `tests/db/assertions.test.ts` — `SOUND_TENANT_ID_TABLES += 5` (mock-baseline sync, Slice-2 lesson #2).
- Test (create): `tests/slice3-migration.integration.test.ts` — Testcontainers: RLS+FORCE+policies on all 5 tables, the per-table SEQUENCE grant is load-bearing, cross-tenant isolation, hardened CHECK/UNIQUE constraints present, `assertDatabaseSafety()` passes.

**Interfaces:**

- Consumes (existing codebase surfaces — do not redefine):
  - `recordStatusEnum = pgEnum('record_status', ['verfuegbar','reserviert','verkauft','verliehen'])` — note the umlaut-spelled-out literal **`verfuegbar`**.
  - FK targets already in `src/db/schema.ts`: `tenants.id`, `users.id`, `purchases.id`, `records.id`.
  - drizzle/pg-core imports already present in `schema.ts`: `boolean, check, index, integer, numeric, pgEnum, pgTable, serial, text, timestamp, unique` and `sql` from `drizzle-orm`.
  - `runMigrations(connectionString?: string): Promise<void>` (`@/db/migrate`).
  - `withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>` and `TenantCtx = { tenantId: number; userId: number | null }` (`@/db/tenant`).
  - `assertDatabaseSafety(): Promise<void>` (`@/db/assertions`) — boot guard whose bidirectional drift check couples `TENANT_SCOPED_TABLES` to the DB's tenant_id-bearing tables.
  - Test helpers `setupTestDatabase()` and `seedTenant({ slug, name }): Promise<{ tenantId, adminUserId }>` from `tests/helpers/db.ts` (boots PG 17 as `qr_owner`/`qr_app`, runs migrations, publishes env BEFORE any `@/db/*` import).

- Produces (later tasks T2–T14 import these VERBATIM — C1/C2/C13):
  - Enums + types (`@/db/schema`):
    - `paymentMethodEnum = pgEnum('payment_method', ['bar','karte','paypal','gutschein'])`; `type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number]`.
    - `wishlistStatusEnum = pgEnum('wishlist_status', ['open','notified','closed'])`; `type WishlistStatus`.
    - `wishlistMatchStatusEnum = pgEnum('wishlist_match_status', ['pending','notified','dismissed'])`; `type WishlistMatchStatus`.
  - Drizzle tables (`@/db/schema`):
    - `quickItems` { id, tenantId, name, price `numeric(10,2)`, active, createdAt }.
    - `transactions` { id, tenantId, soldByUserId→users.id, paymentMethod, subtotal, discount(default `'0'`), total, voucherCode(nullable), createdAt }.
    - `transactionItems` { id, tenantId, transactionId→transactions.id, purchaseId?(→purchases.id), quickItemId?(→quickItems.id), label, unitPrice, quantity(default 1) }.
    - `wishlists` { id, tenantId, createdByUserId→users.id, customerName, customerEmail, artist, label?, title?, country?, status(default `'open'`), createdAt }.
    - `wishlistMatches` { id, tenantId, wishlistId→wishlists.id, purchaseId→purchases.id, recordId→records.id, status(default `'pending'`), notifiedAt?, createdAt }; UNIQUE `(wishlistId, purchaseId)`.
  - Migrations: `drizzle/0006_slice3_sales_wishlist.sql` (DDL) + `drizzle/0007_slice3_rls.sql` (RLS for all 5 tables, incl. the load-bearing `*_id_seq` grants).
  - `TENANT_SCOPED_TABLES` (`@/db/assertions`) now enumerates the 5 new tables so the boot guard enforces their RLS.

> **Ordering note (read before executing):** `assertDatabaseSafety()`'s drift guard fails in BOTH directions — if `TENANT_SCOPED_TABLES` and the migrated DB's tenant_id-bearing tables disagree either way. The two are therefore atomically coupled and both land inside T1. Cycle 1 commits the assertions/mock-baseline sync first (fast, mocked unit test, no Docker); Cycle 2 commits the schema + migrations. The integration test in Cycle 2 asserts `assertDatabaseSafety()` passes, which requires Cycle 1 to be in place first. Between the two commits the EXISTING `tests/rls.integration.test.ts` "assertDatabaseSafety passes on the migrated database" case is transiently red (assertions expects 12 tenant tables; the migrated DB still has 7) — this is expected within T1 and goes green at the Cycle 2 commit. Per-task reviewers do not run the full suite; the controller runs full `pnpm test` at task end (Slice-2 cadence).

---

#### Cycle 1 — assertions + mock-baseline sync (unit)

- [ ] **Step 1: Update the unit mock baseline to expect the 5 new tenant-scoped tables (failing test)**

In `tests/db/assertions.test.ts`, replace the `SOUND_TENANT_ID_TABLES` array (the set a sound DB reports — it must mirror `TENANT_SCOPED_TABLES`) with the 12-table list:

```ts
/** The tenant_id-bearing tables a sound DB reports — matches TENANT_SCOPED_TABLES. */
const SOUND_TENANT_ID_TABLES = [
  'users',
  'user_detail',
  'sessions',
  'records',
  'purchases',
  'permalinks',
  'discogs_connections',
  'quick_items',
  'transactions',
  'transaction_items',
  'wishlists',
  'wishlist_matches',
];
```

This makes the "resolves on a correctly locked-down database" case arm the mock with 12 tables while `src/db/assertions.ts` still lists 7, so the drift guard fires (5 tables have `tenant_id` but are absent from `TENANT_SCOPED_TABLES`) and the case now rejects instead of resolving.

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `pnpm test tests/db/assertions.test.ts`
Expected: FAIL — "resolves on a correctly locked-down database" rejects with `TENANT_SCOPED_TABLES drift … have a tenant_id column but are absent from TENANT_SCOPED_TABLES: [quick_items, transaction_items, transactions, wishlist_matches, wishlists]`. (The two existing drift cases still pass.)

- [ ] **Step 3: Sync `TENANT_SCOPED_TABLES` in the implementation**

In `src/db/assertions.ts`, replace the `TENANT_SCOPED_TABLES` const with the 12-table list:

```ts
/** Physical names of tenant-scoped tables (must match the schema + RLS migrations). */
const TENANT_SCOPED_TABLES = [
  'users',
  'user_detail',
  'sessions',
  'records',
  'purchases',
  'permalinks',
  'discogs_connections',
  'quick_items',
  'transactions',
  'transaction_items',
  'wishlists',
  'wishlist_matches',
] as const;
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm test tests/db/assertions.test.ts`
Expected: PASS — all 9 cases green (the "resolves" case now sees `expected == discovered == 12`; both drift cases still throw on their injected `invoices` / removed `permalinks`).

- [ ] **Step 5: Commit**

```bash
git add src/db/assertions.ts tests/db/assertions.test.ts
git commit -m "test(slice3): register 5 tenant-scoped tables in the RLS drift guard

Sync TENANT_SCOPED_TABLES (src/db/assertions.ts) and the SOUND_TENANT_ID_TABLES
mock baseline (tests/db/assertions.test.ts) with the Slice 3 tables — quick_items,
transactions, transaction_items, wishlists, wishlist_matches — in lockstep so the
bidirectional boot drift guard stays sound (Slice-2 mock-drift lesson).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

#### Cycle 2 — schema + migrations + RLS (integration)

- [ ] **Step 6: Write the failing migration/RLS integration test**

Create `tests/slice3-migration.integration.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedTenant, setupTestDatabase } from './helpers/db';

/**
 * T1 deliverable gate: the Slice 3 DDL (0006) + hand-authored RLS (0007) applied to a real
 * PostgreSQL 17, proving for ALL five new tenant-scoped tables:
 *   - ENABLE + FORCE row security and BOTH named policies (tenant_isolation, superadmin_bypass);
 *   - the per-table SEQUENCE grant is LOAD-BEARING (Slice-0..2 lesson #7): revoke it → a qr_app
 *     INSERT fails closed; re-grant exactly as 0007 does → the INSERT succeeds (non-vacuous —
 *     the success is a real returned id, the failure a real "permission denied for sequence");
 *   - cross-tenant isolation (tenant A's quick_items row is invisible under withTenant(B));
 *   - the C2-hardened CHECK + UNIQUE constraints reached the DB (drizzle-kit generated them);
 *   - assertDatabaseSafety() passes against the migrated DB (TENANT_SCOPED_TABLES now 12).
 *
 * Deliberately reuses setupTestDatabase (which blanket-grants all sequences) and proves the
 * sequence grant's necessity via revoke→fail→regrant→succeed — the repo's established
 * mutate-and-restore idiom (see rls.integration.test.ts) — rather than a bespoke no-grant harness.
 */

let db: Awaited<ReturnType<typeof setupTestDatabase>>;
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let ownerPool: Pool;
let assertDatabaseSafety: (typeof import('@/db/assertions'))['assertDatabaseSafety'];

const NEW_TABLES = [
  'quick_items',
  'transactions',
  'transaction_items',
  'wishlists',
  'wishlist_matches',
] as const;

beforeAll(async () => {
  // setupTestDatabase publishes DATABASE_URL/DATABASE_OWNER_URL BEFORE we import @/db/*, so the
  // singleton pools bind to THIS container. Reset the module graph, then import dynamically.
  db = await setupTestDatabase();
  vi.resetModules();
  ({ withTenant } = await import('@/db/tenant'));
  ({ ownerPool } = await import('@/db/client'));
  ({ assertDatabaseSafety } = await import('@/db/assertions'));
}, 180_000);

afterAll(async () => {
  await db.teardown();
});

describe('Slice 3 migrations (0006 DDL + 0007 RLS)', () => {
  it('ENABLEs + FORCEs RLS and creates both named policies on every new table', async () => {
    for (const table of NEW_TABLES) {
      const flags = await ownerPool.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [table],
      );
      expect(flags.rows[0]?.relrowsecurity, `${table}.relrowsecurity`).toBe(true);
      expect(flags.rows[0]?.relforcerowsecurity, `${table}.relforcerowsecurity`).toBe(true);

      const policies = await ownerPool.query(
        `SELECT polname FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname`,
        [table],
      );
      expect(policies.rows.map((r) => r.polname)).toEqual(['superadmin_bypass', 'tenant_isolation']);
    }
  });

  it('carries the C2-hardened CHECK + UNIQUE constraints (drizzle-kit generated them)', async () => {
    const names = [
      'quick_items_price_nonneg',
      'transactions_discount_nonneg',
      'transactions_discount_le_subtotal',
      'transactions_total_consistent',
      'transactions_voucher_iff_gutschein',
      'transaction_items_quantity_positive',
      'transaction_items_kind_exclusive',
      'transaction_items_inventory_qty_one',
      'wishlist_matches_wishlist_purchase',
    ];
    const res = await ownerPool.query(`SELECT conname FROM pg_constraint WHERE conname = ANY($1)`, [
      names,
    ]);
    expect(res.rows.map((r) => r.conname as string).sort()).toEqual([...names].sort());
  });

  it('quick_items_id_seq GRANT is load-bearing (revoke → INSERT fails closed → regrant → succeeds)', async () => {
    const { tenantId } = await seedTenant({ slug: 'seqgrant', name: 'SeqGrant' });

    await ownerPool.query('REVOKE USAGE, SELECT ON SEQUENCE quick_items_id_seq FROM qr_app');
    try {
      await expect(
        withTenant({ tenantId, userId: null }, (tx) =>
          tx.execute(
            sql`insert into quick_items (tenant_id, name, price) values (${tenantId}, 'NoGrant', '1.00')`,
          ),
        ),
      ).rejects.toThrow(/sequence|permission/i);
    } finally {
      // Restore EXACTLY as 0007 grants it.
      await ownerPool.query('GRANT USAGE, SELECT ON SEQUENCE quick_items_id_seq TO qr_app');
    }

    const ok = await withTenant({ tenantId, userId: null }, (tx) =>
      tx.execute<{ id: number }>(
        sql`insert into quick_items (tenant_id, name, price) values (${tenantId}, 'Granted', '1.00') returning id`,
      ),
    );
    expect(Number(ok.rows[0]?.id)).toBeGreaterThan(0);
  });

  it('isolates quick_items across tenants (RLS tenant_isolation)', async () => {
    const a = await seedTenant({ slug: 'iso-a', name: 'Iso A' });
    const b = await seedTenant({ slug: 'iso-b', name: 'Iso B' });

    await withTenant({ tenantId: a.tenantId, userId: null }, (tx) =>
      tx.execute(
        sql`insert into quick_items (tenant_id, name, price) values (${a.tenantId}, 'A-coffee', '2.50')`,
      ),
    );

    const seenByB = await withTenant({ tenantId: b.tenantId, userId: null }, async (tx) => {
      const r = await tx.execute<{ name: string }>(sql`select name from quick_items`);
      return r.rows.map((row) => row.name);
    });
    expect(seenByB).not.toContain('A-coffee');

    const seenByA = await withTenant({ tenantId: a.tenantId, userId: null }, async (tx) => {
      const r = await tx.execute<{ name: string }>(sql`select name from quick_items`);
      return r.rows.map((row) => row.name);
    });
    expect(seenByA).toContain('A-coffee');
  });

  it('assertDatabaseSafety passes on the migrated database (12 tenant-scoped tables)', async () => {
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 7: Run the integration test to verify it fails**

Run: `pnpm test tests/slice3-migration.integration.test.ts`
Expected: FAIL — the migrations 0006/0007 do not exist yet, so `runMigrations` applies only 0000–0005. The first case rejects (`relrowsecurity` for `quick_items` is `undefined`, not `true`), the constraint case finds none of the 9 names, and the `assertDatabaseSafety` case throws (`TENANT_SCOPED_TABLES … are in TENANT_SCOPED_TABLES but have no tenant_id column in public: [quick_items, transaction_items, transactions, wishlist_matches, wishlists]`). (Requires Docker for Testcontainers.)

- [ ] **Step 8: Add the C1 enums + C2 tables to the schema**

In `src/db/schema.ts`, append the enums after the existing `discogsListingStatusEnum` block:

```ts
export const paymentMethodEnum = pgEnum('payment_method', [
  'bar',
  'karte',
  'paypal',
  'gutschein',
]);
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];

export const wishlistStatusEnum = pgEnum('wishlist_status', [
  'open',
  'notified',
  'closed',
]);
export type WishlistStatus = (typeof wishlistStatusEnum.enumValues)[number];

export const wishlistMatchStatusEnum = pgEnum('wishlist_match_status', [
  'pending',
  'notified',
  'dismissed',
]);
export type WishlistMatchStatus = (typeof wishlistMatchStatusEnum.enumValues)[number];
```

Then append the tables after `discogsConnections`, in this exact order (FK targets declared first):

```ts
// ── Slice 3: POS / Sales + Wishlists (RLS applied in 0007_slice3_rls.sql) ────

export const quickItems = pgTable(
  'quick_items',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantActiveIdx: index('quick_items_tenant_active_idx').on(t.tenantId, t.active),
    priceNonneg: check('quick_items_price_nonneg', sql`${t.price} >= 0`),
  }),
);

export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    soldByUserId: integer('sold_by_user_id')
      .notNull()
      .references(() => users.id),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
    discount: numeric('discount', { precision: 10, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 10, scale: 2 }).notNull(),
    voucherCode: text('voucher_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('transactions_tenant_created_idx').on(t.tenantId, t.createdAt),
    discountNonneg: check('transactions_discount_nonneg', sql`${t.discount} >= 0`),
    discountLeSubtotal: check('transactions_discount_le_subtotal', sql`${t.discount} <= ${t.subtotal}`),
    totalConsistent: check('transactions_total_consistent', sql`${t.total} = ${t.subtotal} - ${t.discount}`),
    // HARDENED (Nemesis/Ipcha): §3.3 invariant pushed to the DB — voucherCode present IFF gutschein.
    voucherIffGutschein: check(
      'transactions_voucher_iff_gutschein',
      sql`(${t.paymentMethod} = 'gutschein') = (${t.voucherCode} IS NOT NULL)`,
    ),
  }),
);

export const transactionItems = pgTable(
  'transaction_items',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id),
    purchaseId: integer('purchase_id').references(() => purchases.id),
    quickItemId: integer('quick_item_id').references(() => quickItems.id),
    label: text('label').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
  },
  (t) => ({
    tenantTransactionIdx: index('transaction_items_tenant_transaction_idx').on(t.tenantId, t.transactionId),
    tenantPurchaseIdx: index('transaction_items_tenant_purchase_idx').on(t.tenantId, t.purchaseId),
    quantityPositive: check('transaction_items_quantity_positive', sql`${t.quantity} >= 1`),
    // HARDENED (Nemesis/Ipcha): the derived position-type invariant pushed to the DB (defence-in-depth).
    //   inventory: purchaseId set, quickItemId null, quantity 1 · quick: quickItemId set, purchaseId null · adhoc: both null
    kindExclusive: check(
      'transaction_items_kind_exclusive',
      sql`NOT (${t.purchaseId} IS NOT NULL AND ${t.quickItemId} IS NOT NULL)`,
    ),
    inventoryQtyOne: check(
      'transaction_items_inventory_qty_one',
      sql`${t.purchaseId} IS NULL OR ${t.quantity} = 1`,
    ),
  }),
);

export const wishlists = pgTable(
  'wishlists',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    createdByUserId: integer('created_by_user_id')
      .notNull()
      .references(() => users.id),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    artist: text('artist').notNull(),
    label: text('label'),
    title: text('title'),
    country: text('country'),
    status: wishlistStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wishlists_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export const wishlistMatches = pgTable(
  'wishlist_matches',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    wishlistId: integer('wishlist_id')
      .notNull()
      .references(() => wishlists.id),
    purchaseId: integer('purchase_id')
      .notNull()
      .references(() => purchases.id),
    recordId: integer('record_id')
      .notNull()
      .references(() => records.id),
    status: wishlistMatchStatusEnum('status').notNull().default('pending'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wishlist_matches_tenant_status_idx').on(t.tenantId, t.status),
    wishlistPurchaseUnique: unique('wishlist_matches_wishlist_purchase').on(t.wishlistId, t.purchaseId),
  }),
);
```

Confirm the file still type-checks: `pnpm typecheck` — Expected: no errors (all referenced imports `boolean, check, index, integer, numeric, pgEnum, pgTable, serial, text, timestamp, unique` and `sql` are already imported in `schema.ts`).

- [ ] **Step 9: Generate the 0006 DDL migration**

drizzle-kit `generate` diffs `schema.ts` against the latest `meta/` snapshot offline (no DB connection needed) and writes the SQL, the `0006_snapshot.json`, and the idx-6 journal entry. Use an explicit name so the filename is deterministic:

```bash
pnpm db:generate --name slice3_sales_wishlist
```

Then verify the three emitted artifacts and that the enums, tables, and hardened constraints are present:

```bash
test -f drizzle/0006_slice3_sales_wishlist.sql
test -f drizzle/meta/0006_snapshot.json
grep -q '0006_slice3_sales_wishlist' drizzle/meta/_journal.json && echo 'journal idx6 OK'
for tok in payment_method wishlist_status wishlist_match_status \
           '"quick_items"' '"transactions"' '"transaction_items"' '"wishlists"' '"wishlist_matches"' \
           transactions_voucher_iff_gutschein transaction_items_kind_exclusive \
           transaction_items_inventory_qty_one wishlist_matches_wishlist_purchase; do
  grep -q "$tok" drizzle/0006_slice3_sales_wishlist.sql && echo "OK  $tok" || echo "MISSING  $tok"
done
```

Expected: `drizzle/0006_slice3_sales_wishlist.sql` and `drizzle/meta/0006_snapshot.json` exist, `journal idx6 OK` prints, and every token prints `OK …` (no `MISSING`). If any constraint is `MISSING`, the C2 schema block in Step 8 was not pasted verbatim — fix and re-run `pnpm db:generate`.

- [ ] **Step 10: Hand-author the 0007 RLS migration**

drizzle-kit does NOT manage RLS. Create `drizzle/0007_slice3_rls.sql` — mirror `drizzle/0005_discogs_rls.sql` exactly: per table, in order `quick_items`, `transactions`, `transaction_items`, `wishlists`, `wishlist_matches`, the 7-statement block, with `--> statement-breakpoint` between every statement and NO trailing breakpoint after the final statement. Both GRANTs are load-bearing (INSERT fails without the SEQUENCE grant):

```sql
-- Row-Level Security for the Slice 3 POS/Sales + Wishlist tables (quick_items, transactions,
-- transaction_items, wishlists, wishlist_matches). drizzle-kit does NOT manage RLS, so this is
-- hand-written and registered in meta/_journal.json after the 0006 DDL migration. Same shape as
-- 0005_discogs_rls.sql: ENABLE + FORCE RLS, tenant_id default from the request-scoped GUC
-- (NULLIF-guarded), tenant_isolation + superadmin_bypass policies, DML grant + the serial
-- sequence grant to qr_app (the sequence grant is load-bearing — INSERT fails without it).

ALTER TABLE "quick_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quick_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quick_items" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quick_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "quick_items"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "quick_items" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "quick_items_id_seq" TO qr_app;
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transactions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "transactions"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transactions" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "transactions_id_seq" TO qr_app;
--> statement-breakpoint
ALTER TABLE "transaction_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transaction_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transaction_items" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transaction_items"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "transaction_items"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transaction_items" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "transaction_items_id_seq" TO qr_app;
--> statement-breakpoint
ALTER TABLE "wishlists" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wishlists" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wishlists" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "wishlists"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "wishlists"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "wishlists" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "wishlists_id_seq" TO qr_app;
--> statement-breakpoint
ALTER TABLE "wishlist_matches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wishlist_matches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wishlist_matches" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "wishlist_matches"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "wishlist_matches"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "wishlist_matches" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "wishlist_matches_id_seq" TO qr_app;
```

- [ ] **Step 11: Register 0007 in the journal + create its snapshot**

The runtime migrator (`drizzle-orm/node-postgres/migrator`) applies `<tag>.sql` files in `_journal.json` order, so 0007 must be registered. The `0007_snapshot.json` keeps drizzle-kit's diff baseline consistent for future migrations and is a copy of `0006_snapshot.json` with a fresh `id` and `prevId` pointing at 0006's `id` (exactly as `0005_snapshot.json` duplicates `0004`'s). Run:

```bash
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('drizzle/meta/0006_snapshot.json','utf8'));const out={...c,prevId:c.id,id:require('crypto').randomUUID()};fs.writeFileSync('drizzle/meta/0007_snapshot.json',JSON.stringify(out,null,2)+'\n');"
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));if(!j.entries.some(e=>e.tag==='0007_slice3_rls'))j.entries.push({idx:7,version:'7',when:Date.now(),tag:'0007_slice3_rls',breakpoints:true});fs.writeFileSync('drizzle/meta/_journal.json',JSON.stringify(j,null,2)+'\n');"
```

Verify the journal now ends with both new entries (idx 6 then idx 7) and the snapshot exists:

```bash
test -f drizzle/meta/0007_snapshot.json
node -e "const j=require('./drizzle/meta/_journal.json');console.log(j.entries.slice(-2).map(e=>e.idx+':'+e.tag).join('  '))"
```

Expected: prints `6:0006_slice3_sales_wishlist  7:0007_slice3_rls` and `0007_snapshot.json` exists.

- [ ] **Step 12: Run the integration test to verify it passes**

Run: `pnpm test tests/slice3-migration.integration.test.ts`
Expected: PASS — all 5 cases green:
- RLS + both policies present on all 5 tables;
- the 9 hardened CHECK/UNIQUE constraints all present;
- revoke→INSERT rejects with a permission/sequence error, regrant→INSERT returns a positive id (sequence grant proven load-bearing, non-vacuous);
- tenant B never sees tenant A's `quick_items` row, tenant A does;
- `assertDatabaseSafety()` resolves against the 12-tenant-table migrated DB.

- [ ] **Step 13: Commit**

```bash
git add src/db/schema.ts \
        drizzle/0006_slice3_sales_wishlist.sql drizzle/meta/0006_snapshot.json \
        drizzle/0007_slice3_rls.sql drizzle/meta/0007_snapshot.json \
        drizzle/meta/_journal.json \
        tests/slice3-migration.integration.test.ts
git commit -m "feat(slice3): POS/wishlist schema + 0006 DDL + 0007 hand-authored RLS

Add the payment_method / wishlist_status / wishlist_match_status enums and the
quick_items, transactions, transaction_items, wishlists, wishlist_matches tables
(FKs, indexes, hardened CHECK + UNIQUE constraints). Generate the 0006 DDL and
hand-author 0007_slice3_rls.sql: ENABLE/FORCE RLS, tenant_isolation +
superadmin_bypass policies, the GUC-derived tenant_id default, DML + load-bearing
SEQUENCE grants per table. Integration-proven against PostgreSQL 17 (RLS isolation,
sequence-grant necessity, hardened constraints, assertDatabaseSafety).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2: Sales totals domain (money helper + computeCartTotals)

Pure, DB-free domain layer for all sales arithmetic. Two modules, both with NO `server-only`
import: `src/lib/money.ts` (integer-cent primitives — the ONLY place float→money conversion is
allowed) and `src/lib/sales.ts` (cart line/discount types + `computeCartTotals`). Reference
implementations are LOCKED in CONTRACTS C3 and C4 — copy them VERBATIM. Unit-tested only (no
testcontainers, no DB, no UI). Honors the Slice-0–2 money lesson: money columns are
`numeric(10,2)` strings, exact arithmetic happens in integer cents, never JS float.

**Files:**
- Create: `src/lib/money.ts` (pure money helper — CONTRACTS C3)
- Create: `src/lib/sales.ts` (sales domain types + `computeCartTotals` — CONTRACTS C4)
- Test: `tests/money.test.ts` (unit, vitest)
- Test: `tests/sales.test.ts` (unit, vitest)

**Interfaces:**

Consumes from earlier tasks:
- From **T1** (`src/db/schema.ts`): `export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];`
  — `sales.ts` imports it `type`-only and re-exports it. T1 MUST be merged before T2 builds, or the
  `import type { PaymentMethod } from '@/db/schema'` line fails to resolve. (Runtime behaviour of
  `computeCartTotals` does not use it; it is a type-only re-export for UI/action ergonomics.)

Produces for later tasks (exact signatures — copied from C3/C4):
```ts
// src/lib/money.ts  (C3)
export function toCents(value: string): number;
export function fromCents(cents: number): string;
export function percentToCents(baseCents: number, percent: number): number;
export function clamp(value: number, min: number, max: number): number;
export function sumLineCents(lines: { unitCents: number; quantity: number }[]): number;

// src/lib/sales.ts  (C4)
export type { PaymentMethod };
export type CartLineInput =
  | { kind: 'inventory'; purchaseId: number }
  | { kind: 'quick'; quickItemId: number; quantity: number }
  | { kind: 'adhoc'; label: string; unitPrice: string; quantity: number };
export type ResolvedCartLine = { label: string; unitPrice: string; quantity: number };
export type DiscountInput = { kind: 'amount'; value: string } | { kind: 'percent'; value: number };
export type CartInput = {
  lines: CartLineInput[];
  payment: PaymentMethod;
  discount: DiscountInput | null;
  voucherCode?: string | null;
};
export type CartTotals = { subtotal: string; discount: string; total: string };
export function computeCartTotals(lines: ResolvedCartLine[], discount: DiscountInput | null): CartTotals;
```
Downstream: **T3** `performSale` imports `CartInput` (as `PerformSaleInput`) + `computeCartTotals`;
**T5/T9/T10** import the cart types; `money.ts` is used by T3/T5/T6 service code.

---

#### Step 1 — Write the failing money helper unit test

Create `tests/money.test.ts` with real, non-vacuous assertions (exact cents, half-up rounding,
malformed-input throws, non-integer-cents throw, negative round-trip, clamp bounds, line summation):

```ts
import { describe, it, expect } from 'vitest';
import { toCents, fromCents, percentToCents, clamp, sumLineCents } from '@/lib/money';

describe('toCents', () => {
  it('parses 2-decimal, 1-decimal, and integer money strings', () => {
    expect(toCents('12.34')).toBe(1234);
    expect(toCents('12.3')).toBe(1230);
    expect(toCents('12')).toBe(1200);
    expect(toCents('0')).toBe(0);
    expect(toCents('0.05')).toBe(5);
  });
  it('trims surrounding whitespace', () => {
    expect(toCents('  7.50  ')).toBe(750);
  });
  it('parses negative amounts', () => {
    expect(toCents('-3.20')).toBe(-320);
  });
  it('throws on malformed input (no float guessing)', () => {
    expect(() => toCents('12.345')).toThrow(/not a 2-decimal money string/);
    expect(() => toCents('abc')).toThrow(/not a 2-decimal money string/);
    expect(() => toCents('')).toThrow(/not a 2-decimal money string/);
    expect(() => toCents('1,50')).toThrow(/not a 2-decimal money string/);
  });
});

describe('fromCents', () => {
  it('formats integer cents back to a 2-decimal string', () => {
    expect(fromCents(1234)).toBe('12.34');
    expect(fromCents(1200)).toBe('12.00');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(0)).toBe('0.00');
  });
  it('formats negative cents', () => {
    expect(fromCents(-320)).toBe('-3.20');
  });
  it('throws on non-integer cents', () => {
    expect(() => fromCents(12.5)).toThrow(/cents must be an integer/);
  });
  it('round-trips with toCents', () => {
    for (const s of ['0.00', '0.05', '12.34', '999.99', '-3.20']) {
      expect(fromCents(toCents(s))).toBe(s);
    }
  });
});

describe('percentToCents', () => {
  it('computes percent of a base in cents, rounded half-up to the nearest cent', () => {
    expect(percentToCents(1000, 10)).toBe(100); // 10% of 10.00 = 1.00
    expect(percentToCents(0, 25)).toBe(0);
    expect(percentToCents(1000, 0)).toBe(0);
    expect(percentToCents(1000, 100)).toBe(1000);
  });
  it('rounds half-up at the cent boundary', () => {
    // 3% of 12.34 (1234c) = 37.02c -> 37; 33% of 1234c = 407.22 -> 407
    expect(percentToCents(1234, 3)).toBe(37);
    expect(percentToCents(1234, 33)).toBe(407);
    // 50% of 1 cent = 0.5 -> Math.round half-up -> 1
    expect(percentToCents(1, 50)).toBe(1);
  });
});

describe('clamp', () => {
  it('clamps a value into [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp(0, 0, 0)).toBe(0);
  });
});

describe('sumLineCents', () => {
  it('sums unit cents times quantity over lines (pure integer arithmetic)', () => {
    expect(
      sumLineCents([
        { unitCents: 1000, quantity: 2 },
        { unitCents: 250, quantity: 3 },
      ]),
    ).toBe(2750);
    expect(sumLineCents([])).toBe(0);
  });
});
```

#### Step 2 — Run the money test, expecting FAIL (module does not exist yet)

```bash
pnpm test tests/money.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/money"` (the module is created in Step 3).

#### Step 3 — Implement `src/lib/money.ts` (complete code, verbatim from C3)

Create `src/lib/money.ts`:

```ts
/** Parse a numeric(10,2) decimal string ('12.34', '12', '12.3') to integer cents. Throws on malformed input. */
export function toCents(value: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`toCents: not a 2-decimal money string: "${value}"`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = Number(m[2]);
  const frac = (m[3] ?? '').padEnd(2, '0');
  return sign * (whole * 100 + Number(frac));
}

/** Format integer cents back to a 2-decimal string ('1234' -> '12.34'). */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`fromCents: cents must be an integer, got ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Discount amount in cents for `percent` (0..100) of `baseCents`. Rounded half-up to nearest cent. */
export function percentToCents(baseCents: number, percent: number): number {
  return Math.round((baseCents * percent) / 100);
}

/** Clamp an integer-cent value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sum of (unit cents * quantity) over lines. Pure integer arithmetic. */
export function sumLineCents(lines: { unitCents: number; quantity: number }[]): number {
  return lines.reduce((acc, l) => acc + l.unitCents * l.quantity, 0);
}
```

#### Step 4 — Run the money test, expecting PASS

```bash
pnpm test tests/money.test.ts
```
Expected: PASS (all `describe` blocks green).

#### Step 5 — Commit the money helper

```bash
git add src/lib/money.ts tests/money.test.ts
git commit -m "feat(slice3): integer-cent money helper (toCents/fromCents/percentToCents/clamp/sumLineCents)

Pure, float-free money arithmetic for the sales domain (CONTRACTS C3).
numeric(10,2) strings convert to integer cents and back; percent rounds
half-up. Unit-tested incl. malformed-input + non-integer-cent guards.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

#### Step 6 — Write the failing `computeCartTotals` unit test

Create `tests/sales.test.ts`. Asserts real semantics: subtotal summation across lines/quantities,
percent→cent discount, amount discount, clamp when `discount > subtotal`, negative-amount clamp to 0,
null discount, and the locked empty-cart `0.00` behaviour. Also asserts the type-level cart shape
compiles (a `CartInput` literal is constructed to exercise `CartLineInput`/`DiscountInput`):

```ts
import { describe, it, expect } from 'vitest';
import {
  computeCartTotals,
  type ResolvedCartLine,
  type DiscountInput,
  type CartInput,
} from '@/lib/sales';

const lines = (...ls: ResolvedCartLine[]) => ls;

describe('computeCartTotals — subtotal', () => {
  it('sums unitPrice * quantity across lines, returning 2-decimal strings', () => {
    const r = computeCartTotals(
      lines(
        { label: 'A', unitPrice: '10.00', quantity: 2 },
        { label: 'B', unitPrice: '2.50', quantity: 3 },
      ),
      null,
    );
    expect(r).toEqual({ subtotal: '27.50', discount: '0.00', total: '27.50' });
  });

  it('returns all-zero strings for an empty cart (subtotalCents=0 ⇒ discount clamps to 0)', () => {
    expect(computeCartTotals([], null)).toEqual({
      subtotal: '0.00',
      discount: '0.00',
      total: '0.00',
    });
  });
});

describe('computeCartTotals — discount', () => {
  const base = lines({ label: 'A', unitPrice: '100.00', quantity: 1 });

  it('applies a fixed amount discount', () => {
    const d: DiscountInput = { kind: 'amount', value: '15.00' };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '15.00',
      total: '85.00',
    });
  });

  it('applies a percent discount resolved to cents (half-up)', () => {
    const d: DiscountInput = { kind: 'percent', value: 10 };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '10.00',
      total: '90.00',
    });
  });

  it('rounds a percent discount half-up at the cent boundary', () => {
    // 3% of 12.34 (1234c) = 37.02c -> 37c -> 0.37
    const d: DiscountInput = { kind: 'percent', value: 3 };
    expect(computeCartTotals(lines({ label: 'A', unitPrice: '12.34', quantity: 1 }), d)).toEqual({
      subtotal: '12.34',
      discount: '0.37',
      total: '11.97',
    });
  });

  it('clamps a discount greater than subtotal down to subtotal (total never negative)', () => {
    const d: DiscountInput = { kind: 'amount', value: '500.00' };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '100.00',
      total: '0.00',
    });
  });

  it('clamps a percent discount of 150% to subtotal', () => {
    const d: DiscountInput = { kind: 'percent', value: 100 };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '100.00',
      total: '0.00',
    });
  });

  it('clamps a negative amount discount up to 0', () => {
    const d: DiscountInput = { kind: 'amount', value: '-5.00' };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '0.00',
      total: '100.00',
    });
  });
});

describe('CartInput shape', () => {
  it('accepts inventory / quick / adhoc lines and amount/percent discount', () => {
    const cart: CartInput = {
      lines: [
        { kind: 'inventory', purchaseId: 7 },
        { kind: 'quick', quickItemId: 3, quantity: 2 },
        { kind: 'adhoc', label: 'Kaffee', unitPrice: '2.50', quantity: 1 },
      ],
      payment: 'bar',
      discount: { kind: 'percent', value: 5 },
      voucherCode: null,
    };
    expect(cart.lines).toHaveLength(3);
    expect(cart.payment).toBe('bar');
  });
});
```

#### Step 7 — Run the sales test, expecting FAIL (module does not exist yet)

```bash
pnpm test tests/sales.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/sales"` (the module is created in Step 8).

#### Step 8 — Implement `src/lib/sales.ts` (complete code, verbatim from C4)

Create `src/lib/sales.ts`:

```ts
import type { PaymentMethod } from '@/db/schema';
import { toCents, fromCents, percentToCents, clamp, sumLineCents } from '@/lib/money';

export type { PaymentMethod }; // re-export for UI/action ergonomics

/** Client-submitted cart line (what `createSale` receives). Prices for inventory/quick are NOT trusted. */
export type CartLineInput =
  | { kind: 'inventory'; purchaseId: number }
  | { kind: 'quick'; quickItemId: number; quantity: number }
  | { kind: 'adhoc'; label: string; unitPrice: string; quantity: number };

/** Server-resolved line: unitPrice is authoritative (DB targetPrice / quick catalog / ad-hoc client value). */
export type ResolvedCartLine = {
  label: string;
  unitPrice: string; // numeric(10,2) decimal string
  quantity: number; // >= 1
};

/** Transaction-level discount. Percent is 0..100; amount is a decimal euro string. */
export type DiscountInput =
  | { kind: 'amount'; value: string }
  | { kind: 'percent'; value: number };

/** Full client cart payload (POS screen + single-sell modal both produce this shape).
 *  This is THE one name for the cart concept: `performSale` reuses it as `PerformSaleInput` (C5). */
export type CartInput = {
  lines: CartLineInput[];
  payment: PaymentMethod;
  discount: DiscountInput | null;
  voucherCode?: string | null;
};

/** Computed money outputs, all as 2-decimal strings. total = subtotal - discount. */
export type CartTotals = {
  subtotal: string;
  discount: string; // clamped to [0, subtotal]
  total: string;
};

/**
 * Pure totals computation. discount is clamped: 0 <= discount <= subtotal.
 * Locked semantics:
 *   subtotalCents = Σ toCents(line.unitPrice) * line.quantity
 *   discountCents = amount→toCents(value) | percent→percentToCents(subtotalCents, value) | null→0
 *   discountCents = clamp(discountCents, 0, subtotalCents)
 *   totalCents    = subtotalCents - discountCents
 * Empty input (lines=[]) → { subtotal:'0.00', discount:'0.00', total:'0.00' } (subtotalCents=0 ⇒ discount
 *   clamps to 0). The ACTION layer rejects empty carts via `createSaleSchema.lines.min(1)`, so `performSale`
 *   never receives an empty cart; this line documents the pure function's behaviour for T2 unit tests.
 */
export function computeCartTotals(
  lines: ResolvedCartLine[],
  discount: DiscountInput | null,
): CartTotals {
  const subtotalCents = sumLineCents(
    lines.map((l) => ({ unitCents: toCents(l.unitPrice), quantity: l.quantity })),
  );
  let discountCents = 0;
  if (discount) {
    discountCents = discount.kind === 'amount'
      ? toCents(discount.value)
      : percentToCents(subtotalCents, discount.value);
  }
  discountCents = clamp(discountCents, 0, subtotalCents);
  const totalCents = subtotalCents - discountCents;
  return {
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    total: fromCents(totalCents),
  };
}
```

#### Step 9 — Run the sales test, expecting PASS

```bash
pnpm test tests/sales.test.ts
```
Expected: PASS (all `describe` blocks green). Also confirm both new modules typecheck:

```bash
pnpm typecheck
```
Expected: no errors (requires T1's `PaymentMethod` export to exist in `src/db/schema.ts`).

#### Step 10 — Commit the sales totals domain

```bash
git add src/lib/sales.ts tests/sales.test.ts
git commit -m "feat(slice3): sales cart types + pure computeCartTotals (subtotal/discount/total)

Cart line/discount input types and the locked pure totals function
(CONTRACTS C4). Discount clamps to [0, subtotal] so total is never
negative; percent resolves via the integer-cent money helper. Unit-tested
incl. clamp, percent half-up, and empty-cart 0.00 semantics.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3: performSale service

The single server-side sale primitive. Both the POS cart (T10) and the single-sell modal (T11) reach
it through the `createSale` action (T9). It runs ONE `withTenant` transaction, locks every inventory
copy `FOR UPDATE`, fails closed on any non-sellable / un-priced copy (no double-sell, no €0.00 sale),
recomputes all money server-side (client price is NEVER authority for inventory/quick), writes the
`transactions` + `transaction_items` rows, and flips each sold copy to `verkauft` while stamping its
existing `soldPrice`/`soldDate`/`paymentMethod` snapshot columns.

References: spec §4, §6.1 · BUILD-CONTEXT T3 · CONTRACTS C4, C5 (copy names/types/signatures VERBATIM).

Depends on: **T1** (schema C1/C2 + migrations `0006`/`0007` — the 5 new tables must exist in the test
DB, which `setupTestDatabase()` provisions by running the migrator) and **T2** (`@/lib/sales`
`computeCartTotals` + `ResolvedCartLine` + `CartInput`, and `@/lib/money`). Do not start T3 until T1
and T2 are merged.

---

#### Files

- **Create** `src/lib/performSale.ts` — C5 `performSale` + `PerformSaleInput`/`PerformSaleResult` +
  `SaleConflictError` + `SalePriceMissingError` (`import 'server-only'`).
- **Test** `tests/lib/performSale.integration.test.ts` — Testcontainers: status→`verkauft`,
  transaction + items written, `soldPrice`/`soldDate`/`paymentMethod` stamped, server-recompute of
  totals/discount across kinds, double-sell guard (non-vacuous: no second item row), `reserviert`→
  `verkauft`, null `targetPrice` → `SalePriceMissingError` (fail-closed, status unchanged, no €0.00
  sale), duplicate inventory `purchaseId` → `Error`, gutschein-without-voucher → `Error`, inactive
  quick item → `Error`, `userId: null` → `Error`.

No `Modify`. (`purchases` is unchanged — C2; `performSale` writes its EXISTING
`soldPrice`/`soldDate`/`paymentMethod` columns.)

---

#### Interfaces

**Consumes (from earlier tasks — import VERBATIM, do not re-declare):**

```ts
// from @/db/tenant (Slice 0)
import { withTenant, type TenantCtx } from '@/db/tenant';
//   TenantCtx = { tenantId: number; userId: number | null }
//   withTenant<T>(ctx, fn: (tx: Tx) => Promise<T>): Promise<T>  — opens ONE tx, sets the RLS GUCs.

// from @/db/schema (Task 1 — C1/C2)
import { purchases, records, quickItems, transactions, transactionItems } from '@/db/schema';

// from @/lib/sales (Task 2 — C4)
import type { CartInput } from '@/lib/sales';
import { computeCartTotals, type ResolvedCartLine } from '@/lib/sales';
//   CartLineInput =
//     | { kind: 'inventory'; purchaseId: number }
//     | { kind: 'quick'; quickItemId: number; quantity: number }
//     | { kind: 'adhoc'; label: string; unitPrice: string; quantity: number }
//   CartInput = { lines: CartLineInput[]; payment: PaymentMethod; discount: DiscountInput | null; voucherCode?: string | null }
//   ResolvedCartLine = { label: string; unitPrice: string; quantity: number }
//   computeCartTotals(lines: ResolvedCartLine[], discount: DiscountInput | null): { subtotal: string; discount: string; total: string }
```

**Produces (for later tasks — exact signatures from C5):**

```ts
export type PerformSaleInput = CartInput;              // one name per concept — reuses the C4 cart shape
export type PerformSaleResult = { transactionId: number; total: string };
export class SaleConflictError extends Error { constructor(public readonly purchaseId: number, public readonly status: string | null); }
export class SalePriceMissingError extends Error { constructor(public readonly purchaseId: number); }
export async function performSale(ctx: TenantCtx, input: PerformSaleInput): Promise<PerformSaleResult>;
```

Consumed by **T9** `createSale` (maps `SaleConflictError` **and** `SalePriceMissingError` →
`{ ok:false, reason:'conflict' }`; the duplicate / quick-missing / voucher / userId `Error`s fall
through to `reason:'error'`, normally pre-empted by `createSaleSchema`).

---

#### Steps

**1. Write the failing integration test (complete code).**

Create `tests/lib/performSale.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let performSale: (typeof import('@/lib/performSale'))['performSale'];
let SaleConflictError: (typeof import('@/lib/performSale'))['SaleConflictError'];
let SalePriceMissingError: (typeof import('@/lib/performSale'))['SalePriceMissingError'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let adminId: number;

const ctx = () => ({ tenantId: tenantA, userId: adminId });

let counter = 0;

/** Seed a record + a physical copy for tenantA via withTenant. Returns ids + the record title. */
async function seedCopy(opts: {
  targetPrice: string | null;
  status?: 'verfuegbar' | 'reserviert' | 'verkauft' | 'verliehen';
  title?: string;
}): Promise<{ purchaseId: number; recordId: number; title: string }> {
  const n = ++counter;
  const title = opts.title ?? `Album ${n}`;
  return withTenant(ctx(), async (tx) => {
    const [rec] = await tx
      .insert(schema.records)
      .values({
        tenantId: tenantA,
        title,
        artist: `Artist ${n}`,
        label: ['Label'],
        country: 'US',
        releaseYear: 2000,
        hash: `seed-hash-${n}`,
      })
      .returning({ id: schema.records.id });
    const [pur] = await tx
      .insert(schema.purchases)
      .values({
        tenantId: tenantA,
        recordId: rec!.id,
        purchasePrice: '5.00',
        targetPrice: opts.targetPrice,
        conditionRecord: 5,
        conditionCover: 4,
        status: opts.status ?? 'verfuegbar',
      })
      .returning({ id: schema.purchases.id });
    return { purchaseId: pur!.id, recordId: rec!.id, title };
  });
}

async function seedQuickItem(opts: { name: string; price: string; active?: boolean }): Promise<number> {
  return withTenant(ctx(), async (tx) => {
    const [row] = await tx
      .insert(schema.quickItems)
      .values({ tenantId: tenantA, name: opts.name, price: opts.price, active: opts.active ?? true })
      .returning({ id: schema.quickItems.id });
    return row!.id;
  });
}

const getPurchase = (purchaseId: number) =>
  withTenant(ctx(), (tx) =>
    tx.select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId)),
  ).then((r) => r[0]);

const getTransaction = (transactionId: number) =>
  withTenant(ctx(), (tx) =>
    tx.select().from(schema.transactions).where(eq(schema.transactions.id, transactionId)),
  ).then((r) => r[0]);

const itemsForTransaction = (transactionId: number) =>
  withTenant(ctx(), (tx) =>
    tx
      .select()
      .from(schema.transactionItems)
      .where(eq(schema.transactionItems.transactionId, transactionId)),
  );

/** Stable, test-isolated side-effect probe: how many transaction_items reference this copy. */
const itemsForPurchase = (purchaseId: number) =>
  withTenant(ctx(), (tx) =>
    tx
      .select()
      .from(schema.transactionItems)
      .where(eq(schema.transactionItems.purchaseId, purchaseId)),
  );

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  ({ performSale, SaleConflictError, SalePriceMissingError } = await import('@/lib/performSale'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  const seeded = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantA = seeded.tenantId;
  adminId = seeded.adminUserId;
}, 180_000);

afterAll(async () => {
  if (teardown) await teardown();
});

describe('performSale — happy paths', () => {
  it('sells one inventory copy: flips status, writes head + item, stamps copy snapshot, total from DB price', async () => {
    const copy = await seedCopy({ targetPrice: '22.50' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'bar',
      discount: null,
    });
    expect(res.transactionId).toBeTypeOf('number');
    expect(res.total).toBe('22.50');

    const head = await getTransaction(res.transactionId);
    expect(head.paymentMethod).toBe('bar');
    expect(head.subtotal).toBe('22.50');
    expect(head.discount).toBe('0.00');
    expect(head.total).toBe('22.50');
    expect(head.voucherCode).toBeNull();
    expect(head.soldByUserId).toBe(adminId);

    const items = await itemsForTransaction(res.transactionId);
    expect(items).toHaveLength(1);
    expect(items[0].purchaseId).toBe(copy.purchaseId);
    expect(items[0].quickItemId).toBeNull();
    expect(items[0].label).toBe(copy.title); // server snapshot of the RECORD title, not a client value
    expect(items[0].unitPrice).toBe('22.50');
    expect(items[0].quantity).toBe(1);

    const pur = await getPurchase(copy.purchaseId);
    expect(pur.status).toBe('verkauft');
    expect(pur.soldPrice).toBe('22.50');
    expect(pur.soldDate).toBeInstanceOf(Date);
    expect(pur.paymentMethod).toBe('bar');
  });

  it('sells a reserviert copy (reserviert → verkauft)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00', status: 'reserviert' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'karte',
      discount: null,
    });
    expect(res.total).toBe('10.00');
    expect((await getPurchase(copy.purchaseId)).status).toBe('verkauft');
  });

  it('resolves quick-item price from the catalog (client sends only quantity)', async () => {
    const quickId = await seedQuickItem({ name: 'Kaffee', price: '2.50' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'quick', quickItemId: quickId, quantity: 2 }],
      payment: 'bar',
      discount: null,
    });
    expect(res.total).toBe('5.00');
    const items = await itemsForTransaction(res.transactionId);
    expect(items).toHaveLength(1);
    expect(items[0].quickItemId).toBe(quickId);
    expect(items[0].purchaseId).toBeNull();
    expect(items[0].label).toBe('Kaffee');
    expect(items[0].unitPrice).toBe('2.50'); // catalog price, NOT client-supplied
    expect(items[0].quantity).toBe(2);
  });

  it('records an ad-hoc line with the client price (ad-hoc only)', async () => {
    const res = await performSale(ctx(), {
      lines: [{ kind: 'adhoc', label: 'Poster', unitPrice: '3.50', quantity: 2 }],
      payment: 'bar',
      discount: null,
    });
    expect(res.total).toBe('7.00');
    const items = await itemsForTransaction(res.transactionId);
    expect(items[0].purchaseId).toBeNull();
    expect(items[0].quickItemId).toBeNull();
    expect(items[0].label).toBe('Poster');
    expect(items[0].unitPrice).toBe('3.50');
    expect(items[0].quantity).toBe(2);
  });

  it('server-recomputes a mixed cart total with an amount discount from DB/catalog prices', async () => {
    const copy = await seedCopy({ targetPrice: '20.00' });
    const quickId = await seedQuickItem({ name: 'Sticker', price: '2.50' });
    const res = await performSale(ctx(), {
      lines: [
        { kind: 'inventory', purchaseId: copy.purchaseId },
        { kind: 'quick', quickItemId: quickId, quantity: 2 }, // 5.00
        { kind: 'adhoc', label: 'Tüte', unitPrice: '3.50', quantity: 1 }, // 3.50
      ],
      payment: 'bar',
      discount: { kind: 'amount', value: '0.50' },
    });
    const head = await getTransaction(res.transactionId);
    expect(head.subtotal).toBe('28.50'); // 20.00 + 5.00 + 3.50 — inventory/quick from server, not client
    expect(head.discount).toBe('0.50');
    expect(head.total).toBe('28.00');
    expect(res.total).toBe('28.00');
    expect(await itemsForTransaction(res.transactionId)).toHaveLength(3);
  });

  it('server-recomputes a percent discount (10% of 20.00 = 2.00)', async () => {
    const copy = await seedCopy({ targetPrice: '20.00' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'bar',
      discount: { kind: 'percent', value: 10 },
    });
    const head = await getTransaction(res.transactionId);
    expect(head.subtotal).toBe('20.00');
    expect(head.discount).toBe('2.00');
    expect(head.total).toBe('18.00');
  });

  it('stores the voucher code for a gutschein payment', async () => {
    const copy = await seedCopy({ targetPrice: '12.00' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'gutschein',
      discount: null,
      voucherCode: 'XMAS10',
    });
    const head = await getTransaction(res.transactionId);
    expect(head.paymentMethod).toBe('gutschein');
    expect(head.voucherCode).toBe('XMAS10');
    expect((await getPurchase(copy.purchaseId)).paymentMethod).toBe('gutschein');
  });
});

describe('performSale — fail-closed guards', () => {
  it('rejects a double-sell and writes NO second item row (FOR UPDATE + status guard)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00' });
    await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'bar',
      discount: null,
    });
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(1);

    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toBeInstanceOf(SaleConflictError);

    // Non-vacuous: the second (failed) sale produced no new transaction_item for this copy.
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(1);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verkauft');
  });

  it('rejects selling a verliehen copy (status ∉ {verfuegbar,reserviert})', async () => {
    const copy = await seedCopy({ targetPrice: '10.00', status: 'verliehen' });
    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toBeInstanceOf(SaleConflictError);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verliehen');
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(0);
  });

  it('rejects a null-targetPrice inventory copy (no €0.00 sale; tx rolls back, status unchanged)', async () => {
    const copy = await seedCopy({ targetPrice: null });
    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toBeInstanceOf(SalePriceMissingError);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verfuegbar'); // rolled back
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(0);
  });

  it('rejects a duplicate inventory purchaseId in one cart (no side effects)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00' });
    await expect(
      performSale(ctx(), {
        lines: [
          { kind: 'inventory', purchaseId: copy.purchaseId },
          { kind: 'inventory', purchaseId: copy.purchaseId },
        ],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toThrow(/duplicate inventory purchaseId in cart/);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verfuegbar');
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(0);
  });

  it('rejects gutschein with no voucher code (no side effects)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00' });
    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
        payment: 'gutschein',
        discount: null,
      }),
    ).rejects.toThrow(/voucherCode required for gutschein/);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verfuegbar');
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(0);
  });

  it('rejects an inactive/missing quick item', async () => {
    const quickId = await seedQuickItem({ name: 'Alt', price: '1.00', active: false });
    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'quick', quickItemId: quickId, quantity: 1 }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toThrow(/missing or inactive/);
  });

  it('rejects when ctx.userId is null (soldByUserId is NOT NULL)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00' });
    await expect(
      performSale(
        { tenantId: tenantA, userId: null },
        {
          lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
          payment: 'bar',
          discount: null,
        },
      ),
    ).rejects.toThrow(/userId is required/);
  });
});
```

**2. Run the test, expecting FAIL.**

```
pnpm vitest run tests/lib/performSale.integration.test.ts
```

Expected failure: the suite errors at import time —
`Failed to resolve import "@/lib/performSale"` (the module does not exist yet). RED confirmed.

**3. Create `src/lib/performSale.ts` (complete code, C5 verbatim semantics).**

```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import {
  purchases,
  records,
  quickItems,
  transactions,
  transactionItems,
} from '@/db/schema';
import type { CartInput } from '@/lib/sales';
import { computeCartTotals, type ResolvedCartLine } from '@/lib/sales';

/** performSale receives the SAME shape as the client cart (C4) — one name per concept, cannot diverge. */
export type PerformSaleInput = CartInput;

export type PerformSaleResult = { transactionId: number; total: string };

/** Thrown when an inventory copy cannot be sold (missing or status ∉ {verfuegbar,reserviert}). Aborts the tx. */
export class SaleConflictError extends Error {
  constructor(
    public readonly purchaseId: number,
    public readonly status: string | null,
  ) {
    super(`purchase ${purchaseId} not sellable (status=${status ?? 'missing'})`);
    this.name = 'SaleConflictError';
  }
}

/** Thrown when an inventory copy has no resolvable price (targetPrice null/empty). Aborts the tx —
 *  NEVER record a €0.00 inventory sale (fail-closed; §0a delta 3). */
export class SalePriceMissingError extends Error {
  constructor(public readonly purchaseId: number) {
    super(`purchase ${purchaseId} has no target price (cannot resolve inventory unit price)`);
    this.name = 'SalePriceMissingError';
  }
}

type ResolvedLine = ResolvedCartLine & {
  purchaseId: number | null;
  quickItemId: number | null;
};

export async function performSale(
  ctx: TenantCtx,
  input: PerformSaleInput,
): Promise<PerformSaleResult> {
  // 1. soldByUserId is NOT NULL — require a real user.
  if (ctx.userId === null) {
    throw new Error('performSale: ctx.userId is required (soldByUserId is NOT NULL)');
  }
  const soldByUserId = ctx.userId;

  // 2. Inventory uniqueness guard (defence-in-depth) BEFORE opening the tx. The cart UI key
  //    `inv-<purchaseId>` must not be trusted; the action's createSaleSchema also refines this.
  const inventoryIds = input.lines.flatMap((l) =>
    l.kind === 'inventory' ? [l.purchaseId] : [],
  );
  if (new Set(inventoryIds).size !== inventoryIds.length) {
    throw new Error('duplicate inventory purchaseId in cart');
  }

  // 7. Voucher resolution + fail-closed gate (satisfies transactions_voucher_iff_gutschein).
  const voucherCode =
    input.payment === 'gutschein' ? (input.voucherCode?.trim() || null) : null;
  if (input.payment === 'gutschein' && voucherCode === null) {
    throw new Error('voucherCode required for gutschein');
  }

  // 3. ONE withTenant transaction (no nested withTenant).
  return withTenant(ctx, async (tx) => {
    // 4. Lock the DISTINCT inventory copies ascending (deadlock-free ordering); fail-closed on
    //    missing row or status ∉ {verfuegbar,reserviert} — the whole tx rolls back (no double-sell).
    const distinctIds = [...new Set(inventoryIds)].sort((a, b) => a - b);
    const lockedById = new Map<number, { status: string; targetPrice: string | null; recordId: number }>();
    for (const purchaseId of distinctIds) {
      const [row] = await tx
        .select({
          status: purchases.status,
          targetPrice: purchases.targetPrice,
          recordId: purchases.recordId,
        })
        .from(purchases)
        .where(eq(purchases.id, purchaseId))
        .for('update');
      if (!row || (row.status !== 'verfuegbar' && row.status !== 'reserviert')) {
        throw new SaleConflictError(purchaseId, row?.status ?? null);
      }
      lockedById.set(purchaseId, row);
    }

    // 5. Resolve unitPrice server-side. Client price is authority ONLY for ad-hoc lines.
    const resolved: ResolvedLine[] = [];
    for (const line of input.lines) {
      if (line.kind === 'inventory') {
        const locked = lockedById.get(line.purchaseId)!;
        if (locked.targetPrice === null || locked.targetPrice.trim() === '') {
          throw new SalePriceMissingError(line.purchaseId); // fail-closed: no '?? 0.00' default
        }
        const [rec] = await tx
          .select({ title: records.title })
          .from(records)
          .where(eq(records.id, locked.recordId));
        resolved.push({
          label: rec!.title,
          unitPrice: locked.targetPrice,
          quantity: 1,
          purchaseId: line.purchaseId,
          quickItemId: null,
        });
      } else if (line.kind === 'quick') {
        const [item] = await tx
          .select({ name: quickItems.name, price: quickItems.price, active: quickItems.active })
          .from(quickItems)
          .where(eq(quickItems.id, line.quickItemId));
        if (!item || !item.active) {
          throw new Error(`quick item ${line.quickItemId} missing or inactive`);
        }
        resolved.push({
          label: item.name,
          unitPrice: item.price,
          quantity: line.quantity,
          purchaseId: null,
          quickItemId: line.quickItemId,
        });
      } else {
        resolved.push({
          label: line.label,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          purchaseId: null,
          quickItemId: null,
        });
      }
    }

    // 6. Server-side totals (C4): subtotal − clamped discount = total.
    const totals = computeCartTotals(
      resolved.map((r) => ({ label: r.label, unitPrice: r.unitPrice, quantity: r.quantity })),
      input.discount,
    );

    // 8. Insert the transaction head.
    const [head] = await tx
      .insert(transactions)
      .values({
        tenantId: ctx.tenantId,
        soldByUserId,
        paymentMethod: input.payment,
        subtotal: totals.subtotal,
        discount: totals.discount,
        total: totals.total,
        voucherCode,
      })
      .returning({ id: transactions.id });
    const transactionId = head!.id;

    // 9. Insert all positions.
    await tx.insert(transactionItems).values(
      resolved.map((r) => ({
        tenantId: ctx.tenantId,
        transactionId,
        purchaseId: r.purchaseId,
        quickItemId: r.quickItemId,
        label: r.label,
        unitPrice: r.unitPrice,
        quantity: r.quantity,
      })),
    );

    // 10. Flip each sold copy → verkauft (ascending order, already locked) + stamp snapshot columns.
    for (const purchaseId of distinctIds) {
      const line = resolved.find((r) => r.purchaseId === purchaseId)!;
      await tx
        .update(purchases)
        .set({
          status: 'verkauft',
          soldPrice: line.unitPrice,
          soldDate: new Date(),
          paymentMethod: input.payment, // stored as string in the existing text column (no type migration)
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, purchaseId));
    }

    // 11. Return.
    return { transactionId, total: totals.total };
  });
}
```

**4. Run the test, expecting PASS.**

```
pnpm vitest run tests/lib/performSale.integration.test.ts
```

Expected: all `performSale — happy paths` and `performSale — fail-closed guards` tests green
(15 assertions across the happy/guard blocks). If the container pull is cold, the 180 s `beforeAll`
budget covers it.

**5. Run the typechecker, expecting PASS (no contract/TS drift).**

```
pnpm typecheck
```

Expected: clean exit (`tsc --noEmit`). Confirms `performSale`'s exported signature matches C5 and the
consumed `@/lib/sales` / `@/db/tenant` types line up.

**6. Commit.**

```
git add src/lib/performSale.ts tests/lib/performSale.integration.test.ts
git commit -m "feat(slice3): performSale service — one-tx sale with FOR UPDATE double-sell guard

Locks each inventory copy FOR UPDATE in ascending id order (deadlock-free),
fails closed on non-sellable / null-price copies (no double-sale, no €0.00
sale), recomputes subtotal/discount/total server-side from DB+catalog prices
(client price authoritative for ad-hoc only), writes transactions +
transaction_items, and stamps soldPrice/soldDate/paymentMethod on each sold
copy while flipping it to verkauft. CONTRACTS C4/C5; spec §4/§6.1.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

#### Notes for the implementer (do not skip)

- **One transaction, no nesting.** Everything from the `FOR UPDATE` locks through the final
  `purchases` update happens inside the single `withTenant` callback. A thrown
  `SaleConflictError`/`SalePriceMissingError`/`Error` aborts and rolls the whole tx back — that is what
  makes the "status unchanged / no item row" guard assertions pass.
- **Lock ordering is load-bearing.** Sort the DISTINCT inventory `purchaseId`s ascending before locking
  AND before the final status flips. This prevents lock-order deadlocks between concurrent multi-line
  checkouts that share a copy (Ipcha hardening, C5 step 4).
- **No client price for inventory/quick.** `CartLineInput` carries no price for `inventory` (none) and
  only `quantity` for `quick`; the server reads `purchases.targetPrice` / `quick_items.price`. Do not
  add a client price path without amending C5 — the mixed-cart and quick tests assert the recorded
  `unitPrice` equals the DB/catalog value.
- **No post-commit enqueue here.** `performSale` does NOT enqueue anything (the wishlist-match enqueue
  lives in the `ankaufRecord` action — T7/C9.5, not the sale path). Keep this service free of job sends.
- **`purchases.paymentMethod` stays `text`** — store the enum value as a string; never alter the column
  type (C2).
- **DB checks are belt-and-braces.** `transactions_total_consistent`, `transactions_discount_le_subtotal`,
  and `transactions_voucher_iff_gutschein` (T1/C2) will reject malformed inserts at the DB even if the
  domain math regresses; `computeCartTotals` + the voucher gate keep the inserts within those checks.

### Task 4: Reservation service

Wire the two `record_status` reservation transitions on `purchases` behind a fail-closed
`SELECT … FOR UPDATE` guard, exactly as locked in CONTRACTS C6 (spec §4, §6.2; CTX T4). This is the
defence-in-depth backstop that prevents reserving/cancelling a copy that has concurrently changed
status (lesson 6: FOR UPDATE + status guard). Only the existing Slice-1 `purchases` table is touched —
no new tables, no enqueue, no mock-baseline, no tokens.

**Files:**
- Create: `src/lib/reservation.ts` (service, `import 'server-only'`)
- Test: `tests/reservation.integration.test.ts` (Testcontainers integration)
- (no Modify — `purchases`/`recordStatusEnum` already exist from Slice 1)

**Interfaces:**

Consumes from earlier tasks (copy verbatim, do NOT redefine):
- `@/db/tenant` (existing): `withTenant<T>(ctx, fn)`, `type TenantCtx = { tenantId: number; userId: number | null }`.
- `@/db/schema` (existing): `purchases` table with `status: recordStatusEnum` whose values are
  `['verfuegbar','reserviert','verkauft','verliehen']` (NOTE the spelling `verfuegbar`), and `updatedAt`
  `timestamp(..., { withTimezone: true })`.
- T1 (Schema/migrations) only provides slice ordering; this task needs no new T1 table.

Produces for later tasks (CONTRACTS C6 — copy verbatim into T9 actions):
```ts
// src/lib/reservation.ts
export class ReservationConflictError extends Error {
  constructor(public readonly purchaseId: number, public readonly status: string | null) { /* … */ }
}
/** verfuegbar → reserviert. ONE withTenant tx, SELECT … FOR UPDATE, fail-closed if status !== 'verfuegbar'. */
export async function reserveCopy(ctx: TenantCtx, purchaseId: number): Promise<void>;
/** reserviert → verfuegbar. ONE withTenant tx, SELECT … FOR UPDATE, fail-closed if status !== 'reserviert'. */
export async function cancelReservation(ctx: TenantCtx, purchaseId: number): Promise<void>;
```
T9 (`src/app/(app)/kasse/actions.ts`) imports these as
`import { cancelReservation as cancelReservationSvc, reserveCopy } from '@/lib/reservation';` and maps
`ReservationConflictError` → `{ ok:false, reason:'conflict' }` (C11). Do NOT change these names/signatures
here without amending CONTRACTS C6 first.

---

1. **Write the failing integration test.** Create `tests/reservation.integration.test.ts` with this exact
   content (asserts the real status flips, the fail-closed conflict with the correct `purchaseId`/`status`,
   the missing-row case, cross-checks that a rejected transition leaves status unchanged, and that
   `updatedAt` is written — non-vacuous: the status transition is the load-bearing side effect):

   ```ts
   import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
   import { eq } from 'drizzle-orm';
   import { setupTestDatabase, seedTenant } from './helpers/db';

   let reserveCopy: (typeof import('@/lib/reservation'))['reserveCopy'];
   let cancelReservation: (typeof import('@/lib/reservation'))['cancelReservation'];
   let ReservationConflictError: (typeof import('@/lib/reservation'))['ReservationConflictError'];
   let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
   let withTenant: (typeof import('@/db/tenant'))['withTenant'];
   let schema: typeof import('@/db/schema');
   let teardown: (() => Promise<void>) | undefined;
   let tenantA: number;

   const release = {
     discogsId: 7,
     title: 'Spiegel im Spiegel',
     artist: 'Arvo Pärt',
     country: 'DE',
     year: 1978,
     format: 'Vinyl',
     genre: ['Classical'],
     label: ['ECM'],
     coverImage: null,
   };

   beforeAll(async () => {
     const db = await setupTestDatabase();
     teardown = db.teardown;
     process.env.DATABASE_URL = db.appUrl;
     process.env.DATABASE_OWNER_URL = db.ownerUrl;
     vi.resetModules();
     ({ reserveCopy, cancelReservation, ReservationConflictError } = await import('@/lib/reservation'));
     ({ performAnkauf } = await import('@/lib/ankauf'));
     ({ withTenant } = await import('@/db/tenant'));
     schema = await import('@/db/schema');
     tenantA = (await seedTenant({ slug: 'demo', name: 'Demo' })).tenantId;
   });
   afterAll(async () => {
     if (teardown) await teardown();
   });

   const ctx = () => ({ tenantId: tenantA, userId: null });

   /** Insert a fresh `verfuegbar` copy and return its purchaseId. */
   async function freshCopy(): Promise<number> {
     const { purchaseId } = await performAnkauf(ctx(), {
       release,
       purchasePrice: '3.00',
       targetPrice: '22.50',
       conditionRecord: 5,
       conditionCover: 4,
       listOnDiscogs: false,
     });
     return purchaseId;
   }

   async function readCopy(id: number) {
     return withTenant(ctx(), async (tx) => {
       const [row] = await tx.select().from(schema.purchases).where(eq(schema.purchases.id, id));
       return row;
     });
   }

   describe('reserveCopy / cancelReservation', () => {
     it('verfuegbar → reserviert, then reserviert → verfuegbar', async () => {
       const id = await freshCopy();

       await reserveCopy(ctx(), id);
       const reserved = await readCopy(id);
       expect(reserved?.status).toBe('reserviert');
       expect(reserved?.updatedAt).toBeInstanceOf(Date); // SET updatedAt = now() was written

       await cancelReservation(ctx(), id);
       const cancelled = await readCopy(id);
       expect(cancelled?.status).toBe('verfuegbar');
     });

     it('reserveCopy on a non-verfuegbar copy fails closed and leaves status unchanged', async () => {
       const id = await freshCopy();
       await reserveCopy(ctx(), id); // now reserviert

       const err = await reserveCopy(ctx(), id).catch((e) => e);
       expect(err).toBeInstanceOf(ReservationConflictError);
       expect(err.purchaseId).toBe(id);
       expect(err.status).toBe('reserviert');

       const after = await readCopy(id);
       expect(after?.status).toBe('reserviert'); // no spurious transition
     });

     it('cancelReservation on a verfuegbar copy fails closed', async () => {
       const id = await freshCopy(); // verfuegbar

       const err = await cancelReservation(ctx(), id).catch((e) => e);
       expect(err).toBeInstanceOf(ReservationConflictError);
       expect(err.purchaseId).toBe(id);
       expect(err.status).toBe('verfuegbar');

       const after = await readCopy(id);
       expect(after?.status).toBe('verfuegbar');
     });

     it('reserveCopy on a missing/invisible row throws ReservationConflictError(status=null)', async () => {
       const err = await reserveCopy(ctx(), 999_999).catch((e) => e);
       expect(err).toBeInstanceOf(ReservationConflictError);
       expect(err.purchaseId).toBe(999_999);
       expect(err.status).toBeNull();
     });
   });
   ```

2. **Run the test, expect FAIL** (red — `src/lib/reservation.ts` does not yet exist, so the dynamic
   `import('@/lib/reservation')` in `beforeAll` rejects):
   ```bash
   pnpm vitest run tests/reservation.integration.test.ts
   ```
   Expected: the suite errors out / all four cases fail because the module cannot be resolved. Confirm the
   failure is the missing module (or undefined `reserveCopy`), NOT an unrelated harness/env error.

3. **Write the minimal implementation.** Create `src/lib/reservation.ts` with this exact, complete content
   (ONE `withTenant` tx each; `SELECT … FOR UPDATE` via drizzle `.for('update')`; fail-closed on missing
   row or wrong source status; both `UPDATE … SET updatedAt = now()`):

   ```ts
   import 'server-only';
   import { eq } from 'drizzle-orm';
   import { withTenant, type TenantCtx } from '@/db/tenant';
   import { purchases } from '@/db/schema';

   /** Thrown when a copy is not in the required source status for the requested transition. Aborts the tx. */
   export class ReservationConflictError extends Error {
     constructor(
       public readonly purchaseId: number,
       public readonly status: string | null,
     ) {
       super(`purchase ${purchaseId} not in required status (status=${status ?? 'missing'})`);
       this.name = 'ReservationConflictError';
     }
   }

   /** verfuegbar → reserviert. ONE withTenant tx, SELECT … FOR UPDATE, fail-closed if status !== 'verfuegbar'. */
   export async function reserveCopy(ctx: TenantCtx, purchaseId: number): Promise<void> {
     await withTenant(ctx, async (tx) => {
       const [row] = await tx
         .select({ status: purchases.status })
         .from(purchases)
         .where(eq(purchases.id, purchaseId))
         .for('update');
       if (!row || row.status !== 'verfuegbar') {
         throw new ReservationConflictError(purchaseId, row?.status ?? null);
       }
       await tx
         .update(purchases)
         .set({ status: 'reserviert', updatedAt: new Date() })
         .where(eq(purchases.id, purchaseId));
     });
   }

   /** reserviert → verfuegbar. ONE withTenant tx, SELECT … FOR UPDATE, fail-closed if status !== 'reserviert'. */
   export async function cancelReservation(ctx: TenantCtx, purchaseId: number): Promise<void> {
     await withTenant(ctx, async (tx) => {
       const [row] = await tx
         .select({ status: purchases.status })
         .from(purchases)
         .where(eq(purchases.id, purchaseId))
         .for('update');
       if (!row || row.status !== 'reserviert') {
         throw new ReservationConflictError(purchaseId, row?.status ?? null);
       }
       await tx
         .update(purchases)
         .set({ status: 'verfuegbar', updatedAt: new Date() })
         .where(eq(purchases.id, purchaseId));
     });
   }
   ```

   Note: under RLS a row from another tenant (or a non-existent id) is invisible to the `SELECT`, so `row`
   is `undefined` and the call fails closed with `ReservationConflictError(purchaseId, null)` — cross-tenant
   reservation cannot succeed.

4. **Run the test, expect PASS** (green — all four cases):
   ```bash
   pnpm vitest run tests/reservation.integration.test.ts
   ```
   Expected: `4 passed`. If `.for('update')` is rejected by the drizzle types/runtime, do NOT drop the row
   lock — verify the call is chained on a `select(...).from(...).where(...)` builder; the lock is
   load-bearing per CONTRACTS C6 and lesson 6.

5. **Commit.**
   ```bash
   git add src/lib/reservation.ts tests/reservation.integration.test.ts
   git commit -m "$(cat <<'EOF'
   feat(slice3): reservation service (reserveCopy/cancelReservation)

   verfuegbar↔reserviert status transitions on purchases behind a
   SELECT … FOR UPDATE row lock; fail-closed via ReservationConflictError
   on missing row or wrong source status (no spurious transition,
   cross-tenant invisible). Integration-tested (CONTRACTS C6, spec §4/§6.2).

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

### Task 5: quick_items catalog lib

**Refs:** spec §3.2, §5.1 · BUILD-CONTEXT T5 · CONTRACTS C7 (and C2 `quickItems` table, C13 RLS).

Implement the tenant-scoped `quick_items` catalog service: list active items, create, update (partial),
and soft-deactivate. Pure data layer (`src/lib/quickItems.ts`, `server-only`) — NO zod/validation/CSRF here
(that lives in the T9 actions that wrap these as `…Svc`). Integration-tested against a real Postgres
(Testcontainers) to prove CRUD behaviour AND RLS tenant isolation.

This task DEPENDS on Task 1 (the `quick_items` table + `0007_slice3_rls.sql` RLS, including the load-bearing
`GRANT USAGE, SELECT ON SEQUENCE quick_items_id_seq` — without it the INSERT in step 1's test fails). Do not
start until Task 1 is merged.

---

#### Files

- **Create** `src/lib/quickItems.ts` — C7 service (`listActiveQuickItems`, `createQuickItem`,
  `updateQuickItem`, `deactivateQuickItem`, `QuickItemRow`).
- **Test** `tests/lib/quickItems.integration.test.ts` — Testcontainers CRUD + tenant isolation
  (new `tests/lib/` directory; import the shared harness from `../helpers/db`).

No other files change. (T9 will later import these with the `…Svc` alias; T10 will call
`listActiveQuickItems`. Do not add the actions or UI here.)

---

#### Interfaces

**Consumes from earlier tasks (copy verbatim — do NOT redefine):**

```ts
// from @/db/tenant (existing)
export type TenantCtx = { tenantId: number; userId: number | null };
export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>;

// from @/db/schema (Task 1, contract C2) — reference only, already defined there:
//   export const quickItems = pgTable('quick_items', {
//     id, tenantId, name: text, price: numeric(10,2), active: boolean default true, createdAt
//   }, ... quick_items_tenant_active_idx, quick_items_price_nonneg check)

// from tests/helpers/db (existing harness)
export async function setupTestDatabase(): Promise<TestDatabase>;
export async function seedTenant(input: { slug: string; name: string }):
  Promise<{ tenantId: number; adminUserId: number }>;
```

**Produces for later tasks (CONTRACTS C7 — these signatures are LOCKED, copy verbatim):**

```ts
// src/lib/quickItems.ts  (import 'server-only')
export type QuickItemRow = { id: number; name: string; price: string; active: boolean };

/** active quick_items for the tenant, ordered by name asc. */
export async function listActiveQuickItems(ctx: TenantCtx): Promise<QuickItemRow[]>;

export async function createQuickItem(
  ctx: TenantCtx,
  input: { name: string; price: string },
): Promise<{ id: number }>;

export async function updateQuickItem(
  ctx: TenantCtx,
  id: number,
  input: { name?: string; price?: string; active?: boolean },
): Promise<void>;

/** Soft-delete: sets active=false (never hard-deletes — transaction_items reference quick_items). */
export async function deactivateQuickItem(ctx: TenantCtx, id: number): Promise<void>;
```

Notes (from CONTRACTS global conventions):
- `price` is `numeric(10,2)` → drizzle returns/accepts it as a **string** (e.g. `'2.50'`). Pass strings
  straight through; do not do float math here.
- `tenantId` is written **explicitly** on insert (`tenantId: ctx.tenantId`) even though RLS sets a GUC
  default — defence-in-depth, matching `performAnkauf`.
- `update`/`deactivate` filter only by `id`; RLS (`tenant_isolation` USING + WITH CHECK on `quick_items`)
  confines the statement to the caller's tenant, so a cross-tenant `id` is invisible (a silent no-op). The
  integration test below proves this rather than asserting it on faith.

---

#### Steps

**1. Write the failing integration test.**

Create `tests/lib/quickItems.integration.test.ts` with the complete content below. It boots one Postgres
container, seeds two tenants, and asserts real behaviour (returned-id round-trips through a fresh list read;
ordering via two ASCII sentinels so it is collation-robust; soft-delete proven by re-activation; tenant
isolation proven by a cross-tenant UPDATE that must NOT mutate the other tenant's row).

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let lib: typeof import('@/lib/quickItems');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  lib = await import('@/lib/quickItems');
  tenantA = (await seedTenant({ slug: 'qi-a', name: 'QI A' })).tenantId;
  tenantB = (await seedTenant({ slug: 'qi-b', name: 'QI B' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});

const ctxA = () => ({ tenantId: tenantA, userId: null });
const ctxB = () => ({ tenantId: tenantB, userId: null });

describe('quick_items catalog (C7)', () => {
  it('createQuickItem inserts and listActiveQuickItems round-trips the row', async () => {
    const { id } = await lib.createQuickItem(ctxA(), { name: 'Kaffee', price: '2.50' });
    expect(id).toBeTypeOf('number');
    const rows = await lib.listActiveQuickItems(ctxA());
    expect(rows.find((r) => r.id === id)).toEqual({
      id,
      name: 'Kaffee',
      price: '2.50',
      active: true,
    });
  });

  it('listActiveQuickItems orders by name ascending', async () => {
    await lib.createQuickItem(ctxA(), { name: 'Zzz-Sticker', price: '1.00' });
    await lib.createQuickItem(ctxA(), { name: 'Aaa-Beutel', price: '1.00' });
    const names = (await lib.listActiveQuickItems(ctxA())).map((r) => r.name);
    expect(names.indexOf('Aaa-Beutel')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Zzz-Sticker')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Aaa-Beutel')).toBeLessThan(names.indexOf('Zzz-Sticker'));
  });

  it('updateQuickItem applies a partial patch (name + price)', async () => {
    const { id } = await lib.createQuickItem(ctxA(), { name: 'Tee', price: '2.00' });
    await lib.updateQuickItem(ctxA(), id, { name: 'Bio-Tee', price: '2.80' });
    const rows = await lib.listActiveQuickItems(ctxA());
    expect(rows.find((r) => r.id === id)).toEqual({
      id,
      name: 'Bio-Tee',
      price: '2.80',
      active: true,
    });
  });

  it('deactivateQuickItem soft-deletes: hidden from list but row survives and can be re-activated', async () => {
    const { id } = await lib.createQuickItem(ctxA(), { name: 'Pin', price: '3.00' });
    await lib.deactivateQuickItem(ctxA(), id);
    const afterDeactivate = await lib.listActiveQuickItems(ctxA());
    expect(afterDeactivate.find((r) => r.id === id)).toBeUndefined();
    // Soft-delete (not hard-delete): re-activating proves the row still exists.
    await lib.updateQuickItem(ctxA(), id, { active: true });
    const afterReactivate = await lib.listActiveQuickItems(ctxA());
    expect(afterReactivate.find((r) => r.id === id)?.active).toBe(true);
  });

  it('RLS isolation: tenant B cannot see or mutate tenant A quick items', async () => {
    const { id } = await lib.createQuickItem(ctxA(), { name: 'GeheimA', price: '9.00' });
    // B cannot read A's row.
    const bRows = await lib.listActiveQuickItems(ctxB());
    expect(bRows.find((r) => r.id === id)).toBeUndefined();
    expect(bRows.find((r) => r.name === 'GeheimA')).toBeUndefined();
    // B's UPDATE/deactivate by A's id is a no-op under RLS — A's row is unchanged.
    await lib.updateQuickItem(ctxB(), id, { name: 'Hijacked', price: '0.01' });
    await lib.deactivateQuickItem(ctxB(), id);
    const aRows = await lib.listActiveQuickItems(ctxA());
    expect(aRows.find((r) => r.id === id)).toEqual({
      id,
      name: 'GeheimA',
      price: '9.00',
      active: true,
    });
  });
});
```

**2. Run the test and confirm it FAILS (no implementation yet).**

```bash
pnpm test tests/lib/quickItems.integration.test.ts
```

Expected: failure — the import `@/lib/quickItems` cannot be resolved (module does not exist), so the suite
errors before any assertion. This is the red state.

**3. Write the minimal implementation.**

Create `src/lib/quickItems.ts` with the complete content below (C7 verbatim signatures).

```ts
import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { quickItems } from '@/db/schema';

export type QuickItemRow = { id: number; name: string; price: string; active: boolean };

/** active quick_items for the tenant, ordered by name asc. */
export async function listActiveQuickItems(ctx: TenantCtx): Promise<QuickItemRow[]> {
  return withTenant(ctx, async (tx) =>
    tx
      .select({
        id: quickItems.id,
        name: quickItems.name,
        price: quickItems.price,
        active: quickItems.active,
      })
      .from(quickItems)
      .where(eq(quickItems.active, true))
      .orderBy(asc(quickItems.name)),
  );
}

export async function createQuickItem(
  ctx: TenantCtx,
  input: { name: string; price: string },
): Promise<{ id: number }> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(quickItems)
      .values({ tenantId: ctx.tenantId, name: input.name, price: input.price })
      .returning({ id: quickItems.id });
    return { id: row.id };
  });
}

export async function updateQuickItem(
  ctx: TenantCtx,
  id: number,
  input: { name?: string; price?: string; active?: boolean },
): Promise<void> {
  const patch: { name?: string; price?: string; active?: boolean } = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.price !== undefined) patch.price = input.price;
  if (input.active !== undefined) patch.active = input.active;
  if (Object.keys(patch).length === 0) return;
  await withTenant(ctx, async (tx) => {
    await tx.update(quickItems).set(patch).where(eq(quickItems.id, id));
  });
}

/** Soft-delete: sets active=false (never hard-deletes — transaction_items reference quick_items). */
export async function deactivateQuickItem(ctx: TenantCtx, id: number): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx.update(quickItems).set({ active: false }).where(eq(quickItems.id, id));
  });
}
```

**4. Run the test and confirm it PASSES.**

```bash
pnpm test tests/lib/quickItems.integration.test.ts
```

Expected: all 5 cases green (create round-trip, name-asc ordering, partial update, soft-delete +
re-activation, RLS isolation). The isolation case proves both the read filter AND that B's cross-tenant
UPDATE/deactivate left A's row `{ GeheimA, 9.00, active:true }` untouched — i.e. RLS is doing the scoping,
not the `eq(id, …)` filter.

**5. Typecheck, then commit.**

```bash
pnpm typecheck
git add src/lib/quickItems.ts tests/lib/quickItems.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(slice3): quick_items catalog service (C7)

Tenant-scoped list/create/update/soft-deactivate for the POS quick-item
catalog. Pure data layer (server-only), prices passed through as
numeric(10,2) strings, tenantId written explicitly (defence-in-depth on
top of RLS). Integration test (Testcontainers) covers CRUD, name-asc
ordering, soft-delete + re-activation, and cross-tenant RLS isolation
(B's UPDATE by A's id is a no-op).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

#### Done when

- `pnpm test tests/lib/quickItems.integration.test.ts` is green (5 cases).
- `pnpm typecheck` passes.
- `src/lib/quickItems.ts` exports exactly the C7 surface (`QuickItemRow`, `listActiveQuickItems`,
  `createQuickItem`, `updateQuickItem`, `deactivateQuickItem`) — no extra functions, no zod, no CSRF (those
  belong to the T9 actions that wrap these with the `…Svc` alias).

### Task 6: Wishlist domain + matching

Implements the wishlist domain module (CONTRACTS **C8**, spec §3.5 / §3.6 / §6.3, BUILD-CONTEXT **T6**):
the PURE `matchWishlists` matcher (artist-required ci-substring + optional `label`/`title`/`country`
ci-substring filters), plus the `server-only` DB functions `createWishlist`, `listWishlists`,
`listPendingMatches`, and the match-persistence orchestrator `findAndPersistWishlistMatches`
(idempotent via `onConflictDoNothing` on the unique `(wishlistId, purchaseId)` from T1).

Consumes T1's `wishlists` / `wishlist_matches` / `records` / `purchases` tables + the `WishlistStatus`
enum type. Produces the surfaces T7 (match job → `findAndPersistWishlistMatches`), T9 (actions →
`createWishlist`, `listPendingMatches`), and T12 (UI → `listWishlists`, `listPendingMatches`,
`PendingMatchRow`) depend on. No testids (domain layer; CONTRACTS C12 is untouched).

This task is two red→green cycles: first the PURE matcher (unit-tested, no DB), then the DB functions
(Testcontainers integration-tested with **non-vacuous** idempotency — the second persist call must insert
ZERO rows and the DB must still hold exactly one match row).

#### Files

- **Create** `src/lib/wishlist.ts` — C8 module: `matchWishlists` (pure) + `createWishlist`,
  `listWishlists`, `listPendingMatches`, `findAndPersistWishlistMatches` (`server-only`) + the
  `CreateWishlistInput`, `WishlistRow`, `PendingMatchRow`, `MatchableRecord`, `OpenWishlist` types.
- **Test** `tests/lib/wishlist.test.ts` — PURE `matchWishlists` unit tests (`vi.mock('server-only')` +
  `vi.mock('@/db/client')` so the module graph loads without env/DB).
- **Test** `tests/lib/wishlist.integration.test.ts` — Testcontainers: `createWishlist` insert,
  `findAndPersistWishlistMatches` idempotency (insert-once, re-run inserts zero, exactly one DB row),
  `listPendingMatches` returns only `match.status='pending'` AND `wishlist.status='open'` joins
  (a pending match on a `notified` wishlist is hidden — the C9.4 terminal-notify semantics).

#### Interfaces

**Consumes from earlier tasks (verbatim):**

```ts
// T1 — src/db/schema.ts (tables + enum type)
import { wishlists, wishlistMatches, records, purchases, type WishlistStatus } from '@/db/schema';
//   wishlists:       { id, tenantId, createdByUserId, customerName, customerEmail, artist,
//                      label|null, title|null, country|null, status: wishlist_status default 'open', createdAt }
//   wishlistMatches: { id, tenantId, wishlistId→wishlists.id, purchaseId→purchases.id, recordId→records.id,
//                      status: wishlist_match_status default 'pending', notifiedAt|null, createdAt }
//                    UNIQUE (wishlistId, purchaseId)  ← idempotency key
//   records:         { id, tenantId, title, artist, label: text[] notNull, country|null, coverImage|null, ... }
//   WishlistStatus = 'open' | 'notified' | 'closed'

// src/db/tenant.ts
import { withTenant, type TenantCtx } from '@/db/tenant';
//   TenantCtx = { tenantId: number; userId: number | null }
//   withTenant<T>(ctx, fn: (tx) => Promise<T>): Promise<T>  — ONE transaction, RLS GUCs set transaction-local
```

**Produces for later tasks (exact C8 signatures — copied verbatim):**

```ts
export type CreateWishlistInput = {
  customerName: string;
  customerEmail: string;
  artist: string;
  label?: string | null;
  title?: string | null;
  country?: string | null;
};
export async function createWishlist(ctx: TenantCtx, input: CreateWishlistInput): Promise<{ id: number }>;

export type WishlistRow = {
  id: number; customerName: string; customerEmail: string; artist: string;
  label: string | null; title: string | null; country: string | null;
  status: WishlistStatus; createdAt: Date | null;
};
export async function listWishlists(ctx: TenantCtx): Promise<WishlistRow[]>;

export type PendingMatchRow = {
  matchId: number; wishlistId: number; customerName: string; customerEmail: string;
  artist: string; title: string; coverImage: string | null; createdAt: Date | null;
};
export async function listPendingMatches(ctx: TenantCtx): Promise<PendingMatchRow[]>;

export type MatchableRecord = { artist: string; title: string; country: string | null; label: string[] };
export type OpenWishlist = { id: number; artist: string; label: string | null; title: string | null; country: string | null };
export function matchWishlists(record: MatchableRecord, openWishlists: OpenWishlist[]): number[];

export async function findAndPersistWishlistMatches(
  ctx: TenantCtx,
  args: { purchaseId: number; recordId: number },
): Promise<number>; // count of NEWLY inserted matches (drives non-vacuous idempotency)
```

---

#### Steps

**Cycle A — the PURE `matchWishlists` matcher (no DB)**

1. **Write the failing pure unit test.** Create `tests/lib/wishlist.test.ts` with the COMPLETE contents
   below. It mocks `server-only` and `@/db/client` so importing `@/lib/wishlist` never touches env or a
   real pool (mirrors the established `tests/db/assertions.test.ts` pattern). Assertions are non-vacuous:
   the blank-artist case asserts `[]` (whitespace needle must NOT substring-match the whole catalogue —
   the Ipcha over-match guard), the mixed-set case asserts the exact id subset, and a null-`country`
   record is exercised.

   ```ts
   import { describe, it, expect, vi } from 'vitest';

   // Neutralise the server-only guard + prevent @/db/client (→ @/env → real pg.Pool) from loading.
   vi.mock('server-only', () => ({}));
   vi.mock('@/db/client', () => ({ appPool: {}, ownerPool: {} }));

   import { matchWishlists, type MatchableRecord, type OpenWishlist } from '@/lib/wishlist';

   const record: MatchableRecord = {
     artist: 'Miles Davis',
     title: 'Kind of Blue',
     country: 'US',
     label: ['Columbia', 'Legacy'],
   };

   // Helper: an OpenWishlist with all optional fields null unless overridden.
   const wl = (over: Partial<OpenWishlist> & { id: number; artist: string }): OpenWishlist => ({
     label: null,
     title: null,
     country: null,
     ...over,
   });

   describe('matchWishlists (pure)', () => {
     it('matches on artist as a case-insensitive substring (record CONTAINS wishlist needle)', () => {
       expect(matchWishlists(record, [wl({ id: 1, artist: 'miles' })])).toEqual([1]);
       expect(matchWishlists(record, [wl({ id: 2, artist: 'MILES DAVIS' })])).toEqual([2]);
     });

     it('artist is REQUIRED — a blank/whitespace artist matches NOTHING (over-match guard)', () => {
       expect(matchWishlists(record, [wl({ id: 1, artist: '   ' })])).toEqual([]);
       expect(matchWishlists(record, [wl({ id: 2, artist: '' })])).toEqual([]);
     });

     it('does not match when the artist substring is absent', () => {
       expect(matchWishlists(record, [wl({ id: 1, artist: 'Coltrane' })])).toEqual([]);
     });

     it('applies optional title as a ci-substring filter only when present', () => {
       expect(matchWishlists(record, [wl({ id: 1, artist: 'Miles', title: 'kind of' })])).toEqual([1]);
       expect(matchWishlists(record, [wl({ id: 2, artist: 'Miles', title: 'bitches brew' })])).toEqual([]);
       // blank optional title → treated as absent → still matches on artist alone
       expect(matchWishlists(record, [wl({ id: 3, artist: 'Miles', title: '  ' })])).toEqual([3]);
     });

     it('applies optional country and label ci-substring filters', () => {
       expect(matchWishlists(record, [wl({ id: 1, artist: 'Miles', country: 'us' })])).toEqual([1]);
       expect(matchWishlists(record, [wl({ id: 2, artist: 'Miles', country: 'DE' })])).toEqual([]);
       // label haystack is record.label.join(' ') → 'Columbia Legacy'
       expect(matchWishlists(record, [wl({ id: 3, artist: 'Miles', label: 'columbia' })])).toEqual([3]);
       expect(matchWishlists(record, [wl({ id: 4, artist: 'Miles', label: 'blue note' })])).toEqual([]);
     });

     it('requires artist AND every PRESENT optional field to match', () => {
       expect(
         matchWishlists(record, [
           wl({ id: 1, artist: 'Miles', title: 'Kind', country: 'US', label: 'Columbia' }),
         ]),
       ).toEqual([1]);
       // one optional fails (country) → no match even though artist+title+label all match
       expect(
         matchWishlists(record, [
           wl({ id: 2, artist: 'Miles', title: 'Kind', country: 'JP', label: 'Columbia' }),
         ]),
       ).toEqual([]);
     });

     it('returns only the ids of matching wishlists from a mixed set', () => {
       const ids = matchWishlists(record, [
         wl({ id: 10, artist: 'Miles' }), // match
         wl({ id: 11, artist: 'Coltrane' }), // no
         wl({ id: 12, artist: 'davis', title: 'blue' }), // match ('blue' ⊂ 'kind of blue')
         wl({ id: 13, artist: '   ' }), // blank → no
       ]);
       expect(ids).toEqual([10, 12]);
     });

     it('handles a null record.country safely for country-filtered wishlists', () => {
       const noCountry: MatchableRecord = { ...record, country: null };
       expect(matchWishlists(noCountry, [wl({ id: 1, artist: 'Miles', country: 'US' })])).toEqual([]);
       expect(matchWishlists(noCountry, [wl({ id: 2, artist: 'Miles' })])).toEqual([2]);
     });
   });
   ```

2. **Run it and watch it FAIL.** The module does not exist yet (import resolution / `matchWishlists` undefined).

   ```bash
   pnpm test tests/lib/wishlist.test.ts
   ```

   Expected: FAIL — `Failed to resolve import "@/lib/wishlist"` (or `matchWishlists is not a function`).

3. **Create the module with the PURE matcher only (minimal).** Create `src/lib/wishlist.ts` with EXACTLY:

   ```ts
   import 'server-only';

   // ── PURE matching (no DB; unit-tested with vi.mock('server-only')) ───────────

   export type MatchableRecord = {
     artist: string;
     title: string;
     country: string | null;
     label: string[];
   };

   export type OpenWishlist = {
     id: number;
     artist: string;
     label: string | null;
     title: string | null;
     country: string | null;
   };

   /**
    * Returns the ids of wishlists that match the record. All comparisons are case-insensitive
    * substring with haystack = record, needle = wishlist; every field is `.trim()`ed first.
    *   - artist:  REQUIRED. record.artist (ci) CONTAINS wishlist.artist (ci). A wishlist whose artist
    *              is BLANK after trim matches NOTHING (prevents a whitespace needle matching every record).
    *   - title:   optional. if present, record.title (ci) CONTAINS wishlist.title (ci).
    *   - country: optional. if present, (record.country ?? '') (ci) CONTAINS wishlist.country (ci).
    *   - label:   optional. if present, record.label.join(' ') (ci) CONTAINS wishlist.label (ci).
    * A wishlist matches only if artist matches AND every PRESENT optional field matches; empty/whitespace
    * optional fields are treated as absent.
    */
   export function matchWishlists(record: MatchableRecord, openWishlists: OpenWishlist[]): number[] {
     const hay = {
       artist: record.artist.trim().toLowerCase(),
       title: record.title.trim().toLowerCase(),
       country: (record.country ?? '').trim().toLowerCase(),
       label: record.label.join(' ').trim().toLowerCase(),
     };
     // REQUIRED needle: a blank needle never matches (defensive over-match guard).
     const required = (haystack: string, needle: string): boolean => {
       const n = needle.trim().toLowerCase();
       return n !== '' && haystack.includes(n);
     };
     // OPTIONAL needle: a blank needle is treated as absent → no constraint (passes).
     const optional = (haystack: string, needle: string | null): boolean => {
       const n = (needle ?? '').trim().toLowerCase();
       return n === '' || haystack.includes(n);
     };
     return openWishlists
       .filter(
         (w) =>
           required(hay.artist, w.artist) &&
           optional(hay.title, w.title) &&
           optional(hay.country, w.country) &&
           optional(hay.label, w.label),
       )
       .map((w) => w.id);
   }
   ```

4. **Run the pure test and watch it PASS.**

   ```bash
   pnpm test tests/lib/wishlist.test.ts
   ```

   Expected: PASS — all 7 `it` blocks green.

5. **Commit.**

   ```bash
   git add src/lib/wishlist.ts tests/lib/wishlist.test.ts
   git commit -m "feat(slice3): pure matchWishlists matcher (artist-required ci-substring + optional filters)

Implements CONTRACTS C8 matchWishlists: case-insensitive substring matching with
haystack=record, needle=wishlist; artist required (blank artist matches nothing —
Ipcha over-match guard), optional label/title/country treated as absent when blank.
Pure, no DB; unit-tested via vi.mock('server-only')+vi.mock('@/db/client').

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
   ```

**Cycle B — the `server-only` DB functions (Testcontainers)**

6. **Write the failing integration test.** Create `tests/lib/wishlist.integration.test.ts` with the
   COMPLETE contents below. It mirrors `tests/ankauf.integration.test.ts` (env published by
   `setupTestDatabase` BEFORE any `@/db/*` dynamic import). The idempotency assertion is non-vacuous:
   the second `findAndPersistWishlistMatches` must return `0` AND the DB must hold exactly ONE match row
   (the unique `(wishlistId, purchaseId)` + `onConflictDoNothing` held). The `listPendingMatches` test
   seeds a `pending` match on a `notified` wishlist and asserts it is HIDDEN (C9.4 terminal-notify).

   ```ts
   import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
   import { eq } from 'drizzle-orm';
   import { setupTestDatabase, seedTenant } from '../helpers/db';

   let wishlistLib: typeof import('@/lib/wishlist');
   let withTenant: (typeof import('@/db/tenant'))['withTenant'];
   let schema: typeof import('@/db/schema');
   let teardown: (() => Promise<void>) | undefined;
   let tenantA: number;
   let adminA: number;

   beforeAll(async () => {
     const db = await setupTestDatabase();
     teardown = db.teardown;
     vi.resetModules();
     wishlistLib = await import('@/lib/wishlist');
     ({ withTenant } = await import('@/db/tenant'));
     schema = await import('@/db/schema');
     const seeded = await seedTenant({ slug: 'wl-demo', name: 'WL Demo' });
     tenantA = seeded.tenantId;
     adminA = seeded.adminUserId;
   });
   afterAll(async () => {
     if (teardown) await teardown();
   });

   const ctx = () => ({ tenantId: tenantA, userId: adminA });

   // Seed a record + an available purchase copy directly on the RLS tx (not the system under test).
   async function seedRecordAndPurchase(opts: {
     artist: string;
     title: string;
     country?: string | null;
     label?: string[];
     hash: string;
   }): Promise<{ recordId: number; purchaseId: number }> {
     return withTenant(ctx(), async (tx) => {
       const [rec] = await tx
         .insert(schema.records)
         .values({
           tenantId: tenantA,
           title: opts.title,
           artist: opts.artist,
           label: opts.label ?? [],
           country: opts.country ?? null,
           hash: opts.hash,
         })
         .returning({ id: schema.records.id });
       const [pur] = await tx
         .insert(schema.purchases)
         .values({ tenantId: tenantA, recordId: rec!.id, targetPrice: '20.00', status: 'verfuegbar' })
         .returning({ id: schema.purchases.id });
       return { recordId: rec!.id, purchaseId: pur!.id };
     });
   }

   describe('createWishlist', () => {
     it('inserts a wishlist (open by default) and normalises blank optionals to null', async () => {
       const { id } = await wishlistLib.createWishlist(ctx(), {
         customerName: '  Ada  ',
         customerEmail: 'ada@example.test',
         artist: '  Kraftwerk  ',
         label: '   ', // blank → null
         title: null,
         country: 'DE',
       });
       const [row] = await withTenant(ctx(), async (tx) =>
         tx.select().from(schema.wishlists).where(eq(schema.wishlists.id, id)),
       );
       expect(row?.status).toBe('open');
       expect(row?.customerName).toBe('Ada'); // trimmed
       expect(row?.artist).toBe('Kraftwerk'); // trimmed
       expect(row?.label).toBeNull(); // blank optional → null
       expect(row?.country).toBe('DE');
       expect(row?.createdByUserId).toBe(adminA);
     });

     it('throws when ctx.userId is null (createdByUserId is NOT NULL)', async () => {
       await expect(
         wishlistLib.createWishlist(
           { tenantId: tenantA, userId: null },
           { customerName: 'X', customerEmail: 'x@example.test', artist: 'Y' },
         ),
       ).rejects.toThrow(/userId/);
     });
   });

   describe('findAndPersistWishlistMatches', () => {
     it('inserts one pending match and is idempotent on re-run (non-vacuous)', async () => {
       const { recordId, purchaseId } = await seedRecordAndPurchase({
         artist: 'Miles Davis',
         title: 'Kind of Blue',
         country: 'US',
         label: ['Columbia'],
         hash: 'm'.padEnd(64, '1'),
       });
       await wishlistLib.createWishlist(ctx(), {
         customerName: 'Bo',
         customerEmail: 'bo@example.test',
         artist: 'miles davis', // ci-substring of 'Miles Davis'
       });

       const first = await wishlistLib.findAndPersistWishlistMatches(ctx(), { purchaseId, recordId });
       expect(first).toBe(1); // one NEW match inserted

       const second = await wishlistLib.findAndPersistWishlistMatches(ctx(), { purchaseId, recordId });
       expect(second).toBe(0); // onConflictDoNothing — re-run inserts ZERO

       const rows = await withTenant(ctx(), async (tx) =>
         tx
           .select()
           .from(schema.wishlistMatches)
           .where(eq(schema.wishlistMatches.purchaseId, purchaseId)),
       );
       expect(rows).toHaveLength(1); // non-vacuous: exactly one row survives the re-run
       expect(rows[0]?.status).toBe('pending');
     });

     it('returns 0 and inserts nothing when no open wishlist matches the record', async () => {
       const { recordId, purchaseId } = await seedRecordAndPurchase({
         artist: 'Nobody Wants This',
         title: 'Untracked',
         hash: 'n'.padEnd(64, '2'),
       });
       const n = await wishlistLib.findAndPersistWishlistMatches(ctx(), { purchaseId, recordId });
       expect(n).toBe(0);
       const rows = await withTenant(ctx(), async (tx) =>
         tx
           .select()
           .from(schema.wishlistMatches)
           .where(eq(schema.wishlistMatches.purchaseId, purchaseId)),
       );
       expect(rows).toHaveLength(0);
     });
   });

   describe('listPendingMatches', () => {
     it('returns pending matches on OPEN wishlists and HIDES matches on notified wishlists', async () => {
       // (a) open wishlist + matching pending match → must appear
       const a = await seedRecordAndPurchase({
         artist: 'Aphex Twin',
         title: 'Selected Ambient Works',
         hash: 'a'.padEnd(64, '3'),
       });
       await wishlistLib.createWishlist(ctx(), {
         customerName: 'Ci',
         customerEmail: 'ci@example.test',
         artist: 'aphex twin',
       });
       await wishlistLib.findAndPersistWishlistMatches(ctx(), {
         purchaseId: a.purchaseId,
         recordId: a.recordId,
       });

       // (b) NOTIFIED wishlist carrying a pending match → must be hidden (terminal-notify, C9.4)
       const b = await seedRecordAndPurchase({
         artist: 'Boards of Canada',
         title: 'Music Has the Right',
         hash: 'b'.padEnd(64, '4'),
       });
       const notifiedWishlistId = await withTenant(ctx(), async (tx) => {
         const [w] = await tx
           .insert(schema.wishlists)
           .values({
             tenantId: tenantA,
             createdByUserId: adminA,
             customerName: 'Do',
             customerEmail: 'do@example.test',
             artist: 'Boards of Canada',
             status: 'notified',
           })
           .returning({ id: schema.wishlists.id });
         await tx.insert(schema.wishlistMatches).values({
           tenantId: tenantA,
           wishlistId: w!.id,
           purchaseId: b.purchaseId,
           recordId: b.recordId,
           status: 'pending',
         });
         return w!.id;
       });

       const pending = await wishlistLib.listPendingMatches(ctx());
       expect(pending.map((p) => p.artist)).toContain('Aphex Twin');
       expect(pending.some((p) => p.wishlistId === notifiedWishlistId)).toBe(false);
       // join shape is populated (customer from wishlists, artist/title from records)
       const aphex = pending.find((p) => p.artist === 'Aphex Twin');
       expect(aphex?.customerName).toBe('Ci');
       expect(aphex?.title).toBe('Selected Ambient Works');
       expect(typeof aphex?.matchId).toBe('number');
     });
   });
   ```

7. **Run it and watch it FAIL.** The DB functions are not exported yet.

   ```bash
   pnpm test tests/lib/wishlist.integration.test.ts
   ```

   Expected: FAIL — `wishlistLib.createWishlist is not a function` (and likewise for
   `findAndPersistWishlistMatches` / `listPendingMatches`).

8. **Add the DB functions to the module.** Edit `src/lib/wishlist.ts`: (a) replace the top
   `import 'server-only';` line with the DB imports below, and (b) append the four `server-only`
   functions AFTER the existing `matchWishlists` export.

   8a. Replace the first line:

   ```ts
   import 'server-only';
   ```

   with:

   ```ts
   import 'server-only';
   import { and, desc, eq } from 'drizzle-orm';
   import { withTenant, type TenantCtx } from '@/db/tenant';
   import { wishlists, wishlistMatches, records, type WishlistStatus } from '@/db/schema';
   ```

   8b. Append at the END of `src/lib/wishlist.ts`:

   ```ts
   // ── DB layer (server-only; runs on the withTenant Tx) ────────────────────────

   export type CreateWishlistInput = {
     customerName: string;
     customerEmail: string;
     artist: string;
     label?: string | null;
     title?: string | null;
     country?: string | null;
   };

   /** Trim a free-text optional field; an empty/whitespace value persists as NULL (matches C11 note). */
   function nullableTrim(value: string | null | undefined): string | null {
     const trimmed = (value ?? '').trim();
     return trimmed === '' ? null : trimmed;
   }

   export async function createWishlist(
     ctx: TenantCtx,
     input: CreateWishlistInput,
   ): Promise<{ id: number }> {
     if (ctx.userId === null) {
       throw new Error('createWishlist: ctx.userId is required (created_by_user_id is NOT NULL)');
     }
     const userId = ctx.userId;
     return withTenant(ctx, async (tx) => {
       const [row] = await tx
         .insert(wishlists)
         .values({
           tenantId: ctx.tenantId,
           createdByUserId: userId,
           customerName: input.customerName.trim(),
           customerEmail: input.customerEmail.trim(),
           artist: input.artist.trim(),
           label: nullableTrim(input.label),
           title: nullableTrim(input.title),
           country: nullableTrim(input.country),
         })
         .returning({ id: wishlists.id });
       return { id: row!.id };
     });
   }

   export type WishlistRow = {
     id: number;
     customerName: string;
     customerEmail: string;
     artist: string;
     label: string | null;
     title: string | null;
     country: string | null;
     status: WishlistStatus;
     createdAt: Date | null;
   };

   /** All wishlists for the tenant, newest first (UI groups by status). */
   export async function listWishlists(ctx: TenantCtx): Promise<WishlistRow[]> {
     return withTenant(ctx, async (tx) =>
       tx
         .select({
           id: wishlists.id,
           customerName: wishlists.customerName,
           customerEmail: wishlists.customerEmail,
           artist: wishlists.artist,
           label: wishlists.label,
           title: wishlists.title,
           country: wishlists.country,
           status: wishlists.status,
           createdAt: wishlists.createdAt,
         })
         .from(wishlists)
         .orderBy(desc(wishlists.createdAt)),
     );
   }

   /** One pending wishlist match joined to its wishlist (customer) + the arrived copy's record (display). */
   export type PendingMatchRow = {
     matchId: number;
     wishlistId: number;
     customerName: string;
     customerEmail: string;
     artist: string;
     title: string;
     coverImage: string | null;
     createdAt: Date | null;
   };

   /**
    * Pending matches for the tenant — single source for the wunschlisten "Offene Treffer" section and the
    * Benachrichtigen-Modal preview. Joins wishlist_matches → wishlists → records and returns ONLY rows where
    * wishlist_matches.status = 'pending' AND wishlists.status = 'open' (a notified wishlist is terminal for
    * matching — its leftover pending matches are hidden; C9.4). Newest match first. ONE withTenant tx.
    */
   export async function listPendingMatches(ctx: TenantCtx): Promise<PendingMatchRow[]> {
     return withTenant(ctx, async (tx) =>
       tx
         .select({
           matchId: wishlistMatches.id,
           wishlistId: wishlistMatches.wishlistId,
           customerName: wishlists.customerName,
           customerEmail: wishlists.customerEmail,
           artist: records.artist,
           title: records.title,
           coverImage: records.coverImage,
           createdAt: wishlistMatches.createdAt,
         })
         .from(wishlistMatches)
         .innerJoin(wishlists, eq(wishlistMatches.wishlistId, wishlists.id))
         .innerJoin(records, eq(wishlistMatches.recordId, records.id))
         .where(and(eq(wishlistMatches.status, 'pending'), eq(wishlists.status, 'open')))
         .orderBy(desc(wishlistMatches.createdAt)),
     );
   }

   /**
    * Loads the record (artist/title/country/label) + this tenant's OPEN wishlists, runs matchWishlists,
    * and inserts one wishlist_matches (status 'pending') per matched wishlist using onConflictDoNothing on
    * the unique (wishlistId, purchaseId) — idempotent on match-job re-runs. Returns the number of NEWLY
    * inserted matches (use .returning() length; drives non-vacuous idempotency assertions). ONE withTenant tx.
    */
   export async function findAndPersistWishlistMatches(
     ctx: TenantCtx,
     args: { purchaseId: number; recordId: number },
   ): Promise<number> {
     return withTenant(ctx, async (tx) => {
       const [rec] = await tx
         .select({
           artist: records.artist,
           title: records.title,
           country: records.country,
           label: records.label,
         })
         .from(records)
         .where(eq(records.id, args.recordId));
       if (!rec) return 0;

       const open = await tx
         .select({
           id: wishlists.id,
           artist: wishlists.artist,
           label: wishlists.label,
           title: wishlists.title,
           country: wishlists.country,
         })
         .from(wishlists)
         .where(eq(wishlists.status, 'open'));

       const matchedIds = matchWishlists(
         { artist: rec.artist, title: rec.title, country: rec.country, label: rec.label },
         open,
       );
       if (matchedIds.length === 0) return 0;

       const inserted = await tx
         .insert(wishlistMatches)
         .values(
           matchedIds.map((wishlistId) => ({
             tenantId: ctx.tenantId,
             wishlistId,
             purchaseId: args.purchaseId,
             recordId: args.recordId,
           })),
         )
         .onConflictDoNothing({
           target: [wishlistMatches.wishlistId, wishlistMatches.purchaseId],
         })
         .returning({ id: wishlistMatches.id });

       return inserted.length;
     });
   }
   ```

9. **Run the integration test and watch it PASS.**

   ```bash
   pnpm test tests/lib/wishlist.integration.test.ts
   ```

   Expected: PASS — `createWishlist` (2), `findAndPersistWishlistMatches` (2), `listPendingMatches` (1).

10. **Re-run BOTH wishlist test files + typecheck (the pure test must stay green now that the module
    pulled in `@/db/*`), then commit.** The pure test's `vi.mock('@/db/client')` keeps the enlarged
    import graph env-free. (The controller runs the FULL `pnpm test` before final review — per-task
    reviewers do not — so this step only proves the two new files + types.)

    ```bash
    pnpm test tests/lib/wishlist.test.ts tests/lib/wishlist.integration.test.ts && pnpm typecheck
    ```

    Expected: both files PASS, `tsc --noEmit` clean. Then:

    ```bash
    git add src/lib/wishlist.ts tests/lib/wishlist.integration.test.ts
    git commit -m "feat(slice3): wishlist DB domain — create/list/pending-matches + idempotent persist

Implements CONTRACTS C8 server-only functions on the withTenant Tx:
- createWishlist (open by default; blank optionals normalised to null; throws if ctx.userId null)
- listWishlists (newest first)
- listPendingMatches (wishlist_matches⋈wishlists⋈records; status='pending' AND wishlist='open' only —
  notified wishlists are terminal for matching per C9.4)
- findAndPersistWishlistMatches (matchWishlists + onConflictDoNothing on unique (wishlistId,purchaseId);
  returns NEWLY inserted count for non-vacuous idempotency)
Testcontainers integration: insert-once / re-run inserts zero / exactly one DB row;
notified-wishlist match hidden from listPendingMatches.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
    ```

---

#### Notes / lessons honored

- **Non-vacuous idempotency (lesson #3):** the second `findAndPersistWishlistMatches` returns `0` AND the
  DB holds exactly one match row — the assertion fails if `onConflictDoNothing` or the unique
  `(wishlistId, purchaseId)` is wrong, not just if a deterministic id is re-returned.
- **Over-match guard (Ipcha):** `matchWishlists` treats a blank artist as matching NOTHING and blank
  optionals as absent — the pure test asserts both, complementing the `createWishlistSchema.artist.trim().min(1)`
  zod guard (T9) and the service's `nullableTrim` of optionals.
- **Terminal-notify (C9.4):** `listPendingMatches` filters `wishlists.status='open'`, so a `pending` match
  on a `notified` wishlist is hidden — exercised explicitly in the integration test.
- **One withTenant tx per function; `tenantId` written explicitly** (defence-in-depth alongside the RLS GUC
  default from T1), matching `performAnkauf`.
- **userId guard:** `createWishlist` throws if `ctx.userId === null` (`created_by_user_id` is NOT NULL),
  per the C0 global convention.
- **Pure layer isolation:** the unit test mocks `server-only` AND `@/db/client` so importing the (now
  DB-importing) module never constructs a real `pg.Pool` or reads `@/env` — mirrors `tests/db/assertions.test.ts`.
- No new testids, no token/UI surface, no migration changes — this task is domain-only; CONTRACTS C12/C13
  are untouched.

### Task 7: Wishlist match job

Wires the post-ankauf wishlist matching into the background-job infrastructure: a new pg-boss queue
`tenant.wishlist.match`, an `enqueueWishlistMatch` producer, a `handleWishlistMatch` worker handler that
delegates to the pure+persistence `findAndPersistWishlistMatches` (T6), and the post-commit enqueue at the
verified call site in the `ankaufRecord` server action. Idempotency is proven non-vacuously (spy the
persistence call, assert it re-ran AND that the unique `(wishlistId, purchaseId)` + `onConflictDoNothing`
deduped to a single row — first run inserts 1, second inserts 0). No email is sent here (staff-confirmed
flow happens in T8).

References: spec §6.3 · BUILD-CONTEXT T7 · CONTRACTS C9 (C9.1/C9.2/C9.3/C9.4/C9.5), consuming C8
(`findAndPersistWishlistMatches`, `createWishlist`) and C2 (`wishlistMatches` table).

**Depends on:** T1 (schema/RLS for `wishlists`/`wishlist_matches`), T6 (`@/lib/wishlist`:
`createWishlist`, `findAndPersistWishlistMatches`). T8 adds the SECOND queue (`wishlistNotify`) — do NOT add
it here.

---

#### Files

- **Create** `src/worker/jobs/wishlistMatch.ts` — `WishlistMatchPayload` type + `handleWishlistMatch`
  handler (C9.2/C9.4).
- **Modify** `src/worker/index.ts` — add `QUEUE.wishlistMatch`, a type-only payload import, and the
  `createQueue` + `work` registration in `startWorker()` (C9.1).
- **Modify** `src/lib/jobs.ts` — add `enqueueWishlistMatch` and `createQueue(QUEUE.wishlistMatch)` inside
  `getBoss()` (C9.3).
- **Modify** `src/app/(app)/ankauf/actions.ts` — post-commit `enqueueWishlistMatch` in its own try/catch
  (C9.5).
- **Test (create)** `tests/worker/wishlistMatch.integration.test.ts` — Testcontainers: matching ankauf →
  one `pending` match; non-vacuous idempotency; present-but-non-matching wishlist → zero matches.
- **Test (modify)** `tests/worker.unit.test.ts` — assert `QUEUE.wishlistMatch` canonical name (env-less).
- **Test (modify)** `tests/ankauf-actions.integration.test.ts` — extend the `@/lib/jobs` mock with
  `enqueueWishlistMatch` and assert it fires on every successful ankauf.

---

#### Interfaces

**Consumes from earlier tasks (copy verbatim):**

```ts
// @/db/tenant (existing)
type TenantCtx = { tenantId: number; userId: number | null };

// @/lib/wishlist (T6, C8) — server-only
export async function createWishlist(ctx: TenantCtx, input: CreateWishlistInput): Promise<{ id: number }>;
export async function findAndPersistWishlistMatches(
  ctx: TenantCtx,
  args: { purchaseId: number; recordId: number },
): Promise<number>; // count of NEWLY inserted matches (drives non-vacuous idempotency)

// @/lib/ankauf (existing) — used by the integration test fixture
export async function performAnkauf(
  ctx: TenantCtx,
  input: AnkaufInput,
): Promise<{ recordId: number; purchaseId: number }>;

// @/db/schema (T1, C2) — referenced in assertions
export const wishlistMatches; // columns: id, tenantId, wishlistId, purchaseId, recordId,
                              // status ('pending'|'notified'|'dismissed'), notifiedAt, createdAt
```

**Produces for later tasks (copy verbatim — C9):**

```ts
// src/worker/index.ts — QUEUE gains ONE entry (T8 adds wishlistNotify separately)
export const QUEUE = {
  analyticsSummaryRefresh: 'system.analytics_summary.refresh',
  discogsListingCreate: 'tenant.discogs.listing.create',
  wishlistMatch: 'tenant.wishlist.match',
} as const;

// src/worker/jobs/wishlistMatch.ts
export type WishlistMatchPayload = { tenantId: number; purchaseId: number; recordId: number };
export async function handleWishlistMatch(job: PgBoss.Job<WishlistMatchPayload>): Promise<void>;

// src/lib/jobs.ts
export async function enqueueWishlistMatch(payload: WishlistMatchPayload): Promise<void>;
```

---

#### Steps

**Block A — Worker handler (the core deliverable, TDD against a real DB)**

1. **Write the failing handler integration test.** Create
   `tests/worker/wishlistMatch.integration.test.ts` with this exact content:

   ```ts
   import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
   import { eq } from 'drizzle-orm';
   import { setupTestDatabase, seedTenant } from '../helpers/db';

   let handleWishlistMatch: (typeof import('@/worker/jobs/wishlistMatch'))['handleWishlistMatch'];
   let wishlist: typeof import('@/lib/wishlist');
   let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
   let withTenant: (typeof import('@/db/tenant'))['withTenant'];
   let schema: typeof import('@/db/schema');
   let teardown: (() => Promise<void>) | undefined;
   let tenantA: number;
   let adminUserId: number;

   beforeAll(async () => {
     const db = await setupTestDatabase();
     teardown = db.teardown;
     process.env.DATABASE_URL = db.appUrl;
     process.env.DATABASE_OWNER_URL = db.ownerUrl;
     process.env.DISCOGS_DRIVER = 'fake';
     vi.resetModules();
     ({ handleWishlistMatch } = await import('@/worker/jobs/wishlistMatch'));
     wishlist = await import('@/lib/wishlist');
     ({ performAnkauf } = await import('@/lib/ankauf'));
     ({ withTenant } = await import('@/db/tenant'));
     schema = await import('@/db/schema');
     // Seed AFTER resetModules so seedTenant's ownerPool binds to the same @/db/client
     // instance teardown closes.
     ({ tenantId: tenantA, adminUserId } = await seedTenant({ slug: 'demo', name: 'Demo' }));
   }, 120_000);

   afterAll(async () => {
     if (teardown) await teardown();
   });

   const makeWishlist = (artist: string) =>
     wishlist.createWishlist(
       { tenantId: tenantA, userId: adminUserId },
       { customerName: 'Klaus', customerEmail: 'klaus@example.test', artist },
     );

   const ankauf = (artist: string, title: string, discogsId: number) =>
     performAnkauf(
       { tenantId: tenantA, userId: null },
       {
         release: {
           discogsId,
           title,
           artist,
           country: 'US',
           year: 1959,
           format: 'Vinyl',
           genre: ['Jazz'],
           label: ['Columbia'],
           coverImage: null,
         },
         purchasePrice: '3.00',
         targetPrice: '20.00',
         conditionRecord: 5,
         conditionCover: 4,
         listOnDiscogs: false,
       },
     );

   const fakeJob = (purchaseId: number, recordId: number) =>
     ({ id: 'j', name: 'q', data: { tenantId: tenantA, purchaseId, recordId } }) as unknown as Parameters<
       typeof handleWishlistMatch
     >[0];

   const matchesFor = async (purchaseId: number) =>
     withTenant({ tenantId: tenantA, userId: null }, async (tx) =>
       tx
         .select()
         .from(schema.wishlistMatches)
         .where(eq(schema.wishlistMatches.purchaseId, purchaseId)),
     );

   describe('handleWishlistMatch', () => {
     it('creates one pending match for a matching open wishlist', async () => {
       const wl = await makeWishlist('Miles Davis');
       const { recordId, purchaseId } = await ankauf('Miles Davis', 'Kind of Blue', 101);

       await handleWishlistMatch(fakeJob(purchaseId, recordId));

       const rows = await matchesFor(purchaseId);
       expect(rows).toHaveLength(1);
       expect(rows[0]?.wishlistId).toBe(wl.id);
       expect(rows[0]?.recordId).toBe(recordId);
       expect(rows[0]?.status).toBe('pending');
     });

     it('is idempotent on re-run: persist re-invoked, but only one row (1 inserted then 0)', async () => {
       await makeWishlist('Coltrane');
       const { recordId, purchaseId } = await ankauf('John Coltrane', 'Blue Train', 102);

       // spyOn calls THROUGH (no mockImplementation): the real persistence runs each time,
       // and we read its return values to prove the DB-level dedup, not a handler short-circuit.
       const spy = vi.spyOn(wishlist, 'findAndPersistWishlistMatches');
       try {
         await handleWishlistMatch(fakeJob(purchaseId, recordId));
         await handleWishlistMatch(fakeJob(purchaseId, recordId));

         // Non-vacuous: the handler did NOT skip the second run...
         expect(spy).toHaveBeenCalledTimes(2);
         // ...and onConflictDoNothing on unique (wishlistId, purchaseId) deduped it: 1 then 0.
         const inserted = await Promise.all(spy.mock.results.map((r) => r.value as Promise<number>));
         expect(inserted).toEqual([1, 0]);

         const rows = await matchesFor(purchaseId);
         expect(rows).toHaveLength(1);
         expect(rows[0]?.status).toBe('pending');
       } finally {
         spy.mockRestore();
       }
     });

     it('creates no match when a present wishlist does not match the arrived record', async () => {
       await makeWishlist('Bill Evans');
       const { recordId, purchaseId } = await ankauf('Sun Ra', 'Space Is the Place', 103);

       await handleWishlistMatch(fakeJob(purchaseId, recordId));

       const rows = await matchesFor(purchaseId);
       expect(rows).toHaveLength(0);
     });
   });
   ```

2. **Run it, expecting FAIL** (module `@/worker/jobs/wishlistMatch` does not exist yet):

   ```
   pnpm test tests/worker/wishlistMatch.integration.test.ts
   ```
   Expected: failure resolving `@/worker/jobs/wishlistMatch` (cannot find module / import error).

3. **Create the handler** `src/worker/jobs/wishlistMatch.ts` with this exact content:

   ```ts
   import type PgBoss from 'pg-boss';
   import { findAndPersistWishlistMatches } from '@/lib/wishlist';

   /** Payload for queue `tenant.wishlist.match`. Shared with the queue registration via a type-only import. */
   export type WishlistMatchPayload = { tenantId: number; purchaseId: number; recordId: number };

   /**
    * Worker handler for queue `tenant.wishlist.match`.
    *
    * Loads this tenant's OPEN wishlists, matches them against the arrived copy's record, and inserts one
    * `wishlist_matches` (status 'pending') per matched wishlist. Idempotent: persistence uses
    * `onConflictDoNothing` on the unique `(wishlistId, purchaseId)`, so a pg-boss retry / duplicate send
    * re-runs the match harmlessly (re-insert affects zero rows).
    *
    * No email is sent here — notification is the staff-confirmed flow (T8, queue `tenant.wishlist.notify`).
    */
   export async function handleWishlistMatch(job: PgBoss.Job<WishlistMatchPayload>): Promise<void> {
     const { tenantId, purchaseId, recordId } = job.data;
     const ctx = { tenantId, userId: null };
     await findAndPersistWishlistMatches(ctx, { purchaseId, recordId });
   }
   ```

4. **Run the handler test, expecting PASS:**

   ```
   pnpm test tests/worker/wishlistMatch.integration.test.ts
   ```
   Expected: 3 passing tests (pending match created; idempotent `[1, 0]` with one row; no match for a
   non-matching wishlist).

5. **Commit:**

   ```
   git add src/worker/jobs/wishlistMatch.ts tests/worker/wishlistMatch.integration.test.ts
   git commit -m "$(cat <<'EOF'
   feat(slice3): wishlist match worker handler (tenant.wishlist.match)

   handleWishlistMatch delegates to findAndPersistWishlistMatches; idempotent via
   unique (wishlistId, purchaseId) + onConflictDoNothing. Integration test proves
   non-vacuous idempotency (persist re-invoked, inserts 1 then 0, single row).

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

**Block B — Queue registration + enqueue producer (env-less QUEUE constant under test)**

6. **Add a failing QUEUE assertion** to `tests/worker.unit.test.ts`. Inside the existing
   `describe('QUEUE constants', ...)` block, add this test after the `discogsListingCreate` case:

   ```ts
     it('wishlistMatch equals the canonical queue name (env-less import)', async () => {
       const { QUEUE } = await import('@/worker/index');
       expect(QUEUE.wishlistMatch).toBe('tenant.wishlist.match');
     });
   ```

7. **Run it, expecting FAIL** (`QUEUE.wishlistMatch` is `undefined`):

   ```
   pnpm test tests/worker.unit.test.ts
   ```
   Expected: the new assertion fails — `expected undefined to be 'tenant.wishlist.match'`.

8. **Implement the queue + producer wiring.** Three edits:

   8a. In `src/worker/index.ts`, add the type-only payload import directly after the existing
   `DiscogsListingPayload` type import (keeps `import { QUEUE }` env-less):

   ```ts
   // Type-only import (erased at compile time) — keeps the queue registration and the real
   // handler sharing ONE payload type without pulling the job module's @/db → @/env chain.
   import type { WishlistMatchPayload } from './jobs/wishlistMatch';
   ```

   Add the `wishlistMatch` entry to the `QUEUE` object (T8 will append `wishlistNotify` after it):

   ```ts
   export const QUEUE = {
     analyticsSummaryRefresh: 'system.analytics_summary.refresh',
     discogsListingCreate: 'tenant.discogs.listing.create',
     wishlistMatch: 'tenant.wishlist.match',
   } as const;
   ```

   In `startWorker()`, add the lazy handler import alongside the existing handler imports:

   ```ts
   const { handleWishlistMatch } = await import('./jobs/wishlistMatch');
   ```

   And, immediately after the `discogsListingCreate` `work()` registration block (after its
   `console.log(...Handler registered for queue: ${QUEUE.discogsListingCreate}...)` line), add:

   ```ts
   // Per-tenant wishlist match job (Slice 3): match arrived copies against open wishlists.
   await boss.createQueue(QUEUE.wishlistMatch);
   console.log(`[worker] Queue created/verified: ${QUEUE.wishlistMatch}`);

   await boss.work<WishlistMatchPayload>(
     QUEUE.wishlistMatch,
     async (jobs: PgBoss.Job<WishlistMatchPayload>[]) => {
       for (const job of jobs) {
         await handleWishlistMatch(job);
       }
     },
   );
   console.log(`[worker] Handler registered for queue: ${QUEUE.wishlistMatch}`);
   ```

   8b. In `src/lib/jobs.ts`, add the type-only payload import after the `QUEUE` import:

   ```ts
   import type { WishlistMatchPayload } from '@/worker/jobs/wishlistMatch';
   ```

   Inside `getBoss()`, add the `createQueue` call right after the existing
   `await boss.createQueue(QUEUE.discogsListingCreate);` (send() requires the queue to exist in the web
   process's boss instance):

   ```ts
         await boss.createQueue(QUEUE.discogsListingCreate);
         await boss.createQueue(QUEUE.wishlistMatch);
   ```

   Append the producer after `enqueueDiscogsListing`:

   ```ts
   export async function enqueueWishlistMatch(payload: WishlistMatchPayload): Promise<void> {
     const boss = await getBoss();
     await boss.send(QUEUE.wishlistMatch, payload, {
       retryLimit: 5,
       retryBackoff: true,
     });
   }
   ```

9. **Run the worker unit test, expecting PASS, and typecheck the new wiring:**

   ```
   pnpm test tests/worker.unit.test.ts && pnpm typecheck
   ```
   Expected: all `QUEUE constants` tests pass (including `wishlistMatch`); `tsc --noEmit` reports no
   errors.

10. **Commit:**

    ```
    git add src/worker/index.ts src/lib/jobs.ts tests/worker.unit.test.ts
    git commit -m "$(cat <<'EOF'
    feat(slice3): register wishlist-match queue + enqueueWishlistMatch producer

    Adds QUEUE.wishlistMatch ('tenant.wishlist.match'), createQueue + work() in
    startWorker, and enqueueWishlistMatch (retryLimit 5, retryBackoff). getBoss
    creates the queue so the web process can send().

    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
    EOF
    )"
    ```

**Block C — Post-commit enqueue at the verified ankauf call site (C9.5)**

11. **Extend the ankauf-actions test (red first).** In `tests/ankauf-actions.integration.test.ts`:

    Replace the top-of-file jobs mock:

    ```ts
    const enqueueSpy = vi.fn(async () => undefined);
    vi.mock('@/lib/jobs', () => ({ enqueueDiscogsListing: enqueueSpy }));
    ```

    with (extends the mock — the modified action now imports `enqueueWishlistMatch` too; mock drift would
    otherwise silently swallow a `TypeError`):

    ```ts
    const enqueueSpy = vi.fn(async () => undefined);
    const enqueueMatchSpy = vi.fn(async () => undefined);
    vi.mock('@/lib/jobs', () => ({
      enqueueDiscogsListing: enqueueSpy,
      enqueueWishlistMatch: enqueueMatchSpy,
    }));
    ```

    Add this test inside `describe('ankauf actions', ...)` (after the existing cases):

    ```ts
      it('ankaufRecord enqueues a wishlist match on every successful ankauf (independent of listing)', async () => {
        enqueueMatchSpy.mockClear();
        const r = await actions.ankaufRecord({
          release,
          purchasePrice: '4.00',
          targetPrice: '19.00',
          conditionRecord: 4,
          conditionCover: 4,
          listOnDiscogs: false, // wishlist enqueue must fire even when NOT listing on Discogs
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(enqueueMatchSpy).toHaveBeenCalledWith({
            tenantId: tenantA,
            purchaseId: r.purchaseId,
            recordId: r.recordId,
          });
        }
        // Not listing → the discogs enqueue must NOT have run for this call.
        expect(enqueueSpy).not.toHaveBeenCalled();
      });
    ```

12. **Run it, expecting FAIL** (`ankaufRecord` does not yet call `enqueueWishlistMatch`, so the spy is
    never called):

    ```
    pnpm test tests/ankauf-actions.integration.test.ts
    ```
    Expected: the new assertion fails — `enqueueMatchSpy` has zero calls.

13. **Implement the post-commit enqueue** in `src/app/(app)/ankauf/actions.ts`.

    Update the jobs import:

    ```ts
    import { enqueueDiscogsListing, enqueueWishlistMatch } from '@/lib/jobs';
    ```

    In `ankaufRecord`, after the existing `revalidatePath('/inventar');` / `revalidatePath('/');` lines and
    BEFORE the `if (parsed.data.listOnDiscogs) { ... }` block, insert (mirrors the discogs soft-fail
    pattern + lesson #5 — isolate post-commit enqueue failures, never fail the committed ankauf):

    ```ts
      // Slice 3: match this arrived copy against open wishlists. Post-commit, soft-fail —
      // the purchase is already committed, so an enqueue error must NOT roll it back.
      try {
        await enqueueWishlistMatch({ tenantId: user.tenantId, purchaseId, recordId });
      } catch (err) {
        console.error('[ankauf] wishlist-match enqueue failed after purchase committed', err);
      }
    ```

14. **Run the ankauf-actions test, expecting PASS, and typecheck:**

    ```
    pnpm test tests/ankauf-actions.integration.test.ts && pnpm typecheck
    ```
    Expected: all ankauf-actions tests pass (including the new wishlist-match enqueue case); `tsc --noEmit`
    clean.

15. **Commit:**

    ```
    git add "src/app/(app)/ankauf/actions.ts" tests/ankauf-actions.integration.test.ts
    git commit -m "$(cat <<'EOF'
    feat(slice3): enqueue wishlist match post-commit in ankaufRecord

    After performAnkauf commits, ankaufRecord enqueues enqueueWishlistMatch on every
    successful ankauf (independent of listOnDiscogs), in its own try/catch soft-fail so
    a queue outage never rolls back the committed purchase (lesson #5). Test mock for
    @/lib/jobs extended in lockstep to avoid swallowed-TypeError drift.

    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
    EOF
    )"
    ```

---

#### Notes / lessons honored

- **Non-vacuous idempotency (lesson #3):** step 1 spies `findAndPersistWishlistMatches` calling THROUGH and
  asserts `[1, 0]` insert counts + a single DB row across two handler runs — it proves the unique
  `(wishlistId, purchaseId)` + `onConflictDoNothing` deduped, not that the handler short-circuited.
- **Post-commit enqueue isolation (lesson #5):** the ankauf enqueue is wrapped in its own try/catch and
  runs only AFTER `performAnkauf` resolves (commit), never inside the ankauf transaction.
- **Mock-baseline sync (Slice-2 lesson):** the `@/lib/jobs` mock in the existing ankauf-actions test is
  extended with `enqueueWishlistMatch` in the SAME task that adds the call site, so the modified action
  cannot silently throw a swallowed `TypeError` against a stale mock.
- **Env-less `QUEUE` import:** the payload type is imported `type`-only in both `worker/index.ts` and
  `jobs.ts`, so `import { QUEUE }` stays free of the `@/db → @/env` runtime chain (verified by the
  env-less `tests/worker.unit.test.ts` case).
- **Scope guard:** only `QUEUE.wishlistMatch` is added here. The second queue `wishlistNotify`,
  `enqueueWishlistNotification`, the notify handler, and `sendWishlistNotificationEmail` belong to T8.
- **FOR UPDATE / RLS:** matching is read-mostly + insert-with-unique-conflict inside T6's single
  `withTenant` tx; the FOR-UPDATE serialization posture applies to the notify handler (T8, C9.4), not the
  match handler.

### Task 8: Wishlist notify job + email template

**Refs:** spec §6.4, §5.5 · BUILD-CONTEXT T8 · CONTRACTS C9 (queue/enqueue/handler) + C10 (email template),
with C8 (`wishlists`/`wishlist_matches`/`records` shapes) and C2 (table columns).

Build the **staff-confirmed wishlist notification** path: a new pg-boss queue `tenant.wishlist.notify`, its
enqueue function, the worker handler that sends the customer e-mail and flips the match + wishlist to
`notified`, and the German e-mail template the handler renders. The notify flow is **idempotent** (only a
`pending` match is processed) and **race-free** (the match row is `SELECT … FOR UPDATE`-locked before the
status gate, mirroring the C5/C6 posture — C9.4 calls this out as the one place the slice previously lacked a
lock). Transient send failures **rethrow** so pg-boss retries; the status flip happens **only after** a
successful send.

This task DEPENDS on **Task 1** (the `wishlists`/`wishlist_matches` tables + `0007_slice3_rls.sql` RLS,
including the load-bearing `GRANT USAGE, SELECT ON SEQUENCE …` — the integration test's inserts fail without
it) and **Task 7** (which adds `QUEUE.wishlistMatch` + `enqueueWishlistMatch` to the SAME two files,
`src/worker/index.ts` and `src/lib/jobs.ts`). Apply T8's additions **alongside** T7's (anchor the new lines
after the existing `discogsListingCreate` / T7 `wishlistMatch` entries — do not remove anything). Do not start
until Task 1 and Task 7 are merged.

This task does **NOT** build the Benachrichtigen-Modal, the `notifyWishlistMatch` server action, or the
read-then-enqueue gate — those are T12 / T9. T8 stops at the queue boundary: enqueue function + handler +
template.

---

#### Files

- **Modify** `src/lib/email/index.ts` — add `sendWishlistNotificationEmail` (C10), alongside the existing
  `sendCredentialsEmail`.
- **Modify** `tests/email.test.ts` — add a `describe('sendWishlistNotificationEmail()')` block (unit, mocked
  adapter — mirrors the existing `sendCredentialsEmail` tests).
- **Create** `src/worker/jobs/wishlistNotify.ts` — `WishlistNotifyPayload` type + `handleWishlistNotify`
  handler (C9.2 + C9.4).
- **Create** `tests/worker/wishlistNotify.integration.test.ts` — Testcontainers: send-once + `pending →
  notified` (match) + `open → notified` (wishlist), idempotent on re-run (spy `.send`, assert called once
  across two invocations), missing-match no-op. (New `tests/worker/` directory; import the shared harness
  from `../helpers/db`.)
- **Modify** `src/worker/index.ts` — `QUEUE.wishlistNotify` + type-only payload import + `createQueue` +
  `work` registration in `startWorker()` (C9.1).
- **Modify** `src/lib/jobs.ts` — `enqueueWishlistNotification` (C9.3) + `createQueue(QUEUE.wishlistNotify)`
  in `getBoss()`.
- **Modify** `tests/worker.unit.test.ts` — add a `QUEUE.wishlistNotify` canonical-name assertion to the
  existing `describe('QUEUE constants')`.

No other files change.

---

#### Interfaces

**Consumes from earlier tasks / existing code (copy verbatim — do NOT redefine):**

```ts
// from @/db/tenant (existing)
export type TenantCtx = { tenantId: number; userId: number | null };
export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>;

// from @/db/schema (Task 1, contracts C1/C2) — reference only, already defined there:
//   wishlistMatches  = pgTable('wishlist_matches', { id, tenantId, wishlistId, purchaseId, recordId,
//                       status: wishlistMatchStatusEnum default 'pending', notifiedAt, createdAt }, …)
//   wishlists        = pgTable('wishlists', { id, tenantId, createdByUserId, customerName, customerEmail,
//                       artist, label, title, country, status: wishlistStatusEnum default 'open', createdAt }, …)
//   records          = pgTable('records', { id, tenantId, title, artist, label[], country, …, hash })
//   tenants          = pgTable('tenants', { id, slug, name, … })   // registry; qr_app has GRANT SELECT
//   export type WishlistMatchStatus = 'pending' | 'notified' | 'dismissed';
//   export type WishlistStatus      = 'open' | 'notified' | 'closed';

// from @/lib/email/index (existing)
export interface EmailAdapter { send(msg: EmailMessage): Promise<void>; }
export function getEmailAdapter(): EmailAdapter;

// from @/worker/index (existing QUEUE shape — T7 added wishlistMatch; T8 appends wishlistNotify)
export const QUEUE = { /* …, */ wishlistMatch: 'tenant.wishlist.match' } as const;

// from tests/helpers/db (existing harness)
export async function setupTestDatabase(): Promise<TestDatabase>;
export async function seedTenant(input: { slug: string; name: string }):
  Promise<{ tenantId: number; adminUserId: number }>;
```

**Produces for later tasks (CONTRACTS C9/C10 — these signatures are LOCKED, copy verbatim):**

```ts
// src/worker/jobs/wishlistNotify.ts
export type WishlistNotifyPayload = { tenantId: number; matchId: number };
export async function handleWishlistNotify(job: PgBoss.Job<WishlistNotifyPayload>): Promise<void>;

// src/lib/jobs.ts
export async function enqueueWishlistNotification(payload: WishlistNotifyPayload): Promise<void>;

// src/worker/index.ts
export const QUEUE = { /* … */ wishlistNotify: 'tenant.wishlist.notify' } as const;

// src/lib/email/index.ts
export async function sendWishlistNotificationEmail(
  adapter: EmailAdapter,
  args: {
    to: string;            // wishlist.customerEmail
    customerName: string;  // wishlist.customerName
    artist: string;        // record.artist
    title: string;         // record.title
    tenantName: string;    // tenants.name
    permalinkUrl?: string; // optional storefront link; omit in Slice 3 if none available
  },
): Promise<void>;
```

Locked semantics for the handler (C9.4), one `withTenant({ tenantId, userId: null })` tx:
1. `SELECT` the match row `.for('update')` **before** any status read (serializes concurrent/retried jobs).
2. match missing OR `match.status !== 'pending'` → **return** (idempotent no-op; the 2nd run sees `notified`).
3. load wishlist + record; read tenant name from `tenants` (qr_app has `GRANT SELECT`).
4. send via `getEmailAdapter().send` through `sendWishlistNotificationEmail(adapter, {...})`.
5. **only after a successful send**: `wishlist_matches.status='notified', notifiedAt=now()` AND
   `wishlists.status='notified'`. A thrown send rethrows → pg-boss retries; the flip is post-send, so a retry
   re-sends until success then is a no-op (accepted at-least-once residual).

---

#### Steps

**1. Write the failing email-template unit test.**

Append this block to `tests/email.test.ts`, inside the top-level `describe('email — unit', () => { … })`
(after the `sendCredentialsEmail()` block, before the Mailpit block). It captures the rendered message via a
mock adapter (the established pattern) and asserts real content + the conditional permalink line.

```ts
  // ── sendWishlistNotificationEmail content (Slice 3, C10) ──────────────────

  describe('sendWishlistNotificationEmail()', () => {
    const baseArgs = {
      to: 'kundin@example.com',
      customerName: 'Lena',
      artist: 'Miles Davis',
      title: 'Kind of Blue',
      tenantName: 'Q-Records',
    };

    it('subject contains artist and title', async () => {
      const { sendWishlistNotificationEmail } = await import('@/lib/email/index');
      const mockAdapter = { send: vi.fn().mockResolvedValue(undefined) };
      await sendWishlistNotificationEmail(mockAdapter, baseArgs);
      const msg = (mockAdapter.send.mock.calls[0] as [{ subject: string }])[0];
      expect(msg.subject).toContain('Miles Davis');
      expect(msg.subject).toContain('Kind of Blue');
    });

    it('text + html contain customerName, the artist–title line and tenantName', async () => {
      const { sendWishlistNotificationEmail } = await import('@/lib/email/index');
      const captured: { html: string; text: string }[] = [];
      const mockAdapter = {
        send: vi.fn(async (msg: { html: string; text: string }) => {
          captured.push({ html: msg.html, text: msg.text });
        }),
      };
      await sendWishlistNotificationEmail(mockAdapter, baseArgs);
      for (const part of [captured[0].text, captured[0].html]) {
        expect(part).toContain('Lena');
        expect(part).toContain('Miles Davis');
        expect(part).toContain('Kind of Blue');
        expect(part).toContain('Q-Records');
      }
    });

    it('sends to the customer address exactly once', async () => {
      const { sendWishlistNotificationEmail } = await import('@/lib/email/index');
      const mockAdapter = { send: vi.fn().mockResolvedValue(undefined) };
      await sendWishlistNotificationEmail(mockAdapter, baseArgs);
      expect(mockAdapter.send).toHaveBeenCalledOnce();
      expect(mockAdapter.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'kundin@example.com' }),
      );
    });

    it('renders the permalink line only when permalinkUrl is provided', async () => {
      const { sendWishlistNotificationEmail } = await import('@/lib/email/index');
      const withUrl = { send: vi.fn().mockResolvedValue(undefined) };
      await sendWishlistNotificationEmail(withUrl, {
        ...baseArgs,
        permalinkUrl: 'https://demo.localhost/r/abc',
      });
      const withMsg = (withUrl.send.mock.calls[0] as [{ html: string; text: string }])[0];
      expect(withMsg.text).toContain('https://demo.localhost/r/abc');
      expect(withMsg.html).toContain('https://demo.localhost/r/abc');

      const without = { send: vi.fn().mockResolvedValue(undefined) };
      await sendWishlistNotificationEmail(without, baseArgs);
      const withoutMsg = (without.send.mock.calls[0] as [{ html: string; text: string }])[0];
      expect(withoutMsg.text).not.toContain('Zum Schaufenster');
      expect(withoutMsg.html).not.toContain('Zum Schaufenster');
    });
  });
```

**2. Run the email test and confirm it FAILS.**

```bash
pnpm test tests/email.test.ts
```

Expected: the four new cases fail — `sendWishlistNotificationEmail` is not yet exported from
`@/lib/email/index` (TypeError: not a function). Red state. (The existing `sendCredentialsEmail` / driver
cases stay green.)

**3. Implement `sendWishlistNotificationEmail` (C10 copy verbatim).**

Append to `src/lib/email/index.ts` (after `sendCredentialsEmail`). German copy + the `sendCredentialsEmail`
inline-styled HTML shell (max-width 480, sans-serif, `#c84b31` link — raw hex is fine in email HTML); the
permalink line renders only when `permalinkUrl` is present.

```ts
export async function sendWishlistNotificationEmail(
  adapter: EmailAdapter,
  args: {
    to: string;
    customerName: string;
    artist: string;
    title: string;
    tenantName: string;
    permalinkUrl?: string;
  },
): Promise<void> {
  const { to, customerName, artist, title, tenantName, permalinkUrl } = args;

  const subject = `Dein Wunsch ist da: ${artist} – ${title}`;

  const text = [
    `Hallo ${customerName},`,
    '',
    `gute Nachrichten! Ein Titel von deiner Wunschliste ist bei ${tenantName} eingetroffen:`,
    '',
    `${artist} – ${title}`,
    '',
    'Komm gern vorbei oder melde dich, wenn du ihn reservieren möchtest.',
    ...(permalinkUrl ? [`Zum Schaufenster: ${permalinkUrl}`] : []),
    '',
    'Viele Grüße',
    tenantName,
  ].join('\n');

  const permalinkHtml = permalinkUrl
    ? `<p style="margin-bottom:16px">
    <a href="${permalinkUrl}" style="color:#c84b31">Zum Schaufenster: ${permalinkUrl}</a>
  </p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8" /><title>${subject}</title></head>
<body style="font-family:sans-serif;color:#111;max-width:480px;margin:0 auto;padding:24px">
  <h1 style="font-size:1.25rem;margin-bottom:8px">Hallo ${customerName},</h1>
  <p style="margin-bottom:16px">
    gute Nachrichten! Ein Titel von deiner Wunschliste ist bei ${tenantName} eingetroffen:
  </p>
  <p style="font-weight:bold;font-size:1.1rem;margin-bottom:16px">${artist} – ${title}</p>
  <p style="margin-bottom:16px">
    Komm gern vorbei oder melde dich, wenn du ihn reservieren möchtest.
  </p>
  ${permalinkHtml}
  <p style="font-size:0.875rem;color:#555">Viele Grüße<br />${tenantName}</p>
</body>
</html>`;

  await adapter.send({ to, subject, html, text });
}
```

**4. Run the email test and confirm it PASSES.**

```bash
pnpm test tests/email.test.ts
```

Expected: all email cases green (subject artist+title, text+html content, send-once-to-address, conditional
permalink present/absent).

**5. Commit the template.**

```bash
pnpm typecheck
git add src/lib/email/index.ts tests/email.test.ts
git commit -m "$(cat <<'EOF'
feat(slice3): wishlist notification email template (C10)

sendWishlistNotificationEmail renders the locked German copy
("Dein Wunsch ist da: <artist> – <title>") in text + the
sendCredentialsEmail inline-styled HTML shell. The "Zum Schaufenster"
permalink line is rendered only when permalinkUrl is supplied. Unit test
(mocked adapter) covers subject, body content, send-once-to-address, and
the conditional permalink.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**6. Write the failing notify-handler integration test.**

Create `tests/worker/wishlistNotify.integration.test.ts` with the complete content below. It boots one
Postgres container, seeds a tenant + record + purchase + open wishlist + **pending** match, then drives the
handler. The e-mail side effect is captured by overriding `getEmailAdapter` (via `vi.mock` +
`vi.hoisted`) to return a fake adapter whose `send` is a `vi.fn()` — while keeping
`sendWishlistNotificationEmail` REAL (so the template is exercised end-to-end). Idempotency is **non-vacuous**:
the handler is invoked twice and `send` must be called **exactly once** (the 2nd run hits the `notified` gate),
and the DB rows must read `notified`.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, seedTenant } from '../helpers/db';

// Override getEmailAdapter to a fake whose send is a spy; keep sendWishlistNotificationEmail REAL.
const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/index', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/email/index')>();
  return { ...actual, getEmailAdapter: () => ({ send: sendSpy }) };
});

let handle: (typeof import('@/worker/jobs/wishlistNotify'))['handleWishlistNotify'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;

let tenantId: number;
let adminUserId: number;
let recordId: number;
let purchaseId: number;
let wishlistId: number;
let matchId: number;

const ctx = () => ({ tenantId, userId: null });

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  process.env.MAIL_DRIVER = 'console';
  vi.resetModules();
  ({ handleWishlistNotify: handle } = await import('@/worker/jobs/wishlistNotify'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');

  ({ tenantId, adminUserId } = await seedTenant({ slug: 'wn', name: 'Wunsch Records' }));

  await withTenant(ctx(), async (tx) => {
    const [rec] = await tx
      .insert(schema.records)
      .values({
        tenantId,
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        hash: 'hash-wishlist-notify-1',
      })
      .returning({ id: schema.records.id });
    recordId = rec.id;

    const [p] = await tx
      .insert(schema.purchases)
      .values({ tenantId, recordId, targetPrice: '22.50' })
      .returning({ id: schema.purchases.id });
    purchaseId = p.id;

    const [wl] = await tx
      .insert(schema.wishlists)
      .values({
        tenantId,
        createdByUserId: adminUserId,
        customerName: 'Lena',
        customerEmail: 'lena@example.com',
        artist: 'Miles Davis',
        title: 'Kind of Blue',
      })
      .returning({ id: schema.wishlists.id });
    wishlistId = wl.id;

    const [m] = await tx
      .insert(schema.wishlistMatches)
      .values({ tenantId, wishlistId, purchaseId, recordId })
      .returning({ id: schema.wishlistMatches.id });
    matchId = m.id;
  });
});

afterAll(async () => {
  if (teardown) await teardown();
});

beforeEach(() => {
  sendSpy.mockClear();
});

const fakeJob = (data: { tenantId: number; matchId: number }) =>
  ({ id: 'j', name: 'tenant.wishlist.notify', data }) as unknown as Parameters<typeof handle>[0];

const readMatch = async (id: number) =>
  (
    await withTenant(ctx(), async (tx) =>
      tx
        .select({ status: schema.wishlistMatches.status, notifiedAt: schema.wishlistMatches.notifiedAt })
        .from(schema.wishlistMatches)
        .where(eq(schema.wishlistMatches.id, id)),
    )
  )[0];

const readWishlist = async (id: number) =>
  (
    await withTenant(ctx(), async (tx) =>
      tx
        .select({ status: schema.wishlists.status })
        .from(schema.wishlists)
        .where(eq(schema.wishlists.id, id)),
    )
  )[0];

describe('handleWishlistNotify (C9.4)', () => {
  it('sends the mail once and flips match + wishlist to notified', async () => {
    await handle(fakeJob({ tenantId, matchId }));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0]![0] as { to: string; subject: string };
    expect(sent.to).toBe('lena@example.com');
    expect(sent.subject).toContain('Miles Davis');
    expect(sent.subject).toContain('Kind of Blue');

    const match = await readMatch(matchId);
    expect(match.status).toBe('notified');
    expect(match.notifiedAt).not.toBeNull();
    const wl = await readWishlist(wishlistId);
    expect(wl.status).toBe('notified');
  });

  it('is idempotent on re-run: a second invocation sends NO further mail', async () => {
    // First invocation already flipped the match to 'notified' in the prior test; this run must short-circuit.
    await handle(fakeJob({ tenantId, matchId }));
    expect(sendSpy).not.toHaveBeenCalled();
    // State unchanged.
    expect((await readMatch(matchId)).status).toBe('notified');
    expect((await readWishlist(wishlistId)).status).toBe('notified');
  });

  it('is a no-op (no send, no throw) when the match does not exist', async () => {
    await expect(handle(fakeJob({ tenantId, matchId: 999_999 }))).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
```

**7. Run the integration test and confirm it FAILS.**

```bash
pnpm test tests/worker/wishlistNotify.integration.test.ts
```

Expected: failure — the import `@/worker/jobs/wishlistNotify` cannot be resolved (module does not exist), so
the suite errors before any assertion. Red state.

**8. Implement the handler (C9.2 + C9.4 verbatim).**

Create `src/worker/jobs/wishlistNotify.ts` with the complete content below. ONE `withTenant` tx; the match row
is locked `.for('update')` before the `pending` gate; statuses flip only after a successful send; a thrown
send propagates (pg-boss retries).

```ts
import type PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';
import { wishlistMatches, wishlists, records, tenants } from '@/db/schema';
import { getEmailAdapter, sendWishlistNotificationEmail } from '@/lib/email/index';

export type WishlistNotifyPayload = { tenantId: number; matchId: number };

/**
 * Worker handler for queue `tenant.wishlist.notify`.
 *
 * Staff-confirmed wishlist notification: sends the customer e-mail for a matched copy and marks the match +
 * wishlist `notified`. Idempotent — only a `pending` match is processed; a second run observes `notified` and
 * is a no-op (no duplicate mail).
 *
 * Race + error policy (C9.4):
 *   - The match row is SELECT … FOR UPDATE-locked BEFORE the status read, so concurrent/retried jobs serialize
 *     and the pending-gate is race-free.
 *   - A thrown send (SMTP/transient) RETHROWS → pg-boss retries; the status flip is AFTER a successful send, so
 *     a retry re-sends until success then is a no-op. Accepted residual: a crash after send but before the DB
 *     commit re-sends once on retry (at-least-once delivery).
 */
export async function handleWishlistNotify(job: PgBoss.Job<WishlistNotifyPayload>): Promise<void> {
  const { tenantId, matchId } = job.data;
  const ctx = { tenantId, userId: null };

  await withTenant(ctx, async (tx) => {
    // 1. Lock the match row first — serializes concurrent/retried jobs (race-free pending gate).
    const [match] = await tx
      .select({
        id: wishlistMatches.id,
        status: wishlistMatches.status,
        wishlistId: wishlistMatches.wishlistId,
        recordId: wishlistMatches.recordId,
      })
      .from(wishlistMatches)
      .where(eq(wishlistMatches.id, matchId))
      .for('update')
      .limit(1);

    // 2. Idempotent gate: missing or already-processed → no-op.
    if (!match || match.status !== 'pending') return;

    // 3. Load wishlist (customer) + record (display) + tenant name.
    const [wl] = await tx
      .select({
        customerName: wishlists.customerName,
        customerEmail: wishlists.customerEmail,
      })
      .from(wishlists)
      .where(eq(wishlists.id, match.wishlistId))
      .limit(1);
    if (!wl) return;

    const [rec] = await tx
      .select({ artist: records.artist, title: records.title })
      .from(records)
      .where(eq(records.id, match.recordId))
      .limit(1);
    if (!rec) return;

    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const tenantName = tenant?.name ?? '';

    // 4. Send — transient failures rethrow → pg-boss retry (status NOT yet flipped).
    await sendWishlistNotificationEmail(getEmailAdapter(), {
      to: wl.customerEmail,
      customerName: wl.customerName,
      artist: rec.artist,
      title: rec.title,
      tenantName,
    });

    // 5. Only AFTER a successful send: flip match + wishlist to notified.
    await tx
      .update(wishlistMatches)
      .set({ status: 'notified', notifiedAt: new Date() })
      .where(eq(wishlistMatches.id, matchId));
    await tx
      .update(wishlists)
      .set({ status: 'notified' })
      .where(eq(wishlists.id, match.wishlistId));
  });
}
```

**9. Run the integration test and confirm it PASSES.**

```bash
pnpm test tests/worker/wishlistNotify.integration.test.ts
```

Expected: all three cases green — send-once + match/wishlist → `notified` with `notifiedAt` set; re-run sends
no further mail (the `notified` gate short-circuits); missing match is a no-op. The send-once-across-two-runs
assertion is the non-vacuous idempotency guard (spies the real side effect, not a returned id).

**10. Commit the handler.**

```bash
pnpm typecheck
git add src/worker/jobs/wishlistNotify.ts tests/worker/wishlistNotify.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(slice3): wishlist notify worker handler (C9.4)

handleWishlistNotify locks the match row FOR UPDATE before the pending
gate (race-free / retry-safe), loads wishlist + record + tenant name,
sends the customer mail via sendWishlistNotificationEmail, then flips the
match (notified + notifiedAt) and wishlist (notified) ONLY after a
successful send. A thrown send rethrows for pg-boss retry. Integration
test (Testcontainers) proves send-once, status flips, non-vacuous
idempotency on re-run (spy .send, asserted once across two invocations),
and missing-match no-op.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**11. Write the failing QUEUE-constant assertion.**

Add this `it` to `tests/worker.unit.test.ts`, inside the existing `describe('QUEUE constants', () => { … })`
(after the `discogsListingCreate` case):

```ts
  it('wishlistNotify equals the canonical queue name (env-less import)', async () => {
    const { QUEUE } = await import('@/worker/index');
    expect(QUEUE.wishlistNotify).toBe('tenant.wishlist.notify');
  });
```

**12. Run the worker-unit test and confirm it FAILS.**

```bash
pnpm test tests/worker.unit.test.ts
```

Expected: the new case fails — `QUEUE.wishlistNotify` is `undefined`, so `.toBe('tenant.wishlist.notify')`
fails. Red state. (The existing QUEUE / `handleAnalyticsSummaryRefresh` cases stay green.)

**13. Wire the queue, worker registration, and enqueue function.**

**13a.** In `src/worker/index.ts`, add the type-only payload import near the existing job-type imports (keeps
`import { QUEUE }` env-less):

```ts
import type { WishlistNotifyPayload } from './jobs/wishlistNotify';
```

Add the queue name to the `QUEUE` `as const` object (after `wishlistMatch` from T7, or after
`discogsListingCreate` if T7 is not yet merged):

```ts
  wishlistNotify: 'tenant.wishlist.notify',
```

Inside `startWorker()`, after the lazy handler imports add:

```ts
  const { handleWishlistNotify } = await import('./jobs/wishlistNotify');
```

and after the existing queue registrations add the create + work block:

```ts
  await boss.createQueue(QUEUE.wishlistNotify);
  console.log(`[worker] Queue created/verified: ${QUEUE.wishlistNotify}`);

  await boss.work<WishlistNotifyPayload>(
    QUEUE.wishlistNotify,
    async (jobs: PgBoss.Job<WishlistNotifyPayload>[]) => {
      for (const job of jobs) {
        await handleWishlistNotify(job);
      }
    },
  );
  console.log(`[worker] Handler registered for queue: ${QUEUE.wishlistNotify}`);
```

**13b.** In `src/lib/jobs.ts`, add the type-only payload import at the top:

```ts
import type { WishlistNotifyPayload } from '@/worker/jobs/wishlistNotify';
```

In `getBoss()`, alongside the existing `createQueue` call(s), add:

```ts
      await boss.createQueue(QUEUE.wishlistNotify);
```

And add the enqueue function (C9.3 verbatim):

```ts
export async function enqueueWishlistNotification(payload: WishlistNotifyPayload): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE.wishlistNotify, payload, {
    retryLimit: 5,
    retryBackoff: true,
  });
}
```

**14. Run the worker-unit test (and typecheck) and confirm GREEN.**

```bash
pnpm test tests/worker.unit.test.ts
pnpm typecheck
```

Expected: the `wishlistNotify` canonical-name case passes; typecheck is clean (the type-only payload imports in
`worker/index.ts` and `jobs.ts` resolve against the handler file from step 8, and `enqueueWishlistNotification`
matches `WishlistNotifyPayload`).

**15. Commit the wiring.**

```bash
git add src/worker/index.ts src/lib/jobs.ts tests/worker.unit.test.ts
git commit -m "$(cat <<'EOF'
feat(slice3): register wishlist.notify queue + enqueue (C9.1/C9.3)

Adds QUEUE.wishlistNotify='tenant.wishlist.notify', the createQueue +
work registration in startWorker (type-only payload import keeps
`import { QUEUE }` env-less), getBoss createQueue, and
enqueueWishlistNotification({ tenantId, matchId }) with the standard
{ retryLimit: 5, retryBackoff: true }. worker.unit asserts the canonical
queue name.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

#### Done when

- `pnpm test tests/email.test.ts` green (incl. the 4 new `sendWishlistNotificationEmail` cases).
- `pnpm test tests/worker/wishlistNotify.integration.test.ts` green (3 cases: send-once + flips, idempotent
  re-run sends nothing, missing-match no-op).
- `pnpm test tests/worker.unit.test.ts` green (incl. the `wishlistNotify` canonical-name case).
- `pnpm typecheck` passes.
- New surface exactly matches the contracts: `sendWishlistNotificationEmail` (C10),
  `WishlistNotifyPayload` + `handleWishlistNotify` (C9.2/C9.4), `enqueueWishlistNotification` (C9.3),
  `QUEUE.wishlistNotify='tenant.wishlist.notify'` (C9.1). No notify action / modal here (T9 / T12).
- Lessons honored: non-vacuous idempotency (spy `.send`, assert once across two runs — not a returned id);
  match `SELECT … FOR UPDATE` before the status gate (C9.4 race-free); status flip strictly post-send
  (transient failures rethrow for retry); type-only payload imports keep `import { QUEUE }` env-less.

### Task 9: Server actions (sale/reserve/quick/wishlist/notify/dismiss)

Wire the Slice-3 services to the UI through `'use server'` actions. Extract the CSRF helper into a shared
module, then build the Kasse and Wunschlisten action files. Every mutating action runs the locked prologue
(`requireSession` → staff gate (`kunde → forbidden()`) → `isValidOrigin` CSRF) and maps service errors to the
locked `{ ok:false, reason }` shape. Notify is read-then-enqueue (only `pending` enqueues; idempotent).

This task is integration-tested against Testcontainers using the REAL services (`performSale`, `reserveCopy`,
`quickItems`, `wishlist`) so the assertions are non-vacuous (status flips + rows written are verified through
`ownerPool`); only `requireSession`, `next/headers`, `next/navigation`, `next/cache`, and (for wunschlisten)
`@/lib/jobs.enqueueWishlistNotification` are mocked.

#### Files

- **Create** `src/lib/csrf.ts` — shared `isValidOrigin()` (extracted verbatim from ankauf actions; C11).
- **Modify** `src/app/(app)/ankauf/actions.ts` — import shared `isValidOrigin`; drop the local copy + the now-unused `headers`/`env` imports.
- **Create** `src/app/(app)/kasse/actions.ts` — `createSale`, `reserve`, `cancelReservation`, `createQuickItem`, `updateQuickItem`, `deactivateQuickItem` (C11; services aliased `…Svc`).
- **Create** `src/app/(app)/wunschlisten/actions.ts` — `createWishlist`, `notifyWishlistMatch`, `dismissMatch` (C11; notify = read-then-enqueue only when `pending`).
- **Test** `tests/app/kasse-actions.integration.test.ts` — role gate (kunde → forbidden), CSRF, validation, inventory sale happy path (status→verkauft + rows), double-sell conflict, reserve↔storno, quick-item CRUD.
- **Test** `tests/app/wunschlisten-actions.integration.test.ts` — role gate, validation, create happy path, notify not_found, notify-pending-enqueues-once, notify-already-notified-no-enqueue (non-vacuous idempotency), dismiss.

#### Interfaces

**Consumes from earlier tasks (copy these signatures verbatim — do NOT redefine):**

```ts
// @/auth/session (Slice 0)
export async function requireSession(): Promise<SessionUser>;
// SessionUser = { id: number; email: string; tenantId: number; role: Role; isSuperadmin: boolean }

// @/env (Slice 0)
env.APP_PROTOCOL // 'http' | 'https'

// @/lib/sales (T2, C4)
export type CartLineInput =
  | { kind: 'inventory'; purchaseId: number }
  | { kind: 'quick'; quickItemId: number; quantity: number }
  | { kind: 'adhoc'; label: string; unitPrice: string; quantity: number };
export type DiscountInput = { kind: 'amount'; value: string } | { kind: 'percent'; value: number };
export type CartInput = {
  lines: CartLineInput[];
  payment: PaymentMethod;
  discount: DiscountInput | null;
  voucherCode?: string | null;
};

// @/lib/performSale (T3, C5)
export type PerformSaleResult = { transactionId: number; total: string };
export class SaleConflictError extends Error { constructor(purchaseId: number, status: string | null); }
export class SalePriceMissingError extends Error { constructor(purchaseId: number); }
export async function performSale(ctx: TenantCtx, input: PerformSaleInput): Promise<PerformSaleResult>;

// @/lib/reservation (T4, C6)
export class ReservationConflictError extends Error { constructor(purchaseId: number, status: string | null); }
export async function reserveCopy(ctx: TenantCtx, purchaseId: number): Promise<void>;
export async function cancelReservation(ctx: TenantCtx, purchaseId: number): Promise<void>;

// @/lib/quickItems (T5, C7)
export async function createQuickItem(ctx: TenantCtx, input: { name: string; price: string }): Promise<{ id: number }>;
export async function updateQuickItem(ctx: TenantCtx, id: number, input: { name?: string; price?: string; active?: boolean }): Promise<void>;
export async function deactivateQuickItem(ctx: TenantCtx, id: number): Promise<void>;

// @/lib/wishlist (T6, C8)
export type CreateWishlistInput = {
  customerName: string; customerEmail: string; artist: string;
  label?: string | null; title?: string | null; country?: string | null;
};
export async function createWishlist(ctx: TenantCtx, input: CreateWishlistInput): Promise<{ id: number }>;

// @/lib/jobs (T8, C9.3)
export async function enqueueWishlistNotification(payload: { tenantId: number; matchId: number }): Promise<void>;

// @/db/tenant (Slice 0)
export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>;
// TenantCtx = { tenantId: number; userId: number | null }

// @/db/schema (T1, C2)
export const wishlistMatches: PgTable; // .id, .status ('pending'|'notified'|'dismissed'), .tenantId, …
```

**Produces for later tasks (exact signatures, locked by C11):**

```ts
// @/lib/csrf  (consumed by ankauf, kasse, wunschlisten actions)
export async function isValidOrigin(): Promise<boolean>;

// src/app/(app)/kasse/actions.ts  (consumed by T10 KasseScreen, T11 SellModal)
export async function createSale(input: CartInput):
  Promise<{ ok: true; transactionId: number; total: string }
         | { ok: false; reason: 'validation' | 'conflict' | 'error'; message?: string }>;
export async function reserve(input: { purchaseId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }>;
export async function cancelReservation(input: { purchaseId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }>;
export async function createQuickItem(input: { name: string; price: string }):
  Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }>;
export async function updateQuickItem(input: { id: number; name?: string; price?: string; active?: boolean }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'error'; message?: string }>;
export async function deactivateQuickItem(input: { id: number }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'error'; message?: string }>;

// src/app/(app)/wunschlisten/actions.ts  (consumed by T12 WishlistForm, MatchesSection, NotifyModal)
export async function createWishlist(input: CreateWishlistInput):
  Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }>;
export async function notifyWishlistMatch(input: { matchId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }>;
export async function dismissMatch(input: { matchId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }>;
```

---

#### Step 1 — Write the failing Kasse-actions integration test

Create `tests/app/kasse-actions.integration.test.ts` with the COMPLETE content below. It seeds inventory copies
via `withOwner` (qr_owner, BYPASSRLS), drives the real services through the actions, and verifies side effects
through `ownerPool`. `requireSession`/`next/headers`/`next/navigation`/`next/cache` are mocked; the services are
NOT mocked.

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let actions: typeof import('@/app/(app)/kasse/actions');
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let records: (typeof import('@/db/schema'))['records'];
let purchases: (typeof import('@/db/schema'))['purchases'];

let teardown: (() => Promise<void>) | undefined;
let tenantA = 0;
let adminUserId = 0;
let sessionRole: 'admin' | 'kunde' = 'admin';
let badOrigin = false;

async function insertCopy(
  opts: { status?: 'verfuegbar' | 'reserviert' | 'verkauft'; vk?: string } = {},
): Promise<number> {
  return withOwner(async (tx) => {
    const [rec] = await tx
      .insert(records)
      .values({
        tenantId: tenantA,
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        label: ['Columbia'],
        format: 'Vinyl',
        genre: ['Jazz'],
        releaseYear: 1959,
        country: 'US',
        hash: `h-${Math.random().toString(36).slice(2)}`,
      })
      .returning({ id: records.id });
    const [pur] = await tx
      .insert(purchases)
      .values({
        tenantId: tenantA,
        recordId: rec.id,
        status: opts.status ?? 'verfuegbar',
        conditionRecord: 7,
        conditionCover: 7,
        purchasePrice: '10.00',
        targetPrice: opts.vk ?? '20.00',
      })
      .returning({ id: purchases.id });
    return pur.id;
  });
}

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;

  vi.doMock('@/auth/session', () => ({
    requireSession: async () => ({
      id: adminUserId,
      email: 'staff@demo',
      tenantId: tenantA,
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
  vi.resetModules();

  // Seed AFTER resetModules so seedTenant's ownerPool binds to the same @/db/client the teardown closes.
  const seed = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantA = seed.tenantId;
  adminUserId = seed.adminUserId;
  ({ withOwner } = await import('@/db/tenant'));
  ({ records, purchases } = await import('@/db/schema'));
  actions = await import('@/app/(app)/kasse/actions');
});

afterAll(async () => {
  if (teardown) await teardown();
});

afterEach(() => {
  sessionRole = 'admin';
  badOrigin = false;
});

describe('kasse actions', () => {
  it('createSale: kunde role is forbidden', async () => {
    sessionRole = 'kunde';
    const pid = await insertCopy();
    await expect(
      actions.createSale({
        lines: [{ kind: 'inventory', purchaseId: pid }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('createSale: invalid origin → reason error', async () => {
    badOrigin = true;
    const pid = await insertCopy();
    const r = await actions.createSale({
      lines: [{ kind: 'inventory', purchaseId: pid }],
      payment: 'bar',
      discount: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'error' });
  });

  it('createSale: empty cart → reason validation', async () => {
    const r = await actions.createSale({ lines: [], payment: 'bar', discount: null });
    expect(r).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('createSale: inventory copy → ok, status verkauft, transaction + item rows written', async () => {
    const pid = await insertCopy({ vk: '20.00' });
    const r = await actions.createSale({
      lines: [{ kind: 'inventory', purchaseId: pid }],
      payment: 'bar',
      discount: null,
    });
    expect(r).toMatchObject({ ok: true, total: '20.00' });
    if (!r.ok) throw new Error('expected ok');
    const { ownerPool } = await import('@/db/client');
    const status = await ownerPool.query('SELECT status FROM purchases WHERE id = $1', [pid]);
    expect(status.rows[0].status).toBe('verkauft');
    const items = await ownerPool.query(
      'SELECT purchase_id, unit_price FROM transaction_items WHERE transaction_id = $1',
      [r.transactionId],
    );
    expect(items.rows).toHaveLength(1);
    expect(items.rows[0].purchase_id).toBe(pid);
    expect(items.rows[0].unit_price).toBe('20.00');
  });

  it('createSale: already-sold copy → reason conflict (no double-sell)', async () => {
    const pid = await insertCopy({ status: 'verkauft' });
    const r = await actions.createSale({
      lines: [{ kind: 'inventory', purchaseId: pid }],
      payment: 'bar',
      discount: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('reserve then cancelReservation flips status verfuegbar↔reserviert', async () => {
    const pid = await insertCopy();
    const { ownerPool } = await import('@/db/client');
    const r1 = await actions.reserve({ purchaseId: pid });
    expect(r1).toEqual({ ok: true });
    let s = await ownerPool.query('SELECT status FROM purchases WHERE id = $1', [pid]);
    expect(s.rows[0].status).toBe('reserviert');
    const r2 = await actions.cancelReservation({ purchaseId: pid });
    expect(r2).toEqual({ ok: true });
    s = await ownerPool.query('SELECT status FROM purchases WHERE id = $1', [pid]);
    expect(s.rows[0].status).toBe('verfuegbar');
  });

  it('quick-item CRUD: create → update → deactivate', async () => {
    const { ownerPool } = await import('@/db/client');
    const created = await actions.createQuickItem({ name: 'Kaffee', price: '2.50' });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('expected ok');
    let q = await ownerPool.query('SELECT name, price, active FROM quick_items WHERE id = $1', [created.id]);
    expect(q.rows[0]).toMatchObject({ name: 'Kaffee', price: '2.50', active: true });
    const upd = await actions.updateQuickItem({ id: created.id, price: '3.00' });
    expect(upd).toEqual({ ok: true });
    q = await ownerPool.query('SELECT price FROM quick_items WHERE id = $1', [created.id]);
    expect(q.rows[0].price).toBe('3.00');
    const deact = await actions.deactivateQuickItem({ id: created.id });
    expect(deact).toEqual({ ok: true });
    q = await ownerPool.query('SELECT active FROM quick_items WHERE id = $1', [created.id]);
    expect(q.rows[0].active).toBe(false);
  });
});
```

#### Step 2 — Run the Kasse test, expect FAIL

```bash
pnpm test tests/app/kasse-actions.integration.test.ts
```

Expected: FAIL — `beforeAll` cannot resolve `@/app/(app)/kasse/actions` (the module does not exist yet):
`Error: Failed to load url @/app/(app)/kasse/actions` / `Cannot find module`. All `kasse actions` specs error.

#### Step 3 — Create the shared CSRF helper

Create `src/lib/csrf.ts` with the EXACT extracted body (C11 — "identical body"):

```ts
import 'server-only';
import { headers } from 'next/headers';
import { env } from '@/env';

/** Reject cross-site form posts to a mutating server action (shared by ankauf/kasse/wunschlisten). */
export async function isValidOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('host');
  if (origin && host && origin !== `${env.APP_PROTOCOL}://${host}`) {
    return false;
  }
  return true;
}
```

#### Step 4 — Refactor `ankauf/actions.ts` to use the shared helper

In `src/app/(app)/ankauf/actions.ts`: delete the local `isValidOrigin` function (the `async function isValidOrigin()`
block) and its two now-unused imports, and import the shared helper instead. The resulting import header is:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import { deleteConnection, getConnection } from '@/lib/discogs-connection';
import { getDiscogsAdapter } from '@/lib/discogs';
import { DiscogsAuthError } from '@/lib/discogs/types';
import type { DiscogsSearchResult, DiscogsPriceSuggestion } from '@/lib/discogs/types';
import { performAnkauf, type AnkaufInput } from '@/lib/ankauf';
import { enqueueDiscogsListing } from '@/lib/jobs';

export type SearchResultDTO = DiscogsSearchResult;
```

(Removed: `import { headers } from 'next/headers';`, `import { env } from '@/env';`, and the local
`isValidOrigin` function. The `decimalString` const at line ~71 stays — note it is duplicated independently in the
kasse action file per C11; this is intentional, the validators are co-located with the schemas that use them. All
call sites `await isValidOrigin()` keep working unchanged.)

#### Step 5 — Create the Kasse server actions

Create `src/app/(app)/kasse/actions.ts` with the COMPLETE content below. Schemas are copied verbatim from C11;
services are imported with the `…Svc` alias (C7/C11) to avoid same-name clashes with the actions.

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import type { CartInput } from '@/lib/sales';
import { performSale, SaleConflictError, SalePriceMissingError } from '@/lib/performSale';
import {
  reserveCopy,
  cancelReservation as cancelReservationSvc,
  ReservationConflictError,
} from '@/lib/reservation';
import {
  createQuickItem as createQuickItemSvc,
  updateQuickItem as updateQuickItemSvc,
  deactivateQuickItem as deactivateQuickItemSvc,
} from '@/lib/quickItems';

const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);

const cartLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inventory'), purchaseId: z.number().int().positive() }),
  z.object({
    kind: z.literal('quick'),
    quickItemId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(999),
  }),
  z.object({
    kind: z.literal('adhoc'),
    label: z.string().min(1).max(200),
    unitPrice: decimalString,
    quantity: z.number().int().min(1).max(999),
  }),
]);

const discountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount'), value: decimalString }),
  z.object({ kind: z.literal('percent'), value: z.number().min(0).max(100) }),
]);

const createSaleSchema = z
  .object({
    lines: z.array(cartLineSchema).min(1),
    payment: z.enum(['bar', 'karte', 'paypal', 'gutschein']),
    discount: discountSchema.nullable(),
    voucherCode: z.string().max(64).nullable().optional(),
  })
  .refine((d) => (d.payment === 'gutschein' ? !!d.voucherCode?.trim() : true), {
    message: 'voucherCode required when payment=gutschein',
    path: ['voucherCode'],
  })
  .refine(
    (d) => {
      const ids = d.lines.flatMap((l) => (l.kind === 'inventory' ? [l.purchaseId] : []));
      return new Set(ids).size === ids.length;
    },
    { message: 'duplicate inventory purchaseId in cart', path: ['lines'] },
  );

const purchaseIdSchema = z.object({ purchaseId: z.number().int().positive() });

const createQuickItemSchema = z.object({ name: z.string().trim().min(1).max(120), price: decimalString });
const updateQuickItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  price: decimalString.optional(),
  active: z.boolean().optional(),
});
const deactivateQuickItemSchema = z.object({ id: z.number().int().positive() });

export async function createSale(
  input: CartInput,
): Promise<
  | { ok: true; transactionId: number; total: string }
  | { ok: false; reason: 'validation' | 'conflict' | 'error'; message?: string }
> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }

  const parsed = createSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }

  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { transactionId, total } = await performSale(ctx, parsed.data);
    revalidatePath('/inventar');
    revalidatePath('/');
    revalidatePath('/kasse');
    return { ok: true, transactionId, total };
  } catch (err) {
    if (err instanceof SaleConflictError || err instanceof SalePriceMissingError) {
      return { ok: false, reason: 'conflict', message: err.message };
    }
    return { ok: false, reason: 'error' };
  }
}

export async function reserve(
  input: { purchaseId: number },
): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = purchaseIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    await reserveCopy(ctx, parsed.data.purchaseId);
    revalidatePath('/inventar');
    return { ok: true };
  } catch (err) {
    if (err instanceof ReservationConflictError) {
      return { ok: false, reason: 'conflict', message: err.message };
    }
    return { ok: false, reason: 'error' };
  }
}

export async function cancelReservation(
  input: { purchaseId: number },
): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = purchaseIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    await cancelReservationSvc(ctx, parsed.data.purchaseId);
    revalidatePath('/inventar');
    return { ok: true };
  } catch (err) {
    if (err instanceof ReservationConflictError) {
      return { ok: false, reason: 'conflict', message: err.message };
    }
    return { ok: false, reason: 'error' };
  }
}

export async function createQuickItem(
  input: { name: string; price: string },
): Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = createQuickItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { id } = await createQuickItemSvc(ctx, parsed.data);
    revalidatePath('/kasse');
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function updateQuickItem(
  input: { id: number; name?: string; price?: string; active?: boolean },
): Promise<{ ok: true } | { ok: false; reason: 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = updateQuickItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const { id, ...patch } = parsed.data;
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    await updateQuickItemSvc(ctx, id, patch);
    revalidatePath('/kasse');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function deactivateQuickItem(
  input: { id: number },
): Promise<{ ok: true } | { ok: false; reason: 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = deactivateQuickItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    await deactivateQuickItemSvc(ctx, parsed.data.id);
    revalidatePath('/kasse');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
```

#### Step 6 — Typecheck + run the Kasse test (and ankauf regression), expect PASS

```bash
pnpm typecheck && pnpm test tests/app/kasse-actions.integration.test.ts tests/ankauf-actions.integration.test.ts
```

Expected: PASS — all 7 `kasse actions` specs green (sale flips status→verkauft + writes a single
`transaction_items` row with `purchase_id`/`unit_price = 20.00`; double-sell returns `conflict`; reserve↔storno
verified; quick CRUD verified), AND the existing `ankauf actions` suite stays green (the CSRF refactor is
behaviour-preserving — empty mocked headers still pass `isValidOrigin`).

#### Step 7 — Commit

```bash
git add src/lib/csrf.ts src/app/\(app\)/ankauf/actions.ts src/app/\(app\)/kasse/actions.ts tests/app/kasse-actions.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(slice3): shared CSRF helper + kasse server actions (createSale/reserve/quick-CRUD)

Extract isValidOrigin into src/lib/csrf.ts (reused by ankauf, kasse, wunschlisten).
Add kasse actions with the locked staff prologue (requireSession → kunde→forbidden →
isValidOrigin), createSaleSchema (incl. gutschein-voucher + duplicate-inventory refines),
and error mapping (SaleConflictError/SalePriceMissingError → conflict). Integration-tested
against Testcontainers with the real performSale/reservation/quickItems services.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

#### Step 8 — Write the failing Wunschlisten-actions integration test

Create `tests/app/wunschlisten-actions.integration.test.ts` with the COMPLETE content below. It mocks ONLY
`enqueueWishlistNotification` (a `vi.fn` spy — no real pg-boss) plus session/headers/navigation/cache; the
`createWishlist` service and the match read/update run against the real DB. The notify idempotency assertions are
NON-VACUOUS: the spy's call count is the side effect under test.

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';

const notifySpy = vi.fn(async () => undefined);
vi.mock('@/lib/jobs', () => ({ enqueueWishlistNotification: notifySpy }));

let actions: typeof import('@/app/(app)/wunschlisten/actions');
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let records: (typeof import('@/db/schema'))['records'];
let purchases: (typeof import('@/db/schema'))['purchases'];
let wishlists: (typeof import('@/db/schema'))['wishlists'];
let wishlistMatches: (typeof import('@/db/schema'))['wishlistMatches'];

let teardown: (() => Promise<void>) | undefined;
let tenantA = 0;
let adminUserId = 0;
let sessionRole: 'admin' | 'kunde' = 'admin';

async function insertMatch(status: 'pending' | 'notified' | 'dismissed'): Promise<number> {
  return withOwner(async (tx) => {
    const [rec] = await tx
      .insert(records)
      .values({
        tenantId: tenantA,
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        label: ['Columbia'],
        format: 'Vinyl',
        genre: ['Jazz'],
        releaseYear: 1959,
        country: 'US',
        hash: `h-${Math.random().toString(36).slice(2)}`,
      })
      .returning({ id: records.id });
    const [pur] = await tx
      .insert(purchases)
      .values({
        tenantId: tenantA,
        recordId: rec.id,
        status: 'verfuegbar',
        conditionRecord: 7,
        conditionCover: 7,
        purchasePrice: '10.00',
        targetPrice: '20.00',
      })
      .returning({ id: purchases.id });
    const [wl] = await tx
      .insert(wishlists)
      .values({
        tenantId: tenantA,
        createdByUserId: adminUserId,
        customerName: 'Max Mustermann',
        customerEmail: 'max@example.com',
        artist: 'Miles Davis',
        status: 'open',
      })
      .returning({ id: wishlists.id });
    const [m] = await tx
      .insert(wishlistMatches)
      .values({
        tenantId: tenantA,
        wishlistId: wl.id,
        purchaseId: pur.id,
        recordId: rec.id,
        status,
      })
      .returning({ id: wishlistMatches.id });
    return m.id;
  });
}

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;

  vi.doMock('@/auth/session', () => ({
    requireSession: async () => ({
      id: adminUserId,
      email: 'staff@demo',
      tenantId: tenantA,
      role: sessionRole,
      isSuperadmin: false,
    }),
  }));
  vi.doMock('next/headers', () => ({
    headers: async () => new Headers(),
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
  vi.resetModules();

  const seed = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantA = seed.tenantId;
  adminUserId = seed.adminUserId;
  ({ withOwner } = await import('@/db/tenant'));
  ({ records, purchases, wishlists, wishlistMatches } = await import('@/db/schema'));
  actions = await import('@/app/(app)/wunschlisten/actions');
});

afterAll(async () => {
  if (teardown) await teardown();
});

afterEach(() => {
  sessionRole = 'admin';
  notifySpy.mockClear();
});

describe('wunschlisten actions', () => {
  it('createWishlist: kunde role is forbidden', async () => {
    sessionRole = 'kunde';
    await expect(
      actions.createWishlist({ customerName: 'Max', customerEmail: 'max@example.com', artist: 'Miles Davis' }),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('createWishlist: invalid email → reason validation', async () => {
    const r = await actions.createWishlist({ customerName: 'Max', customerEmail: 'not-an-email', artist: 'X' });
    expect(r).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('createWishlist: happy path → ok + row persisted', async () => {
    const r = await actions.createWishlist({
      customerName: 'Erika',
      customerEmail: 'erika@example.com',
      artist: 'Kraftwerk',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    const { ownerPool } = await import('@/db/client');
    const w = await ownerPool.query('SELECT customer_name, artist, status FROM wishlists WHERE id = $1', [r.id]);
    expect(w.rows[0]).toMatchObject({ customer_name: 'Erika', artist: 'Kraftwerk', status: 'open' });
  });

  it('notifyWishlistMatch: unknown id → reason not_found, no enqueue', async () => {
    const r = await actions.notifyWishlistMatch({ matchId: 999999 });
    expect(r).toMatchObject({ ok: false, reason: 'not_found' });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('notifyWishlistMatch: pending match → ok + enqueues exactly once', async () => {
    const matchId = await insertMatch('pending');
    const r = await actions.notifyWishlistMatch({ matchId });
    expect(r).toEqual({ ok: true });
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith({ tenantId: tenantA, matchId });
  });

  it('notifyWishlistMatch: already-notified match → ok WITHOUT enqueue (idempotent)', async () => {
    const matchId = await insertMatch('notified');
    const r = await actions.notifyWishlistMatch({ matchId });
    expect(r).toEqual({ ok: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('dismissMatch: pending → ok + status dismissed; unknown → not_found', async () => {
    const matchId = await insertMatch('pending');
    const r = await actions.dismissMatch({ matchId });
    expect(r).toEqual({ ok: true });
    const { ownerPool } = await import('@/db/client');
    const m = await ownerPool.query('SELECT status FROM wishlist_matches WHERE id = $1', [matchId]);
    expect(m.rows[0].status).toBe('dismissed');
    const r2 = await actions.dismissMatch({ matchId: 999999 });
    expect(r2).toMatchObject({ ok: false, reason: 'not_found' });
  });
});
```

#### Step 9 — Run the Wunschlisten test, expect FAIL

```bash
pnpm test tests/app/wunschlisten-actions.integration.test.ts
```

Expected: FAIL — `beforeAll` cannot resolve `@/app/(app)/wunschlisten/actions`
(`Cannot find module` / `Failed to load url`). All `wunschlisten actions` specs error.

#### Step 10 — Create the Wunschlisten server actions

Create `src/app/(app)/wunschlisten/actions.ts` with the COMPLETE content below. `createWishlistSchema` /
`matchIdSchema` copied verbatim from C11; the service is aliased `createWishlistSvc`; notify is read-then-enqueue
(only `pending` enqueues), dismiss is a tenant-scoped UPDATE…RETURNING (0 rows → `not_found`).

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import { withTenant } from '@/db/tenant';
import { wishlistMatches } from '@/db/schema';
import { createWishlist as createWishlistSvc, type CreateWishlistInput } from '@/lib/wishlist';
import { enqueueWishlistNotification } from '@/lib/jobs';

const createWishlistSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().max(320),
  artist: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200).nullish(),
  title: z.string().trim().max(200).nullish(),
  country: z.string().trim().max(120).nullish(),
});

const matchIdSchema = z.object({ matchId: z.number().int().positive() });

export async function createWishlist(
  input: CreateWishlistInput,
): Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = createWishlistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { id } = await createWishlistSvc(ctx, parsed.data);
    revalidatePath('/wunschlisten');
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function notifyWishlistMatch(
  input: { matchId: number },
): Promise<
  { ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }
> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };

  // Read-then-enqueue (C11): load the match (RLS scopes to tenant) BEFORE enqueuing.
  let status: string | null;
  try {
    status = await withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ status: wishlistMatches.status })
        .from(wishlistMatches)
        .where(eq(wishlistMatches.id, parsed.data.matchId));
      return row ? row.status : null;
    });
  } catch {
    return { ok: false, reason: 'error' };
  }

  if (status === null) return { ok: false, reason: 'not_found' };
  // Idempotent: only a 'pending' match enqueues. A double-click on an already notified/dismissed match is a
  // successful no-op (no redundant job stacked); the worker is also race-guarded (C9.4 SELECT … FOR UPDATE).
  if (status !== 'pending') {
    revalidatePath('/wunschlisten');
    return { ok: true };
  }

  try {
    await enqueueWishlistNotification({ tenantId: user.tenantId, matchId: parsed.data.matchId });
  } catch (err) {
    // soft-fail post-enqueue log (no DB state was mutated): surface as a structured error so the UI can retry.
    console.error('[wunschlisten] notify enqueue failed', err);
    return { ok: false, reason: 'error', message: 'Benachrichtigung konnte nicht eingereiht werden.' };
  }
  revalidatePath('/wunschlisten');
  return { ok: true };
}

export async function dismissMatch(
  input: { matchId: number },
): Promise<
  { ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }
> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  let updated = 0;
  try {
    updated = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .update(wishlistMatches)
        .set({ status: 'dismissed' })
        .where(eq(wishlistMatches.id, parsed.data.matchId))
        .returning({ id: wishlistMatches.id });
      return rows.length;
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  // RLS scopes the UPDATE to the tenant — 0 rows means missing OR cross-tenant; both → not_found.
  if (updated === 0) return { ok: false, reason: 'not_found' };
  revalidatePath('/wunschlisten');
  return { ok: true };
}
```

#### Step 11 — Typecheck + run the Wunschlisten test, expect PASS

```bash
pnpm typecheck && pnpm test tests/app/wunschlisten-actions.integration.test.ts
```

Expected: PASS — all 7 `wunschlisten actions` specs green. Critically the two idempotency specs are
non-vacuous: `pending` → `notifySpy` called exactly once with `{ tenantId, matchId }`; `notified` → `notifySpy`
NOT called; `dismissMatch` flips the DB row to `dismissed` and returns `not_found` for an unknown id.

#### Step 12 — Commit

```bash
git add src/app/\(app\)/wunschlisten/actions.ts tests/app/wunschlisten-actions.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(slice3): wunschlisten server actions (createWishlist/notify/dismiss)

createWishlist gated by the locked staff prologue. notifyWishlistMatch is read-then-enqueue:
loads the match inside withTenant (RLS-scoped), enqueues only when status='pending'
(idempotent no-op otherwise), soft-fails the enqueue with a structured error. dismissMatch
is a tenant-scoped UPDATE…RETURNING (0 rows → not_found). Non-vacuous notify idempotency
asserted via the enqueue spy's call count.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 10: Kasse screen + components

POS-Kasse screen (spec §5.1, §2) — a new two-column screen in the handoff visual language that reuses the
payment cluster + tokens. It is purely the **client UI layer**: it composes the C4 pure totals function
(`computeCartTotals` — money math NEVER leaves integer cents / `var(--on-accent)` only, raw hex banned) and
calls the C11 `createSale` action (mocked in component tests). The server data fetch (page.tsx) loads active
`quick_items` (C7 `listActiveQuickItems`) + sellable inventory (existing `listInventory`, filtered to
`verfuegbar`/`reserviert`). Built bottom-up: each presentational leaf is TDD'd standalone, then the
`KasseScreen` orchestrator is integration-tested with a spied `createSale` (non-vacuous: assert exact payload
+ call count).

**Honored lessons:** semantic tokens only — text-on-accent uses `var(--on-accent)`, no raw `#hex` (lesson #4);
money totals run through the pure C4 `computeCartTotals` (integer cents), never JS float in the component; the
`inv-<purchaseId>` cart key enforces single-instance-per-copy in the UI (the server independently dedupes via
C5 step 2 + `createSaleSchema` refine and never trusts the client key); the submit test SPIES `createSale` and
asserts it was called exactly once with the resolved `CartInput` (no vacuous assertion).

---

**Files:**

- Create: `src/app/(app)/kasse/_components/PaymentCluster.tsx` — `kasse-pay-<method>` cluster + shared `voucher-code-input`.
- Create: `src/app/(app)/kasse/_components/DiscountInput.tsx` — `kasse-discount-input` + `kasse-discount-mode` (€/% toggle).
- Create: `src/app/(app)/kasse/_components/Cart.tsx` — `kasse-cart`, `kasse-cart-item-<key>`, `kasse-total`, `kasse-submit`; exports `UiCartLine`.
- Create: `src/app/(app)/kasse/_components/InventorySearch.tsx` — `kasse-inventory-search` (renders only the rows passed in: verfuegbar/reserviert).
- Create: `src/app/(app)/kasse/_components/QuickItemButtons.tsx` — `kasse-quick-item-<id>`.
- Create: `src/app/(app)/kasse/_components/AdhocAdd.tsx` — `kasse-adhoc-add`.
- Create: `src/app/(app)/kasse/_components/KasseScreen.tsx` — client orchestrator (cart state, `kasse-screen`).
- Create: `src/app/(app)/kasse/page.tsx` — server component; loads active quick_items + sellable inventory.
- Test: `tests/app/kasse.component.test.tsx` — grown additively per cycle; all §5.1 testids + percent-discount path + non-vacuous `createSale` payload assertion.

---

**Interfaces:**

Consumes from earlier tasks (copied VERBATIM from contracts):

```ts
// C4 — src/lib/sales.ts (pure, browser-safe)
export type CartLineInput =
  | { kind: 'inventory'; purchaseId: number }
  | { kind: 'quick'; quickItemId: number; quantity: number }
  | { kind: 'adhoc'; label: string; unitPrice: string; quantity: number };
export type ResolvedCartLine = { label: string; unitPrice: string; quantity: number };
export type DiscountInput = { kind: 'amount'; value: string } | { kind: 'percent'; value: number };
export type CartInput = {
  lines: CartLineInput[];
  payment: PaymentMethod;
  discount: DiscountInput | null;
  voucherCode?: string | null;
};
export type CartTotals = { subtotal: string; discount: string; total: string };
export function computeCartTotals(lines: ResolvedCartLine[], discount: DiscountInput | null): CartTotals;
export type { PaymentMethod }; // 'bar' | 'karte' | 'paypal' | 'gutschein'

// C7 — src/lib/quickItems.ts (server-only; type-only import in client)
export type QuickItemRow = { id: number; name: string; price: string; active: boolean };
export async function listActiveQuickItems(ctx: TenantCtx): Promise<QuickItemRow[]>;

// existing — src/lib/inventory.ts (server-only; type-only import in client)
export type InventoryRow = {
  copyId: number; recordId: number; title: string; artist: string; label: string[];
  releaseYear: number | null; country: string | null; format: string | null; genre: string[];
  ek: string | null; vk: string | null; status: InventoryStatus;
  conditionRecord: number | null; conditionCover: number | null;
};
export async function listInventory(ctx, f: InventoryFilters): Promise<InventoryRow[]>;

// C11 — src/app/(app)/kasse/actions.ts
export async function createSale(input: CartInput):
  Promise<{ ok: true; transactionId: number; total: string }
         | { ok: false; reason: 'validation' | 'conflict' | 'error'; message?: string }>;
```

Produces for later tasks:

```ts
// src/app/(app)/kasse/_components/Cart.tsx
export type UiCartLine =
  | { key: string; kind: 'inventory'; purchaseId: number; label: string; unitPrice: string }
  | { key: string; kind: 'quick'; quickItemId: number; label: string; unitPrice: string; quantity: number }
  | { key: string; kind: 'adhoc'; label: string; unitPrice: string; quantity: number };

// src/app/(app)/kasse/_components/KasseScreen.tsx
export function KasseScreen(props: { inventory: InventoryRow[]; quickItems: QuickItemRow[] }): JSX.Element;
// src/app/(app)/kasse/page.tsx — default async server component (no exported value used by later tasks)
```

testids produced (C12 frozen registry): `kasse-screen`, `kasse-inventory-search`, `kasse-quick-item-<id>`,
`kasse-adhoc-add`, `kasse-cart`, `kasse-cart-item-<key>` (`inv-<purchaseId>` | `quick-<quickItemId>` |
`adhoc-<index>`), `kasse-discount-input`, `kasse-discount-mode`, `kasse-pay-<bar|karte|paypal|gutschein>`,
`voucher-code-input`, `kasse-total`, `kasse-submit`.

---

## Cycle 1 — PaymentCluster (`kasse-pay-<method>` + shared `voucher-code-input`)

**Step 1 — Write the failing test.** Create `tests/app/kasse.component.test.tsx`:

```tsx
// tests/app/kasse.component.test.tsx
// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { PaymentCluster } from '@/app/(app)/kasse/_components/PaymentCluster';

describe('PaymentCluster', () => {
  afterEach(cleanup);

  it('renders four payment methods and toggles the voucher field for gutschein', () => {
    const onPaymentChange = vi.fn();
    const onVoucherChange = vi.fn();
    const { rerender } = render(
      <PaymentCluster
        payment="bar"
        voucherCode=""
        onPaymentChange={onPaymentChange}
        onVoucherChange={onVoucherChange}
      />,
    );
    for (const m of ['bar', 'karte', 'paypal', 'gutschein']) {
      expect(screen.getByTestId(`kasse-pay-${m}`)).toBeInTheDocument();
    }
    // voucher field hidden unless payment === 'gutschein'
    expect(screen.queryByTestId('voucher-code-input')).toBeNull();

    fireEvent.click(screen.getByTestId('kasse-pay-gutschein'));
    expect(onPaymentChange).toHaveBeenCalledWith('gutschein');

    rerender(
      <PaymentCluster
        payment="gutschein"
        voucherCode=""
        onPaymentChange={onPaymentChange}
        onVoucherChange={onVoucherChange}
      />,
    );
    expect(screen.getByTestId('voucher-code-input')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('voucher-code-input'), { target: { value: 'XMAS' } });
    expect(onVoucherChange).toHaveBeenCalledWith('XMAS');
  });
});
```

**Step 2 — Run it, expect FAIL** (module does not exist yet):

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: fails to resolve `@/app/(app)/kasse/_components/PaymentCluster`.

**Step 3 — Implement PaymentCluster.** Create `src/app/(app)/kasse/_components/PaymentCluster.tsx`:

```tsx
'use client';

import type { PaymentMethod } from '@/lib/sales';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'karte', label: 'Karte' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'gutschein', label: 'Gutschein' },
];

export function PaymentCluster({
  payment,
  voucherCode,
  onPaymentChange,
  onVoucherChange,
}: {
  payment: PaymentMethod;
  voucherCode: string;
  onPaymentChange: (m: PaymentMethod) => void;
  onVoucherChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {METHODS.map((m) => {
          const selected = m.value === payment;
          return (
            <button
              key={m.value}
              type="button"
              data-testid={`kasse-pay-${m.value}`}
              aria-pressed={selected}
              onClick={() => onPaymentChange(m.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--r-md)',
                border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: selected ? 'var(--accent)' : 'var(--surface)',
                color: selected ? 'var(--on-accent)' : 'var(--text-1)',
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {payment === 'gutschein' && (
        <input
          data-testid="voucher-code-input"
          placeholder="Gutschein-Code"
          value={voucherCode}
          onChange={(e) => onVoucherChange(e.target.value)}
          style={{
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface)',
          }}
        />
      )}
    </div>
  );
}
```

**Step 4 — Run it, expect PASS:**

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: 1 passing.

**Step 5 — Commit:**

```
git add src/app/(app)/kasse/_components/PaymentCluster.tsx tests/app/kasse.component.test.tsx
git commit -m "feat(slice3): Kasse PaymentCluster (kasse-pay-* + shared voucher-code-input)

Payment method cluster with semantic --on-accent tokens (no raw hex); voucher
field appears only for gutschein. Standalone component-tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Cycle 2 — DiscountInput (`kasse-discount-input` + `kasse-discount-mode`)

**Step 6 — Append the failing test.** Add to `tests/app/kasse.component.test.tsx` (new import + describe block):

```tsx
import { DiscountInput } from '@/app/(app)/kasse/_components/DiscountInput';

describe('DiscountInput', () => {
  afterEach(cleanup);

  it('switches the discount kind via kasse-discount-mode and reports value changes', () => {
    const onModeChange = vi.fn();
    const onValueChange = vi.fn();
    render(
      <DiscountInput mode="amount" value="" onModeChange={onModeChange} onValueChange={onValueChange} />,
    );
    fireEvent.change(screen.getByTestId('kasse-discount-mode'), { target: { value: 'percent' } });
    expect(onModeChange).toHaveBeenCalledWith('percent');
    fireEvent.change(screen.getByTestId('kasse-discount-input'), { target: { value: '10' } });
    expect(onValueChange).toHaveBeenCalledWith('10');
  });
});
```

**Step 7 — Run it, expect FAIL** (DiscountInput module missing):

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: fails to resolve `@/app/(app)/kasse/_components/DiscountInput`.

**Step 8 — Implement DiscountInput.** Create `src/app/(app)/kasse/_components/DiscountInput.tsx`:

```tsx
'use client';

import type { DiscountInput as DiscountKind } from '@/lib/sales';

/** The two selectable modes map to the C4 DiscountInput union literals 'amount' (€) and 'percent' (%). */
export function DiscountInput({
  mode,
  value,
  onModeChange,
  onValueChange,
}: {
  mode: DiscountKind['kind'];
  value: string;
  onModeChange: (mode: DiscountKind['kind']) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select
        data-testid="kasse-discount-mode"
        value={mode}
        onChange={(e) => onModeChange(e.target.value as DiscountKind['kind'])}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      >
        <option value="amount">€</option>
        <option value="percent">%</option>
      </select>
      <input
        data-testid="kasse-discount-input"
        inputMode="decimal"
        value={value}
        placeholder="Rabatt"
        onChange={(e) => onValueChange(e.target.value)}
        style={{
          width: 110,
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      />
    </div>
  );
}
```

**Step 9 — Run it, expect PASS:**

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: 2 passing.

**Step 10 — Commit:**

```
git add src/app/(app)/kasse/_components/DiscountInput.tsx tests/app/kasse.component.test.tsx
git commit -m "feat(slice3): Kasse DiscountInput (amount/percent mode toggle)

kasse-discount-mode selects the C4 DiscountInput union literal; kasse-discount-input
carries the active value. Standalone component-tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Cycle 3 — Cart (`kasse-cart`, `kasse-cart-item-<key>`, `kasse-total`, `kasse-submit`) + `UiCartLine`

**Step 11 — Append the failing test.** Add to `tests/app/kasse.component.test.tsx`:

```tsx
import { Cart, type UiCartLine } from '@/app/(app)/kasse/_components/Cart';

describe('Cart', () => {
  afterEach(cleanup);

  const lines: UiCartLine[] = [
    { key: 'quick-7', kind: 'quick', quickItemId: 7, label: 'Kaffee', unitPrice: '2.50', quantity: 2 },
  ];

  it('disables submit when empty, then renders items + total and fires onSubmit', () => {
    const onRemove = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Cart
        lines={[]}
        totals={{ subtotal: '0.00', discount: '0.00', total: '0.00' }}
        onRemove={onRemove}
        onSubmit={onSubmit}
        submitting={false}
      />,
    );
    expect(screen.getByTestId('kasse-cart')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('0.00');
    expect(screen.getByTestId('kasse-submit')).toBeDisabled();

    rerender(
      <Cart
        lines={lines}
        totals={{ subtotal: '5.00', discount: '0.00', total: '5.00' }}
        onRemove={onRemove}
        onSubmit={onSubmit}
        submitting={false}
      />,
    );
    expect(screen.getByTestId('kasse-cart-item-quick-7')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('5.00');
    expect(screen.getByTestId('kasse-submit')).toBeEnabled();

    fireEvent.click(screen.getByTestId('kasse-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
```

**Step 12 — Run it, expect FAIL** (Cart module missing):

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: fails to resolve `@/app/(app)/kasse/_components/Cart`.

**Step 13 — Implement Cart.** Create `src/app/(app)/kasse/_components/Cart.tsx`:

```tsx
'use client';

import type { CartTotals } from '@/lib/sales';

/** UI cart line: display fields (label/unitPrice/key) on top of the C4 CartLineInput discriminant.
 *  key = inv-<purchaseId> | quick-<quickItemId> | adhoc-<index> (C12). */
export type UiCartLine =
  | { key: string; kind: 'inventory'; purchaseId: number; label: string; unitPrice: string }
  | { key: string; kind: 'quick'; quickItemId: number; label: string; unitPrice: string; quantity: number }
  | { key: string; kind: 'adhoc'; label: string; unitPrice: string; quantity: number };

export function Cart({
  lines,
  totals,
  onRemove,
  onSubmit,
  submitting,
}: {
  lines: UiCartLine[];
  totals: CartTotals;
  onRemove: (key: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const empty = lines.length === 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ul
        data-testid="kasse-cart"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {lines.map((l) => (
          <li
            key={l.key}
            data-testid={`kasse-cart-item-${l.key}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface)',
            }}
          >
            <span>{l.label}</span>
            <span>
              {l.kind === 'inventory' ? 1 : l.quantity} × {l.unitPrice} €
              <button
                type="button"
                onClick={() => onRemove(l.key)}
                aria-label="Position entfernen"
                style={{
                  marginLeft: 8,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text-3)',
                }}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div data-testid="kasse-total" style={{ fontWeight: 700, textAlign: 'right' }}>
        {totals.total} €
      </div>
      <button
        type="button"
        data-testid="kasse-submit"
        disabled={empty || submitting}
        onClick={onSubmit}
        style={{
          padding: '10px 16px',
          border: 'none',
          borderRadius: 'var(--r-md)',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          cursor: empty || submitting ? 'not-allowed' : 'pointer',
          opacity: empty || submitting ? 0.5 : 1,
        }}
      >
        Verkaufen
      </button>
    </div>
  );
}
```

**Step 14 — Run it, expect PASS:**

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: 3 passing.

**Step 15 — Commit:**

```
git add src/app/(app)/kasse/_components/Cart.tsx tests/app/kasse.component.test.tsx
git commit -m "feat(slice3): Kasse Cart list + total + submit (UiCartLine)

kasse-cart/-item-<key>/-total/-submit; submit disabled while empty or submitting.
Exports UiCartLine (key inv-/quick-/adhoc-) for the orchestrator. --on-accent tokens.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Cycle 4 — Selection controls (InventorySearch, QuickItemButtons, AdhocAdd)

**Step 16 — Append the failing test.** Add to `tests/app/kasse.component.test.tsx` (new imports, shared
fixtures, and one describe block):

```tsx
import { InventorySearch } from '@/app/(app)/kasse/_components/InventorySearch';
import { QuickItemButtons } from '@/app/(app)/kasse/_components/QuickItemButtons';
import { AdhocAdd } from '@/app/(app)/kasse/_components/AdhocAdd';
import type { InventoryRow } from '@/lib/inventory';
import type { QuickItemRow } from '@/lib/quickItems';

const fxInventory: InventoryRow[] = [
  {
    copyId: 101, recordId: 11, title: 'Kind of Blue', artist: 'Miles Davis', label: ['Columbia'],
    releaseYear: 1959, country: 'US', format: 'Vinyl', genre: ['Jazz'], ek: '8.00', vk: '20.00',
    status: 'verfuegbar', conditionRecord: 5, conditionCover: 4,
  },
];
const fxQuickItems: QuickItemRow[] = [{ id: 7, name: 'Kaffee', price: '2.50', active: true }];

describe('selection controls', () => {
  afterEach(cleanup);

  it('InventorySearch filters by query and emits the picked row', async () => {
    const onAdd = vi.fn();
    render(<InventorySearch rows={fxInventory} onAdd={onAdd} />);
    // nothing rendered until the operator types
    expect(screen.queryByRole('button', { name: /Kind of Blue/ })).toBeNull();
    fireEvent.change(screen.getByTestId('kasse-inventory-search'), { target: { value: 'miles' } });
    fireEvent.click(await screen.findByRole('button', { name: /Kind of Blue/ }));
    expect(onAdd).toHaveBeenCalledWith(fxInventory[0]);
  });

  it('QuickItemButtons renders a button per active item and emits it', () => {
    const onAdd = vi.fn();
    render(<QuickItemButtons items={fxQuickItems} onAdd={onAdd} />);
    fireEvent.click(screen.getByTestId('kasse-quick-item-7'));
    expect(onAdd).toHaveBeenCalledWith(fxQuickItems[0]);
  });

  it('AdhocAdd validates name + price before enabling kasse-adhoc-add', () => {
    const onAdd = vi.fn();
    render(<AdhocAdd onAdd={onAdd} />);
    expect(screen.getByTestId('kasse-adhoc-add')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Bezeichnung'), { target: { value: 'Poster' } });
    fireEvent.change(screen.getByPlaceholderText('Preis'), { target: { value: '5.00' } });
    expect(screen.getByTestId('kasse-adhoc-add')).toBeEnabled();
    fireEvent.click(screen.getByTestId('kasse-adhoc-add'));
    expect(onAdd).toHaveBeenCalledWith('Poster', '5.00');
  });
});
```

**Step 17 — Run it, expect FAIL** (three selection modules missing):

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: fails to resolve `@/app/(app)/kasse/_components/InventorySearch` (and the two siblings).

**Step 18 — Implement InventorySearch.** Create `src/app/(app)/kasse/_components/InventorySearch.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { InventoryRow } from '@/lib/inventory';

/** Renders ONLY the rows it is given (the page pre-filters to verfuegbar/reserviert). In-results
 *  case-insensitive substring search over "artist title"; clicking a result emits the full row. */
export function InventorySearch({
  rows,
  onAdd,
}: {
  rows: InventoryRow[];
  onAdd: (row: InventoryRow) => void;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? rows.filter((r) => `${r.artist} ${r.title}`.toLowerCase().includes(needle)).slice(0, 8)
    : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        data-testid="kasse-inventory-search"
        placeholder="Inventar durchsuchen…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      />
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {matches.map((r) => (
          <li key={r.copyId}>
            <button
              type="button"
              onClick={() => onAdd(r)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface)',
                cursor: 'pointer',
              }}
            >
              {r.artist} – {r.title} · {r.vk ?? '—'} €
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**Step 19 — Implement QuickItemButtons.** Create `src/app/(app)/kasse/_components/QuickItemButtons.tsx`:

```tsx
'use client';

import type { QuickItemRow } from '@/lib/quickItems';

export function QuickItemButtons({
  items,
  onAdd,
}: {
  items: QuickItemRow[];
  onAdd: (item: QuickItemRow) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-testid={`kasse-quick-item-${it.id}`}
          onClick={() => onAdd(it)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface)',
            cursor: 'pointer',
          }}
        >
          {it.name} · {it.price} €
        </button>
      ))}
    </div>
  );
}
```

**Step 20 — Implement AdhocAdd.** Create `src/app/(app)/kasse/_components/AdhocAdd.tsx`:

```tsx
'use client';

import { useState } from 'react';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

export function AdhocAdd({ onAdd }: { onAdd: (name: string, price: string) => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const valid = name.trim().length > 0 && PRICE_RE.test(price.trim());
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        placeholder="Bezeichnung"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      />
      <input
        placeholder="Preis"
        value={price}
        inputMode="decimal"
        onChange={(e) => setPrice(e.target.value)}
        style={{
          width: 90,
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      />
      <button
        type="button"
        data-testid="kasse-adhoc-add"
        disabled={!valid}
        onClick={() => {
          onAdd(name.trim(), price.trim());
          setName('');
          setPrice('');
        }}
        style={{
          padding: '8px 12px',
          border: 'none',
          borderRadius: 'var(--r-md)',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          cursor: valid ? 'pointer' : 'not-allowed',
          opacity: valid ? 1 : 0.5,
        }}
      >
        +
      </button>
    </div>
  );
}
```

**Step 21 — Run it, expect PASS:**

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: 6 passing (3 new + 3 prior).

**Step 22 — Commit:**

```
git add src/app/(app)/kasse/_components/InventorySearch.tsx src/app/(app)/kasse/_components/QuickItemButtons.tsx src/app/(app)/kasse/_components/AdhocAdd.tsx tests/app/kasse.component.test.tsx
git commit -m "feat(slice3): Kasse selection controls (inventory search, quick buttons, ad-hoc add)

In-results inventory search (sellable rows only), kasse-quick-item-<id> buttons,
ad-hoc add gated on name + numeric(10,2) price. Standalone component-tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Cycle 5 — KasseScreen orchestrator + page (integration: computeCartTotals + spied createSale)

**Step 23 — Append the failing integration test.** Add to `tests/app/kasse.component.test.tsx` (mock the C11
action with a SPY, import the orchestrator, exercise the full flow). The `vi.hoisted`/`vi.mock` are hoisted to
the top of the module by Vitest regardless of textual position:

```tsx
import { waitFor } from '@testing-library/react';

const createSale = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, transactionId: 1, total: '0.00' })),
);
vi.mock('@/app/(app)/kasse/actions', () => ({ createSale }));

import { KasseScreen } from '@/app/(app)/kasse/_components/KasseScreen';

describe('KasseScreen', () => {
  afterEach(cleanup);
  beforeEachReset();

  function renderScreen() {
    return render(<KasseScreen inventory={fxInventory} quickItems={fxQuickItems} />);
  }

  it('renders the POS shell with an empty cart and disabled submit', () => {
    renderScreen();
    expect(screen.getByTestId('kasse-screen')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-inventory-search')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-quick-item-7')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-adhoc-add')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-cart')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('0.00');
    expect(screen.getByTestId('kasse-submit')).toBeDisabled();
  });

  it('adds an inventory copy from search and reflects its VK in the total', async () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('kasse-inventory-search'), { target: { value: 'miles' } });
    fireEvent.click(await screen.findByRole('button', { name: /Kind of Blue/ }));
    expect(screen.getByTestId('kasse-cart-item-inv-101')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('20.00');
    expect(screen.getByTestId('kasse-submit')).toBeEnabled();
  });

  it('never adds the same inventory copy twice (inv-<purchaseId> single-instance)', async () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('kasse-inventory-search'), { target: { value: 'miles' } });
    fireEvent.click(await screen.findByRole('button', { name: /Kind of Blue/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Kind of Blue/ }));
    expect(screen.getAllByTestId('kasse-cart-item-inv-101')).toHaveLength(1);
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('20.00');
  });

  it('adds a quick item and an ad-hoc line, summing via computeCartTotals', () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('kasse-quick-item-7')); // 2.50
    expect(screen.getByTestId('kasse-cart-item-quick-7')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Bezeichnung'), { target: { value: 'Poster' } });
    fireEvent.change(screen.getByPlaceholderText('Preis'), { target: { value: '5.00' } });
    fireEvent.click(screen.getByTestId('kasse-adhoc-add'));
    expect(screen.getByTestId('kasse-cart-item-adhoc-0')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('7.50'); // 2.50 + 5.00
  });

  it('applies a percent discount via kasse-discount-mode (integer-cent math)', () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('kasse-quick-item-7')); // 2.50
    fireEvent.change(screen.getByTestId('kasse-discount-mode'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByTestId('kasse-discount-input'), { target: { value: '10' } });
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('2.25'); // 2.50 - 10%
  });

  it('reveals the voucher field only for gutschein payment', () => {
    renderScreen();
    expect(screen.queryByTestId('voucher-code-input')).toBeNull();
    fireEvent.click(screen.getByTestId('kasse-pay-gutschein'));
    expect(screen.getByTestId('voucher-code-input')).toBeInTheDocument();
  });

  it('submits the RESOLVED CartInput to createSale exactly once and clears the cart', async () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('kasse-quick-item-7')); // quick 7 x1
    fireEvent.click(screen.getByTestId('kasse-pay-karte'));
    fireEvent.click(screen.getByTestId('kasse-submit'));
    await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1));
    // non-vacuous: exact stripped payload (no display fields, no client price on inventory/quick)
    expect(createSale).toHaveBeenCalledWith({
      lines: [{ kind: 'quick', quickItemId: 7, quantity: 1 }],
      payment: 'karte',
      discount: null,
      voucherCode: null,
    });
    await waitFor(() => expect(screen.queryByTestId('kasse-cart-item-quick-7')).toBeNull());
    expect(screen.getByTestId('kasse-submit')).toBeDisabled();
  });
});
```

Also add `beforeEach`/`vi` reset wiring at the top of the file's imports (extend the existing
`import { ... } from 'vitest'` line to include `beforeEach`) and define `beforeEachReset` near the top of the
file:

```tsx
// extend the vitest import to:  import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
function beforeEachReset() {
  beforeEach(() => {
    createSale.mockClear();
    createSale.mockResolvedValue({ ok: true, transactionId: 1, total: '0.00' });
  });
}
```

**Step 24 — Run it, expect FAIL** (KasseScreen module missing):

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: fails to resolve `@/app/(app)/kasse/_components/KasseScreen`.

**Step 25 — Implement KasseScreen.** Create `src/app/(app)/kasse/_components/KasseScreen.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import type { InventoryRow } from '@/lib/inventory';
import type { QuickItemRow } from '@/lib/quickItems';
import {
  computeCartTotals,
  type CartInput,
  type CartLineInput,
  type DiscountInput,
  type PaymentMethod,
  type ResolvedCartLine,
} from '@/lib/sales';
import { createSale } from '@/app/(app)/kasse/actions';
import { InventorySearch } from './InventorySearch';
import { QuickItemButtons } from './QuickItemButtons';
import { AdhocAdd } from './AdhocAdd';
import { Cart, type UiCartLine } from './Cart';
import { DiscountInput as DiscountControl } from './DiscountInput';
import { PaymentCluster } from './PaymentCluster';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

/** UI line → pure-totals line: inventory quantity is always 1 (C2 invariant). */
function toResolved(l: UiCartLine): ResolvedCartLine {
  return { label: l.label, unitPrice: l.unitPrice, quantity: l.kind === 'inventory' ? 1 : l.quantity };
}

/** UI line → C4 CartLineInput: strip display fields; inventory/quick carry NO client price (server is authority). */
function toInput(l: UiCartLine): CartLineInput {
  if (l.kind === 'inventory') return { kind: 'inventory', purchaseId: l.purchaseId };
  if (l.kind === 'quick') return { kind: 'quick', quickItemId: l.quickItemId, quantity: l.quantity };
  return { kind: 'adhoc', label: l.label, unitPrice: l.unitPrice, quantity: l.quantity };
}

export function KasseScreen({
  inventory,
  quickItems,
}: {
  inventory: InventoryRow[];
  quickItems: QuickItemRow[];
}) {
  const [lines, setLines] = useState<UiCartLine[]>([]);
  const [adhocCounter, setAdhocCounter] = useState(0);
  const [discountMode, setDiscountMode] = useState<DiscountInput['kind']>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('bar');
  const [voucherCode, setVoucherCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const discount: DiscountInput | null = useMemo(() => {
    const v = discountValue.trim();
    if (!v) return null;
    if (discountMode === 'percent') {
      const n = Number(v);
      return Number.isFinite(n) ? { kind: 'percent', value: n } : null;
    }
    return PRICE_RE.test(v) ? { kind: 'amount', value: v } : null;
  }, [discountMode, discountValue]);

  const totals = useMemo(() => {
    try {
      return computeCartTotals(lines.map(toResolved), discount);
    } catch {
      return { subtotal: '0.00', discount: '0.00', total: '0.00' };
    }
  }, [lines, discount]);

  function addInventory(row: InventoryRow) {
    const key = `inv-${row.copyId}`;
    setLines((prev) =>
      prev.some((l) => l.key === key)
        ? prev // single-instance-per-copy (server independently dedupes; never trusts this key)
        : [...prev, { key, kind: 'inventory', purchaseId: row.copyId, label: row.title, unitPrice: row.vk ?? '0.00' }],
    );
  }

  function addQuick(item: QuickItemRow) {
    const key = `quick-${item.id}`;
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing && existing.kind === 'quick') {
        return prev.map((l) =>
          l.key === key && l.kind === 'quick' ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { key, kind: 'quick', quickItemId: item.id, label: item.name, unitPrice: item.price, quantity: 1 }];
    });
  }

  function addAdhoc(name: string, price: string) {
    const key = `adhoc-${adhocCounter}`;
    setAdhocCounter((c) => c + 1);
    setLines((prev) => [...prev, { key, kind: 'adhoc', label: name, unitPrice: price, quantity: 1 }]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSubmit() {
    if (lines.length === 0) return;
    const input: CartInput = {
      lines: lines.map(toInput),
      payment,
      discount,
      voucherCode: payment === 'gutschein' ? voucherCode.trim() || null : null,
    };
    setSubmitting(true);
    const res = await createSale(input);
    setSubmitting(false);
    if (res.ok) {
      setLines([]);
      setDiscountValue('');
      setVoucherCode('');
      setPayment('bar');
      setMessage('Verkauf gespeichert.');
    } else {
      setMessage(res.message ?? 'Verkauf fehlgeschlagen.');
    }
  }

  return (
    <div
      data-testid="kasse-screen"
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}
    >
      {/* Left: selection */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <InventorySearch rows={inventory} onAdd={addInventory} />
        <QuickItemButtons items={quickItems} onAdd={addQuick} />
        <AdhocAdd onAdd={addAdhoc} />
      </section>

      {/* Right: cart */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Cart
          lines={lines}
          totals={totals}
          onRemove={removeLine}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
        <DiscountControl
          mode={discountMode}
          value={discountValue}
          onModeChange={setDiscountMode}
          onValueChange={setDiscountValue}
        />
        <PaymentCluster
          payment={payment}
          voucherCode={voucherCode}
          onPaymentChange={setPayment}
          onVoucherChange={setVoucherCode}
        />
        {message && (
          <p role="status" style={{ color: 'var(--text-3)', margin: 0 }}>
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
```

**Step 26 — Run it, expect PASS:**

```
pnpm test tests/app/kasse.component.test.tsx
```

Expected: 13 passing (7 KasseScreen + 6 prior leaf tests).

**Step 27 — Implement the server page.** Create `src/app/(app)/kasse/page.tsx`:

```tsx
// src/app/(app)/kasse/page.tsx
import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { listInventory } from '@/lib/inventory';
import { listActiveQuickItems } from '@/lib/quickItems';
import { KasseScreen } from './_components/KasseScreen';

export default async function KassePage() {
  // staff-only screen (spec §5.7); actions are independently gated (C11)
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  const tenant = await getCurrentTenant();
  const ctx = { tenantId: tenant.id, userId: user.id };

  const [allRows, quickItems] = await Promise.all([
    listInventory(ctx, {}),
    listActiveQuickItems(ctx),
  ]);
  // Kasse offers only sellable copies (verfügbar/reserviert) — same gate performSale enforces server-side.
  const inventory = allRows.filter((r) => r.status === 'verfuegbar' || r.status === 'reserviert');

  return (
    <div style={{ maxWidth: 1200 }}>
      <KasseScreen inventory={inventory} quickItems={quickItems} />
    </div>
  );
}
```

**Step 28 — Typecheck the new server page** (page.tsx is not unit-tested; confirm it compiles against the
real C7/inventory signatures — E2E coverage lands in T14):

```
pnpm typecheck
```

Expected: no errors.

**Step 29 — Commit:**

```
git add src/app/(app)/kasse/_components/KasseScreen.tsx src/app/(app)/kasse/page.tsx tests/app/kasse.component.test.tsx
git commit -m "feat(slice3): Kasse screen orchestrator + server page

KasseScreen wires search/quick/adhoc → cart, runs C4 computeCartTotals (integer
cents, no float), strips display fields to the C4 CartInput and calls createSale
(spied: exact payload + once). inv-<purchaseId> single-instance in the UI; server
re-resolves prices. page.tsx loads sellable inventory + active quick_items, staff-gated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 11: Einzel-Verkauf-Modal + inventory wiring

**Refs:** spec §5.2 (Einzel-Verkauf-Modal), §5.3 (Reservieren/Storno), §5.6 (♡ Auf Wunschliste) · BUILD-CONTEXT T11
(+ Inventory-UI surface, lessons #4 semantic tokens / #6 fail-closed pricing) · CONTRACTS C11 (`createSale`,
`reserve`, `cancelReservation` signatures), C12 (testid registry — FROZEN), C5 (price authority + `SalePriceMissingError`
fail-closed), C4 (`CartInput`/`CartLineInput`/`PaymentMethod`).

Wire the inventory **Lagerzeile** to the canonical sale path. This task does NOT add any new server logic — it is a
**UI-only** task that consumes the T9 actions:

- **Create** the handoff-true **Einzel-Verkauf-Modal** (`SellModal.tsx`). It submits a **1-line**
  `{ kind:'inventory', purchaseId }` cart to `createSale` (C11). The server is the SOLE price authority (spec §6.1,
  C5 §0a delta 2): `sell-price-input` is a **READ-ONLY** display of the copy's stored `targetPrice` (`InventoryRow.vk`).
  If that price is absent, the modal **disables** `sell-submit` and surfaces **"kein VK-Preis hinterlegt"** — no client
  price is ever sent, so `createSale` cannot record a €0.00 inventory sale (C5 `SalePriceMissingError`, fail-closed).
- **Activate** the Slice-1-disabled "Verkaufen" button in `InventoryList.tsx` (only for `verfuegbar`/`reserviert`), and
  add the **Reservieren/Storno** row actions (`reserve-action` / `reserve-cancel-action`) and the **♡ Auf Wunschliste**
  prefill link (`add-to-wishlist`).

This task DEPENDS on **Task 9** (`createSale`, `reserve`, `cancelReservation` in `src/app/(app)/kasse/actions.ts`) and
**Task 1** (the `payment_method` enum + transaction tables those actions write). Do not start until T9 is merged. It also
touches the existing Slice-1 inventory component test, which asserts the button is disabled — that assertion is updated
here (full-suite lesson: a stale assertion the per-task reviewer won't run must not be left red).

---

#### Files

- **Create** `src/app/(app)/inventar/_components/SellModal.tsx` — handoff-true Einzel-Verkauf-Modal (client component;
  `sell-modal`, `sell-price-input`, `sell-pay-<method>`, `voucher-code-input`, `sell-submit`, `sell-cancel`).
- **Modify** `src/app/(app)/inventar/_components/InventoryList.tsx` — becomes a client component: activate "Verkaufen"
  (`verfuegbar`/`reserviert` only), open `SellModal`, add `reserve-action`/`reserve-cancel-action` row actions wired to
  `reserve`/`cancelReservation`, add the `add-to-wishlist` (♡) prefill link.
- **Test** `tests/app/sell-modal.component.test.tsx` — `SellModal` + `InventoryList` wiring (testids per §5.2/§5.3/§5.6;
  price field read-only; submit disabled when `targetPrice` absent; non-vacuous action-call assertions).
- **Modify** `tests/inventar/lagerbestand.test.tsx` — mock `@/app/(app)/kasse/actions` (InventoryList now imports it) and
  replace the now-stale "all Aktion buttons are disabled" InventoryList assertion (the `InventoryTiles` block is
  unchanged — Tiles are not wired in this slice).

No other files change. The Wunschlisten **screen/form** that consumes the `add-to-wishlist` prefill URL is T12; the POS
screen is T10. Do not add server actions or new testids here (C12 is FROZEN).

---

#### Interfaces

**Consumes from earlier tasks (copy verbatim — do NOT redefine):**

```ts
// from @/app/(app)/kasse/actions (Task 9, contract C11) — server actions:
export async function createSale(input: CartInput):
  Promise<{ ok: true; transactionId: number; total: string }
         | { ok: false; reason: 'validation' | 'conflict' | 'error'; message?: string }>;
export async function reserve(input: { purchaseId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }>;
export async function cancelReservation(input: { purchaseId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }>;

// from @/lib/sales (Task 2, contract C4) — types only:
export type PaymentMethod = 'bar' | 'karte' | 'paypal' | 'gutschein';
export type CartLineInput =
  | { kind: 'inventory'; purchaseId: number }
  | { kind: 'quick'; quickItemId: number; quantity: number }
  | { kind: 'adhoc'; label: string; unitPrice: string; quantity: number };
export type CartInput = {
  lines: CartLineInput[];
  payment: PaymentMethod;
  discount: { kind: 'amount'; value: string } | { kind: 'percent'; value: number } | null;
  voucherCode?: string | null;
};

// from @/lib/inventory (Slice 1, existing) — the row shape rendered by InventoryList.
//   InventoryRow.vk is purchases.targetPrice (numeric(10,2) string | null); copyId is the purchases.id.
export type InventoryRow = {
  copyId: number; recordId: number; title: string; artist: string; label: string[];
  releaseYear: number | null; country: string | null; format: string | null; genre: string[];
  ek: string | null; vk: string | null;
  status: 'verfuegbar' | 'reserviert' | 'verkauft' | 'verliehen';
  conditionRecord: number | null; conditionCover: number | null;
};
```

**Produces for later tasks:**

```ts
// src/app/(app)/inventar/_components/SellModal.tsx  ('use client')
export interface SellModalProps {
  purchaseId: number;        // = InventoryRow.copyId (purchases.id)
  title: string;
  artist: string;
  targetPrice: string | null; // = InventoryRow.vk (numeric(10,2) string) or null → read-only display
  onClose: () => void;
}
export function SellModal(props: SellModalProps): React.ReactPortal;

// InventoryList keeps its export signature; behaviour is now interactive:
export interface InventoryListProps { rows: InventoryRow[]; total: number; }
export function InventoryList(props: InventoryListProps): JSX.Element;
```

**Prefill-URL contract (consumed by T12 `WishlistForm`):** the ♡ `add-to-wishlist` control links to
`/wunschlisten?artist=<encodeURIComponent(row.artist)>&title=<encodeURIComponent(row.title)>`. T12's Wunschlisten page
reads the `artist` + `title` query params to pre-fill `wl-artist`/`wl-title`. These two param names are the locked
prefill contract; do not rename them in T12 without amending here.

**Locked design decisions honoured (do not re-derive):**
- **Price authority (C5 §0a delta 2):** an inventory line carries NO client price. `sell-price-input` is read-only; the
  submitted cart line is exactly `{ kind:'inventory', purchaseId }`.
- **Missing-price fail-closed (C5 §0a delta 3):** when `targetPrice` is null/blank, `sell-submit` is disabled and the
  modal shows **"kein VK-Preis hinterlegt"**. (The `suggestSalePrice` market-data hint from C5's note requires Discogs
  suggestion/median values that an inventory row does not carry, so the load-bearing behaviour — read-only price +
  disabled submit + the locked German copy — is what we render; no €0.00 sale can occur.)
- **Per-row static testids (C12 FROZEN):** `reserve-action`, `reserve-cancel-action`, `add-to-wishlist` are STATIC in the
  registry (not templated with an id) and "No task may invent testids outside this registry." In a multi-row table they
  therefore repeat per row; tests scope to a specific row via `within(row)` / `getAllByTestId(...)[i]`. Do NOT invent
  `reserve-action-<id>`.
- **Semantic tokens only (lesson #4):** text on accent uses `var(--on-accent)` (never `--accent-ink`, never raw hex).

---

#### Steps

**1. Write the failing `SellModal` test.**

Create `tests/app/sell-modal.component.test.tsx` with the content below. It mocks the T9 actions module (so no server
code loads), then asserts real behaviour: read-only price, the 1-line inventory payload (no client price), the
gutschein voucher gate, and the fail-closed disabled-submit when `targetPrice` is absent (asserting `createSale` was
NOT called — non-vacuous).

```tsx
// tests/app/sell-modal.component.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

// vi.hoisted so the fn refs exist inside the statically-hoisted vi.mock factory.
const createSale = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, transactionId: 1, total: '28.00' })),
);
const reserve = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const cancelReservation = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));

vi.mock('@/app/(app)/kasse/actions', () => ({ createSale, reserve, cancelReservation }));

import { SellModal } from '@/app/(app)/inventar/_components/SellModal';
import { InventoryList } from '@/app/(app)/inventar/_components/InventoryList';
import type { InventoryRow } from '@/lib/inventory';

const baseRow: InventoryRow = {
  copyId: 7,
  recordId: 70,
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
};

beforeEach(() => {
  createSale.mockClear();
  reserve.mockClear();
  cancelReservation.mockClear();
  createSale.mockResolvedValue({ ok: true, transactionId: 1, total: '28.00' });
  reserve.mockResolvedValue({ ok: true });
  cancelReservation.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('SellModal (§5.2)', () => {
  it('renders the handoff cluster with a READ-ONLY price showing the stored targetPrice', () => {
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={() => {}} />,
    );
    expect(screen.getByTestId('sell-modal')).toBeInTheDocument();
    const price = screen.getByTestId('sell-price-input') as HTMLInputElement;
    expect(price.value).toBe('28.00');
    expect(price).toHaveAttribute('readonly');
    // four payment options, default bar selected
    for (const m of ['bar', 'karte', 'paypal', 'gutschein']) {
      expect(screen.getByTestId(`sell-pay-${m}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('sell-pay-bar')).toHaveAttribute('aria-checked', 'true');
    // voucher field hidden until gutschein
    expect(screen.queryByTestId('voucher-code-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('sell-submit')).toBeEnabled();
  });

  it('submits a 1-line inventory cart with NO client price (server is price authority)', async () => {
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('sell-submit'));
    await waitFor(() =>
      expect(createSale).toHaveBeenCalledWith({
        lines: [{ kind: 'inventory', purchaseId: 7 }],
        payment: 'bar',
        discount: null,
        voucherCode: null,
      }),
    );
  });

  it('gutschein reveals the voucher field, gates submit, and forwards the trimmed code', async () => {
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('sell-pay-gutschein'));
    const voucher = screen.getByTestId('voucher-code-input');
    expect(voucher).toBeInTheDocument();
    // submit blocked while voucher empty
    expect(screen.getByTestId('sell-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('sell-submit'));
    expect(createSale).not.toHaveBeenCalled();
    // enter a code → submit enabled, code forwarded trimmed
    fireEvent.change(voucher, { target: { value: '  ABC-123  ' } });
    expect(screen.getByTestId('sell-submit')).toBeEnabled();
    fireEvent.click(screen.getByTestId('sell-submit'));
    await waitFor(() =>
      expect(createSale).toHaveBeenCalledWith({
        lines: [{ kind: 'inventory', purchaseId: 7 }],
        payment: 'gutschein',
        discount: null,
        voucherCode: 'ABC-123',
      }),
    );
  });

  it('FAIL-CLOSED: missing targetPrice disables submit, shows "kein VK-Preis hinterlegt", never calls createSale', () => {
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice={null} onClose={() => {}} />,
    );
    expect(screen.getByText('kein VK-Preis hinterlegt')).toBeInTheDocument();
    const submit = screen.getByTestId('sell-submit');
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(createSale).not.toHaveBeenCalled();
  });

  it('closes on cancel and on a successful sale', async () => {
    const onClose = vi.fn();
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId('sell-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('sell-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it('surfaces the action error message on a non-ok result', async () => {
    createSale.mockResolvedValueOnce({ ok: false, reason: 'conflict', message: 'Exemplar bereits verkauft.' });
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('sell-submit'));
    expect(await screen.findByText('Exemplar bereits verkauft.')).toBeInTheDocument();
  });
});

describe('InventoryList row wiring (§5.2/§5.3/§5.6)', () => {
  const rows: InventoryRow[] = [
    baseRow, // verfuegbar
    { ...baseRow, copyId: 8, recordId: 80, title: 'Music for the Masses', status: 'reserviert' },
    { ...baseRow, copyId: 9, recordId: 90, title: 'Remain in Light', artist: 'Talking Heads', vk: '22.00', status: 'verkauft' },
  ];

  it('verfuegbar row: Verkaufen enabled, Reservieren shown, ♡ links to the prefilled wishlist form', () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = screen.getByText('Violator').closest('tr')!;
    const u = within(row as HTMLElement);
    expect(u.getByRole('button', { name: /^Verkaufen$/i })).toBeEnabled();
    expect(u.getByTestId('reserve-action')).toBeInTheDocument();
    expect(u.queryByTestId('reserve-cancel-action')).not.toBeInTheDocument();
    const wish = u.getByTestId('add-to-wishlist');
    expect(wish).toHaveAttribute(
      'href',
      '/wunschlisten?artist=Depeche%20Mode&title=Violator',
    );
  });

  it('reserviert row: Verkaufen enabled, "Reservierung aufheben" shown instead of Reservieren', () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = screen.getByText('Music for the Masses').closest('tr')!;
    const u = within(row as HTMLElement);
    expect(u.getByRole('button', { name: /^Verkaufen$/i })).toBeEnabled();
    expect(u.getByTestId('reserve-cancel-action')).toBeInTheDocument();
    expect(u.queryByTestId('reserve-action')).not.toBeInTheDocument();
  });

  it('verkauft row: action button disabled (Verkauft), no reserve actions', () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = screen.getByText('Remain in Light').closest('tr')!;
    const u = within(row as HTMLElement);
    expect(u.getByRole('button', { name: /Verkauft/i })).toBeDisabled();
    expect(u.queryByTestId('reserve-action')).not.toBeInTheDocument();
    expect(u.queryByTestId('reserve-cancel-action')).not.toBeInTheDocument();
  });

  it('clicking Reservieren calls reserve with the row purchaseId', async () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = screen.getByText('Violator').closest('tr')!;
    fireEvent.click(within(row as HTMLElement).getByTestId('reserve-action'));
    await waitFor(() => expect(reserve).toHaveBeenCalledWith({ purchaseId: 7 }));
  });

  it('clicking "Reservierung aufheben" calls cancelReservation with the row purchaseId', async () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = screen.getByText('Music for the Masses').closest('tr')!;
    fireEvent.click(within(row as HTMLElement).getByTestId('reserve-cancel-action'));
    await waitFor(() => expect(cancelReservation).toHaveBeenCalledWith({ purchaseId: 8 }));
  });

  it('clicking Verkaufen opens the SellModal for that row with its targetPrice', () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = screen.getByText('Violator').closest('tr')!;
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /^Verkaufen$/i }));
    expect(screen.getByTestId('sell-modal')).toBeInTheDocument();
    expect((screen.getByTestId('sell-price-input') as HTMLInputElement).value).toBe('28.00');
  });
});
```

**2. Run the test and confirm it FAILS (no component yet).**

```bash
pnpm test tests/app/sell-modal.component.test.tsx
```

Expected: failure — `@/app/(app)/inventar/_components/SellModal` cannot be resolved (module does not exist), so the
suite errors on import before any assertion. Red state.

**3. Write the `SellModal` component.**

Create `src/app/(app)/inventar/_components/SellModal.tsx` with the complete content below.

```tsx
'use client';

// src/app/(app)/inventar/_components/SellModal.tsx
// Einzel-Verkauf-Modal (handoff-true) — quick single-copy sale from an inventory row.
// Submits a 1-line { kind:'inventory', purchaseId } cart to createSale (C11). The SERVER is
// the sole price authority (spec §6.1, C5 §0a delta 2): sell-price-input is a READ-ONLY display
// of the copy's stored targetPrice; no client price is ever sent. If targetPrice is absent the
// modal disables sell-submit and shows "kein VK-Preis hinterlegt" — createSale then cannot record
// a €0.00 sale (C5 SalePriceMissingError, fail-closed; §0a delta 3).

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { createSale } from '@/app/(app)/kasse/actions';
import type { PaymentMethod } from '@/lib/sales';

export interface SellModalProps {
  purchaseId: number;
  title: string;
  artist: string;
  targetPrice: string | null; // InventoryRow.vk (numeric(10,2) string) or null
  onClose: () => void;
}

const PAYMENTS: { method: PaymentMethod; label: string }[] = [
  { method: 'bar', label: '⛁ Bar' },
  { method: 'karte', label: '▭ Karte' },
  { method: 'paypal', label: 'PayPal' },
  { method: 'gutschein', label: '◫ Gutschein' },
];

export function SellModal({ purchaseId, title, artist, targetPrice, onClose }: SellModalProps) {
  const [payment, setPayment] = useState<PaymentMethod>('bar');
  const [voucherCode, setVoucherCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const priceMissing = targetPrice == null || targetPrice.trim() === '';
  const voucherMissing = payment === 'gutschein' && voucherCode.trim() === '';
  const submitDisabled = priceMissing || voucherMissing || isPending;

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async () => {
    if (submitDisabled) return;
    setError(null);
    setIsPending(true);
    try {
      const res = await createSale({
        lines: [{ kind: 'inventory', purchaseId }],
        payment,
        discount: null,
        voucherCode: payment === 'gutschein' ? voucherCode.trim() : null,
      });
      if (res.ok) {
        onClose();
      } else {
        setError(res.message ?? 'Verkauf fehlgeschlagen. Bitte erneut versuchen.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        padding: '16px',
        background: 'rgba(20,14,8,.42)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Exemplar verkaufen"
        data-testid="sell-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-3)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)', flex: 'none' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, lineHeight: 1.1 }}>
              {title}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Verkauf · {artist}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="focus-ring-button"
            style={{
              width: 36,
              height: 36,
              border: 'none',
              borderRadius: '50%',
              background: 'var(--surface-3)',
              color: 'var(--text-2)',
              fontSize: 16,
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Verkaufspreis € — READ-ONLY (server is price authority) */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Verkaufspreis €</span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span
                aria-hidden="true"
                style={{ position: 'absolute', left: 14, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
              >
                €
              </span>
              <input
                type="text"
                data-testid="sell-price-input"
                readOnly
                value={priceMissing ? '' : (targetPrice as string)}
                aria-label="Verkaufspreis (Festpreis aus dem Bestand)"
                style={{
                  width: '100%',
                  minHeight: 'var(--tap)',
                  padding: '0 14px 0 30px',
                  border: '1.5px solid var(--border-strong)',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 15,
                  cursor: 'default',
                }}
              />
            </div>
          </label>

          {priceMissing && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                background: 'var(--bad-soft)',
                color: 'var(--bad)',
                border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)',
                fontSize: 13.5,
              }}
            >
              kein VK-Preis hinterlegt
            </p>
          )}

          {/* Zahlungsart cluster */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Zahlungsart</span>
            <div role="radiogroup" aria-label="Zahlungsart" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PAYMENTS.map(({ method, label }) => {
                const isSelected = payment === method;
                return (
                  <button
                    key={method}
                    type="button"
                    role="radio"
                    data-testid={`sell-pay-${method}`}
                    aria-checked={isSelected}
                    onClick={() => setPayment(method)}
                    style={{
                      padding: '9px 14px',
                      borderRadius: 'var(--r-pill)',
                      border: 'none',
                      fontSize: 13,
                      fontWeight: isSelected ? 700 : 600,
                      background: isSelected ? 'var(--accent)' : 'var(--surface-3)',
                      color: isSelected ? 'var(--on-accent)' : 'var(--text-2)',
                      boxShadow: isSelected ? 'var(--shadow-1)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gutschein-Code — only for gutschein */}
          {payment === 'gutschein' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Gutschein-Code</span>
              <input
                type="text"
                data-testid="voucher-code-input"
                value={voucherCode}
                onChange={(e) => setVoucherCode(e.target.value)}
                placeholder="z. B. GUT-2026-XYZ"
                style={{
                  width: '100%',
                  minHeight: 'var(--tap)',
                  padding: '0 14px',
                  border: '1.5px solid var(--border-strong)',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 15,
                }}
              />
            </label>
          )}

          {/* Summe */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingTop: 4,
              borderTop: '1px solid var(--border)',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-2)' }}>Summe</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18 }}>
              € {priceMissing ? '—' : (targetPrice as string)}
            </span>
          </div>

          {error != null && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                background: 'var(--bad-soft)',
                color: 'var(--bad)',
                border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)',
                fontSize: 13.5,
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: '16px 22px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface-2)',
          }}
        >
          <button
            type="button"
            data-testid="sell-cancel"
            onClick={onClose}
            style={{
              flex: 1,
              minHeight: 'var(--tap)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: 'var(--font-body)',
              fontWeight: 600,
              fontSize: 14.5,
              cursor: 'pointer',
            }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="sell-submit"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="focus-ring-button"
            style={{
              flex: 1.5,
              minHeight: 'var(--tap)',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: submitDisabled ? 'var(--surface-3)' : 'var(--accent)',
              color: submitDisabled ? 'var(--text-3)' : 'var(--on-accent)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: 14.5,
              cursor: submitDisabled ? 'not-allowed' : 'pointer',
              transition: 'background var(--dur-1) var(--ease)',
            }}
          >
            Verkaufen
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

**4. Rewrite `InventoryList.tsx` as the interactive client component.**

Replace the entire file `src/app/(app)/inventar/_components/InventoryList.tsx` with the content below. The thead/footer
markup is unchanged; the Aktion cell is activated and the component now owns the open-modal state plus the reserve/cancel
handlers.

```tsx
'use client';

import { useState } from 'react';
import type { InventoryRow } from '@/lib/inventory';
import type { Condition } from '@/components/ui/ConditionPill';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConditionPill } from '@/components/ui/ConditionPill';
import { SellModal } from './SellModal';
import { reserve, cancelReservation } from '@/app/(app)/kasse/actions';

export interface InventoryListProps {
  rows: InventoryRow[];
  total: number; // from inventoryAggregates.total (ignores status tab) → footer
}

const HEAD_CELL: React.CSSProperties = {
  padding: '12px 12px',
  fontWeight: 600,
  fontSize: '11.5px',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
};

export function InventoryList({ rows, total }: InventoryListProps) {
  // The row whose Einzel-Verkauf-Modal is open (null = none). copyId === purchases.id.
  const [sellRow, setSellRow] = useState<InventoryRow | null>(null);

  // Reserve / cancel fire the T9 server actions; createSale/reserve/cancelReservation each
  // revalidatePath('/inventar') (C11), so the server-rendered table refreshes on the next request.
  const onReserve = (purchaseId: number) => {
    void reserve({ purchaseId });
  };
  const onCancelReservation = (purchaseId: number) => {
    void cancelReservation({ purchaseId });
  };

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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 720 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-3)', background: 'var(--surface-2)' }}>
              <th scope="col" style={{ ...HEAD_CELL, padding: '12px 18px' }}>
                Artikel
              </th>
              <th scope="col" style={HEAD_CELL}>
                Jahr · Label
              </th>
              <th scope="col" style={HEAD_CELL}>
                Zustand
              </th>
              <th scope="col" style={{ ...HEAD_CELL, textAlign: 'right' }}>
                EK / VK
              </th>
              <th scope="col" style={HEAD_CELL}>
                Status
              </th>
              <th scope="col" style={{ ...HEAD_CELL, padding: '12px 18px', textAlign: 'right' }}>
                Aktion
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sellable = row.status === 'verfuegbar' || row.status === 'reserviert';
              const wishHref = `/wunschlisten?artist=${encodeURIComponent(row.artist)}&title=${encodeURIComponent(
                row.title,
              )}`;
              return (
                <tr
                  key={row.copyId}
                  style={{
                    borderTop: '1px solid var(--border)',
                    opacity: row.status === 'verkauft' ? 0.62 : undefined,
                  }}
                >
                  {/* Artikel: cover thumb + title + artist */}
                  <td style={{ padding: '13px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                        <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{row.artist}</span>
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
                    {[row.releaseYear, row.label.join('/')].filter(Boolean).join(' · ')}
                  </td>

                  {/* Zustand */}
                  <td style={{ padding: '13px 12px' }}>
                    {row.conditionRecord !== null && (
                      <ConditionPill condition={row.conditionRecord as Condition} />
                    )}
                  </td>

                  {/* EK / VK */}
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

                  {/* Status */}
                  <td style={{ padding: '13px 12px' }}>
                    <StatusBadge status={row.status} />
                  </td>

                  {/* Aktion — Verkaufen + Reservieren/Storno + ♡ Auf Wunschliste */}
                  <td style={{ padding: '13px 18px' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {row.status === 'verfuegbar' && (
                        <button
                          type="button"
                          data-testid="reserve-action"
                          onClick={() => onReserve(row.copyId)}
                          style={{
                            minHeight: 34,
                            padding: '0 12px',
                            border: '1.5px solid var(--border-strong)',
                            borderRadius: 'var(--r-pill)',
                            background: 'var(--surface)',
                            color: 'var(--text-2)',
                            fontFamily: 'var(--font-body)',
                            fontWeight: 600,
                            fontSize: '12.5px',
                            cursor: 'pointer',
                          }}
                        >
                          Reservieren
                        </button>
                      )}
                      {row.status === 'reserviert' && (
                        <button
                          type="button"
                          data-testid="reserve-cancel-action"
                          onClick={() => onCancelReservation(row.copyId)}
                          style={{
                            minHeight: 34,
                            padding: '0 12px',
                            border: '1.5px solid var(--border-strong)',
                            borderRadius: 'var(--r-pill)',
                            background: 'var(--surface)',
                            color: 'var(--text-2)',
                            fontFamily: 'var(--font-body)',
                            fontWeight: 600,
                            fontSize: '12.5px',
                            cursor: 'pointer',
                          }}
                        >
                          Reservierung aufheben
                        </button>
                      )}

                      {/* ♡ Auf Wunschliste — links to the prefilled wishlist form (T12) */}
                      <a
                        href={wishHref}
                        data-testid="add-to-wishlist"
                        aria-label={`„${row.title}“ auf Wunschliste setzen`}
                        title="Auf Wunschliste"
                        style={{
                          minHeight: 34,
                          minWidth: 34,
                          display: 'inline-grid',
                          placeItems: 'center',
                          border: '1.5px solid var(--border-strong)',
                          borderRadius: '50%',
                          background: 'var(--surface)',
                          color: 'var(--accent)',
                          fontSize: 15,
                          textDecoration: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <span aria-hidden="true">♡</span>
                      </a>

                      <button
                        type="button"
                        disabled={!sellable}
                        onClick={() => sellable && setSellRow(row)}
                        style={{
                          minHeight: 34,
                          padding: '0 14px',
                          border: 'none',
                          borderRadius: 'var(--r-pill)',
                          background: sellable ? 'var(--accent)' : 'var(--surface-3)',
                          color: sellable ? 'var(--on-accent)' : 'var(--text-3)',
                          fontFamily: 'var(--font-body)',
                          fontWeight: sellable ? 700 : 600,
                          fontSize: '12.5px',
                          cursor: sellable ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {row.status === 'verkauft' ? 'Verkauft' : 'Verkaufen'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
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

      {sellRow && (
        <SellModal
          purchaseId={sellRow.copyId}
          title={sellRow.title}
          artist={sellRow.artist}
          targetPrice={sellRow.vk}
          onClose={() => setSellRow(null)}
        />
      )}
    </div>
  );
}
```

**5. Run the new test and confirm it PASSES.**

```bash
pnpm test tests/app/sell-modal.component.test.tsx
```

Expected: all cases green — SellModal renders the read-only price + 4 payment options, submits the exact 1-line inventory
cart (no client price), gates + forwards the gutschein voucher, fail-closes on a missing price (submit disabled, "kein
VK-Preis hinterlegt", `createSale` not called), and the InventoryList wiring opens the modal + calls `reserve` /
`cancelReservation` with the right `purchaseId`.

**6. Fix the now-stale Slice-1 assertion in the existing inventory test.**

`tests/inventar/lagerbestand.test.tsx` imports `InventoryList`, which now imports `@/app/(app)/kasse/actions`; add the
module mock and replace the InventoryList "all Aktion buttons are disabled" case (the `InventoryTiles` block stays — Tiles
are not wired in this slice). Apply these two edits.

Edit A — add the mock directly under the existing imports (after the `import type { InventoryRow }` line):

```tsx
// InventoryList now wires the T9 sale/reservation actions — mock the module so no server code loads.
vi.mock('@/app/(app)/kasse/actions', () => ({
  createSale: vi.fn(async () => ({ ok: true, transactionId: 1, total: '0.00' })),
  reserve: vi.fn(async () => ({ ok: true })),
  cancelReservation: vi.fn(async () => ({ ok: true })),
}));
```

and add `vi` to the vitest import on line 6:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
```

Edit B — replace the stale InventoryList case (currently asserting every Aktion button is disabled) with one that
reflects the activated button:

```tsx
  it('activates Verkaufen for sellable rows and disables it for verkauft', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    // ROWS[0] is verfuegbar → enabled; ROWS[1] is verkauft → disabled "Verkauft".
    expect(screen.getByRole('button', { name: /^Verkaufen$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Verkauft/i })).toBeDisabled();
  });
```

**7. Run the touched inventory suite and confirm it PASSES.**

```bash
pnpm test tests/inventar/lagerbestand.test.tsx
```

Expected: green — the InventoryList block now asserts the activated Verkaufen button (enabled for `verfuegbar`, disabled
for `verkauft`); the `InventoryTiles` "all Aktion buttons disabled" case is untouched and still passes.

**8. Typecheck, lint, then commit.**

```bash
pnpm typecheck && pnpm lint
git add \
  src/app/\(app\)/inventar/_components/SellModal.tsx \
  src/app/\(app\)/inventar/_components/InventoryList.tsx \
  tests/app/sell-modal.component.test.tsx \
  tests/inventar/lagerbestand.test.tsx
git commit -m "$(cat <<'EOF'
feat(slice3): Einzel-Verkauf-Modal + inventory row wiring (T11)

Activate the Slice-1-disabled "Verkaufen" button (verfuegbar/reserviert
only) and add the handoff-true Einzel-Verkauf-Modal: it submits a 1-line
{ kind:'inventory', purchaseId } cart to createSale. The server is the
sole price authority (spec §6.1) — sell-price-input is a READ-ONLY display
of the stored targetPrice and no client price is sent. A copy with no
targetPrice fail-closes: submit disabled + "kein VK-Preis hinterlegt"
(no €0.00 sale). Add Reservieren/Storno row actions wired to reserve/
cancelReservation, and a ♡ Auf-Wunschliste link prefilling artist+title.
Testids per spec §5.2/§5.3/§5.6 (C12 registry, no new ids). Update the
existing lagerbestand test (mock kasse actions, assert the now-active
button).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

#### Done when

- `pnpm test tests/app/sell-modal.component.test.tsx` is green (SellModal §5.2 cases + InventoryList §5.3/§5.6 wiring).
- `pnpm test tests/inventar/lagerbestand.test.tsx` is green (updated InventoryList assertion; Tiles untouched).
- `pnpm typecheck` and `pnpm lint` pass.
- `SellModal` submits exactly `{ lines: [{ kind:'inventory', purchaseId }], payment, discount: null, voucherCode }` —
  no client price for inventory (C5 §0a delta 2); a null `targetPrice` disables `sell-submit` and shows "kein VK-Preis
  hinterlegt" (C5 §0a delta 3, never a €0.00 sale).
- Only registry testids are used: `sell-modal`, `sell-price-input`, `sell-pay-<bar|karte|paypal|gutschein>`,
  `voucher-code-input`, `sell-submit`, `sell-cancel`, `reserve-action`, `reserve-cancel-action`, `add-to-wishlist`
  (C12 FROZEN — no invented ids; per-row buttons reuse the static ids, scoped in tests via `within(row)`).
- The ♡ link points to `/wunschlisten?artist=<enc>&title=<enc>` (the locked prefill contract T12 consumes).
- New markup uses semantic tokens only (`var(--on-accent)` for text on accent — no `--accent-ink`, no raw hex; lesson #4).

### Task 12: Wunschlisten screen + Benachrichtigen-Modal

Builds the staff-facing Wunschlisten screen (spec §5.4) and the Benachrichtigen-Modal (spec §5.5): the
erfassen-form, the status-badged wishlist list, the "Offene Treffer" pending-matches section with
Benachrichtigen/Verwerfen, and the READ-ONLY notify preview modal. Pure UI/component task — all DB work and
server actions already exist (T6 `@/lib/wishlist` C8, T9 `@/app/(app)/wunschlisten/actions` C11). The four
client components are RTL-tested in isolation with the actions mocked (`vi.hoisted` + `vi.mock`, the
established pattern from `tests/ankauf-modal.test.tsx`); the server `page.tsx` is a thin RSC data-loader
verified by `pnpm typecheck` here and exercised end-to-end in T14 (RSC with `requireSession` cannot be
RTL-rendered in vitest — same constraint as the kasse `page.tsx`).

**Locked-contract guardrails honored:** `notify-preview` is READ-ONLY (CONTRACTS §0a delta 1 / C10 — it
renders the `sendWishlistNotificationEmail` copy verbatim, NO editable textarea); all testids come from the
C12 FROZEN registry verbatim (no invented testids — `WishlistList` rows carry none because none are
registered); data comes from the C8 `WishlistRow` / `PendingMatchRow` shapes verbatim; primary buttons use
semantic tokens `var(--accent)` / `var(--on-accent)` (lesson #4 — never `--accent-ink`, never raw hex);
side-effecting action calls are spied and asserted by call-count + args (no vacuous assertions).

---

#### Files

- **Modify** `src/app/(app)/wunschlisten/page.tsx` — replace the Slice-1 placeholder with the real RSC: auth
  + staff gate, load `listWishlists` + `listPendingMatches` (C8), render `wishlist-screen` root composing the
  four components; pass `tenant.name` down for the notify preview.
- **Create** `src/app/(app)/wunschlisten/_components/WishlistForm.tsx` — `wishlist-form` + `wl-customer-name`
  / `wl-customer-email` / `wl-artist` / `wl-label` / `wl-title` / `wl-country` + `wishlist-submit`; calls
  `createWishlist` (C11). Accepts optional `initialArtist`/`initialTitle` for the §5.6 ♡-prefill (the ♡ wiring
  itself is T11).
- **Create** `src/app/(app)/wunschlisten/_components/WishlistList.tsx` — status-badged list of `WishlistRow`
  (open/notified/closed). Presentational; no registered testid → none added.
- **Create** `src/app/(app)/wunschlisten/_components/NotifyModal.tsx` — `notify-modal`, `notify-preview`
  (READ-ONLY rendered C10 template), `notify-send` (calls `notifyWishlistMatch`), `notify-cancel`.
- **Create** `src/app/(app)/wunschlisten/_components/MatchesSection.tsx` — `wishlist-matches`,
  `wl-match-<id>`, `wl-notify-<id>` (opens `NotifyModal`), `wl-dismiss-<id>` (calls `dismissMatch`).
- **Test** `tests/app/wunschlisten.component.test.tsx` — RTL component tests for all four client components
  (testids per §5.4/§5.5; `notify-preview` read-only; action calls spied).

---

#### Interfaces

**Consumes from earlier tasks (copy verbatim — do NOT redefine):**

From `@/lib/wishlist` (C8, T6):
```ts
export type WishlistRow = {
  id: number;
  customerName: string;
  customerEmail: string;
  artist: string;
  label: string | null;
  title: string | null;
  country: string | null;
  status: WishlistStatus; // 'open' | 'notified' | 'closed'  (from @/db/schema)
  createdAt: Date | null;
};
export type PendingMatchRow = {
  matchId: number;
  wishlistId: number;
  customerName: string;
  customerEmail: string;
  artist: string;
  title: string;
  coverImage: string | null;
  createdAt: Date | null;
};
export async function listWishlists(ctx: TenantCtx): Promise<WishlistRow[]>;
export async function listPendingMatches(ctx: TenantCtx): Promise<PendingMatchRow[]>;
```

From `@/app/(app)/wunschlisten/actions` (C11, T9):
```ts
export async function createWishlist(input: CreateWishlistInput):
  Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }>;
export async function notifyWishlistMatch(input: { matchId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }>;
export async function dismissMatch(input: { matchId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }>;
// CreateWishlistInput (C8):
//   { customerName: string; customerEmail: string; artist: string;
//     label?: string | null; title?: string | null; country?: string | null }
```

From `@/auth/session`: `requireSession(): Promise<SessionUser>` · from `next/navigation`: `forbidden()` ·
from `@/lib/tenant`: `getCurrentTenant()` (React-cached; returns the `tenants` row incl. `id` and `name`).

Notify-preview copy is the C10 `sendWishlistNotificationEmail` template (locked): subject
`` `Dein Wunsch ist da: ${artist} – ${title}` `` and the German text body — rendered read-only.

**Produces for later tasks:**
- `WishlistForm`, `WishlistList`, `MatchesSection`, `NotifyModal` client components and the real
  `wunschlisten/page.tsx` (`wishlist-screen`) consumed by **T13** (navigation makes the route reachable) and
  asserted by **T14** E2E (`wishlist → matching Ankauf → pending match → notify → mailpit`).

---

#### Steps

**1. Write the failing test — create the file with the action mocks + the `WishlistForm` block.**

Create `tests/app/wunschlisten.component.test.tsx`:

```tsx
// tests/app/wunschlisten.component.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// vi.hoisted: refs available inside the statically-hoisted vi.mock factory (ankauf-modal.test.tsx pattern).
const createWishlist = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, id: 7 })));
const notifyWishlistMatch = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const dismissMatch = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));

vi.mock('@/app/(app)/wunschlisten/actions', () => ({
  createWishlist,
  notifyWishlistMatch,
  dismissMatch,
}));

import { WishlistForm } from '@/app/(app)/wunschlisten/_components/WishlistForm';

afterEach(cleanup);

describe('WishlistForm', () => {
  beforeEach(() => {
    createWishlist.mockClear();
    createWishlist.mockResolvedValue({ ok: true, id: 7 });
  });

  it('renders all wl-* fields and the form/submit testids', () => {
    render(<WishlistForm />);
    expect(screen.getByTestId('wishlist-form')).toBeTruthy();
    for (const id of [
      'wl-customer-name',
      'wl-customer-email',
      'wl-artist',
      'wl-label',
      'wl-title',
      'wl-country',
      'wishlist-submit',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('prefills artist/title from the §5.6 ♡ props', () => {
    render(<WishlistForm initialArtist="Miles Davis" initialTitle="Kind of Blue" />);
    expect((screen.getByTestId('wl-artist') as HTMLInputElement).value).toBe('Miles Davis');
    expect((screen.getByTestId('wl-title') as HTMLInputElement).value).toBe('Kind of Blue');
  });

  it('submits trimmed payload to createWishlist (empty optionals → null) and resets on success', async () => {
    render(<WishlistForm />);
    fireEvent.change(screen.getByTestId('wl-customer-name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByTestId('wl-customer-email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByTestId('wl-artist'), { target: { value: 'Miles Davis' } });
    fireEvent.change(screen.getByTestId('wl-label'), { target: { value: '  Columbia  ' } });
    fireEvent.click(screen.getByTestId('wishlist-submit'));

    await waitFor(() => expect(createWishlist).toHaveBeenCalledTimes(1));
    expect(createWishlist).toHaveBeenCalledWith({
      customerName: 'Ada Lovelace',
      customerEmail: 'ada@example.com',
      artist: 'Miles Davis',
      label: 'Columbia',
      title: null,
      country: null,
    });
    // resets the artist field after a successful create
    await waitFor(() =>
      expect((screen.getByTestId('wl-artist') as HTMLInputElement).value).toBe(''),
    );
  });

  it('shows the error message when createWishlist fails', async () => {
    createWishlist.mockResolvedValueOnce({ ok: false, reason: 'validation', message: 'Künstler fehlt.' });
    render(<WishlistForm />);
    fireEvent.change(screen.getByTestId('wl-customer-name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByTestId('wl-customer-email'), { target: { value: 'x@example.com' } });
    fireEvent.change(screen.getByTestId('wl-artist'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByTestId('wishlist-submit'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Künstler fehlt.'));
  });
});
```

**2. Run the test, expecting FAIL** (module `WishlistForm` does not exist yet):

```bash
pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: FAIL — `Failed to resolve import "@/app/(app)/wunschlisten/_components/WishlistForm"`.

**3. Minimal implementation — create `src/app/(app)/wunschlisten/_components/WishlistForm.tsx`:**

```tsx
'use client';

// src/app/(app)/wunschlisten/_components/WishlistForm.tsx
// Wunsch-Erfassen-Formular (spec §5.4). artist required; label/title/country optional.
// Optional initialArtist/initialTitle support the §5.6 ♡ "Auf Wunschliste" prefill (♡ wiring is T11).

import { useState } from 'react';
import { createWishlist } from '../actions';

export interface WishlistFormProps {
  initialArtist?: string;
  initialTitle?: string;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-2)',
  color: 'var(--text-1)',
  fontSize: '14px',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-2)',
};

export function WishlistForm({ initialArtist = '', initialTitle = '' }: WishlistFormProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [artist, setArtist] = useState(initialArtist);
  const [label, setLabel] = useState('');
  const [title, setTitle] = useState(initialTitle);
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      const res = await createWishlist({
        customerName,
        customerEmail,
        artist,
        label: label.trim() || null,
        title: title.trim() || null,
        country: country.trim() || null,
      });
      if (res.ok) {
        setCustomerName('');
        setCustomerEmail('');
        setArtist('');
        setLabel('');
        setTitle('');
        setCountry('');
      } else {
        setError(res.message ?? 'Wunsch konnte nicht gespeichert werden.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      data-testid="wishlist-form"
      onSubmit={handleSubmit}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
        padding: '16px',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--border)',
        background: 'var(--surface-1)',
      }}
    >
      <label style={labelStyle}>
        Kundenname
        <input
          data-testid="wl-customer-name"
          style={fieldStyle}
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
        />
      </label>
      <label style={labelStyle}>
        E-Mail
        <input
          data-testid="wl-customer-email"
          type="email"
          style={fieldStyle}
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          required
        />
      </label>
      <label style={labelStyle}>
        Künstler
        <input
          data-testid="wl-artist"
          style={fieldStyle}
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          required
        />
      </label>
      <label style={labelStyle}>
        Label
        <input
          data-testid="wl-label"
          style={fieldStyle}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        Titel
        <input
          data-testid="wl-title"
          style={fieldStyle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        Land
        <input
          data-testid="wl-country"
          style={fieldStyle}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        />
      </label>

      {error && (
        <p role="alert" style={{ gridColumn: '1 / -1', margin: 0, color: 'var(--danger)', fontSize: '13px' }}>
          {error}
        </p>
      )}

      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          data-testid="wishlist-submit"
          disabled={isPending}
          style={{
            padding: '9px 18px',
            borderRadius: 'var(--r-md)',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 600,
            fontSize: '14px',
            cursor: isPending ? 'default' : 'pointer',
            opacity: isPending ? 0.6 : 1,
          }}
        >
          {isPending ? 'Speichert…' : 'Wunsch speichern'}
        </button>
      </div>
    </form>
  );
}
```

**4. Run the test, expecting PASS:**

```bash
pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: PASS (4 `WishlistForm` tests green).

**5. Commit:**

```bash
git add tests/app/wunschlisten.component.test.tsx src/app/\(app\)/wunschlisten/_components/WishlistForm.tsx
git commit -m "feat(slice3): WishlistForm — wl-* erfassen fields + createWishlist (T12)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**6. Write the failing test — append the `WishlistList` import + block** to
`tests/app/wunschlisten.component.test.tsx` (add the import beside the existing `WishlistForm` import, and
append the describe at end of file):

```tsx
import { WishlistList } from '@/app/(app)/wunschlisten/_components/WishlistList';
import type { WishlistRow } from '@/lib/wishlist';

const wishlistRows: WishlistRow[] = [
  {
    id: 1,
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    artist: 'Miles Davis',
    label: 'Columbia',
    title: 'Kind of Blue',
    country: 'US',
    status: 'open',
    createdAt: new Date('2026-06-01T10:00:00Z'),
  },
  {
    id: 2,
    customerName: 'Alan Turing',
    customerEmail: 'alan@example.com',
    artist: 'John Coltrane',
    label: null,
    title: null,
    country: null,
    status: 'notified',
    createdAt: new Date('2026-06-02T10:00:00Z'),
  },
];

describe('WishlistList', () => {
  it('renders each wish with customer + artist/title and a German status label', () => {
    render(<WishlistList wishlists={wishlistRows} />);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText(/Miles Davis – Kind of Blue/)).toBeTruthy();
    expect(screen.getByText('Offen')).toBeTruthy();
    expect(screen.getByText('Alan Turing')).toBeTruthy();
    // notified-status wish maps to the "Benachrichtigt" label
    expect(screen.getByText('Benachrichtigt')).toBeTruthy();
  });

  it('renders an empty hint when there are no wishes', () => {
    render(<WishlistList wishlists={[]} />);
    expect(screen.getByText(/Noch keine Wünsche erfasst/)).toBeTruthy();
  });
});
```

**7. Run the test, expecting FAIL** (module `WishlistList` does not exist):

```bash
pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: FAIL — `Failed to resolve import "@/app/(app)/wunschlisten/_components/WishlistList"`.

**8. Minimal implementation — create `src/app/(app)/wunschlisten/_components/WishlistList.tsx`:**

```tsx
// src/app/(app)/wunschlisten/_components/WishlistList.tsx
// Status-badged list of wishlists (spec §5.4). Presentational; no registered testid (C12) → none added.

import type { WishlistRow } from '@/lib/wishlist';
import type { WishlistStatus } from '@/db/schema';

const STATUS_LABEL: Record<WishlistStatus, string> = {
  open: 'Offen',
  notified: 'Benachrichtigt',
  closed: 'Geschlossen',
};

const STATUS_TOKEN: Record<WishlistStatus, { bg: string; ink: string; border: string }> = {
  open: { bg: 'var(--ok-soft)', ink: 'var(--ok)', border: 'color-mix(in srgb, var(--ok) 30%, transparent)' },
  notified: { bg: 'var(--info-soft)', ink: 'var(--info)', border: 'color-mix(in srgb, var(--info) 30%, transparent)' },
  closed: { bg: 'var(--surface-3)', ink: 'var(--text-2)', border: 'var(--border-strong)' },
};

function StatusPill({ status }: { status: WishlistStatus }) {
  const cfg = STATUS_TOKEN[status];
  return (
    <span
      style={{
        padding: '4px 11px',
        borderRadius: 'var(--r-pill)',
        background: cfg.bg,
        color: cfg.ink,
        border: `1px solid ${cfg.border}`,
        fontSize: '12px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function WishlistList({ wishlists }: { wishlists: WishlistRow[] }) {
  if (wishlists.length === 0) {
    return <p style={{ color: 'var(--text-2)', fontSize: '14px', margin: 0 }}>Noch keine Wünsche erfasst.</p>;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {wishlists.map((w) => (
        <li
          key={w.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 14px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)',
            background: 'var(--surface-1)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: '14px' }}>
              {w.artist}{w.title ? ` – ${w.title}` : ''}
            </span>
            <span style={{ color: 'var(--text-2)', fontSize: '13px' }}>
              {w.customerName} · {w.customerEmail}
            </span>
          </div>
          <StatusPill status={w.status} />
        </li>
      ))}
    </ul>
  );
}
```

**9. Run the test, expecting PASS:**

```bash
pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: PASS (`WishlistForm` + `WishlistList` blocks green).

**10. Commit:**

```bash
git add tests/app/wunschlisten.component.test.tsx src/app/\(app\)/wunschlisten/_components/WishlistList.tsx
git commit -m "feat(slice3): WishlistList — status-badged wish rows (T12)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**11. Write the failing test — append the `NotifyModal` import + block** to
`tests/app/wunschlisten.component.test.tsx`:

```tsx
import { NotifyModal } from '@/app/(app)/wunschlisten/_components/NotifyModal';
import type { PendingMatchRow } from '@/lib/wishlist';

const pendingMatch: PendingMatchRow = {
  matchId: 55,
  wishlistId: 1,
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  artist: 'Miles Davis',
  title: 'Kind of Blue',
  coverImage: null,
  createdAt: new Date('2026-06-03T10:00:00Z'),
};

describe('NotifyModal', () => {
  beforeEach(() => {
    notifyWishlistMatch.mockClear();
    notifyWishlistMatch.mockResolvedValue({ ok: true });
  });

  it('renders the read-only template preview with the C10 subject + recipient (no editable field)', () => {
    render(<NotifyModal match={pendingMatch} tenantName="Q-Records" onClose={() => {}} />);
    expect(screen.getByTestId('notify-modal')).toBeTruthy();
    const preview = screen.getByTestId('notify-preview');
    // Read-only: the preview is NOT a textbox/textarea (CONTRACTS §0a delta 1).
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(preview.tagName).not.toBe('TEXTAREA');
    expect(preview.tagName).not.toBe('INPUT');
    // Renders the locked C10 copy (greeting + tenant name + artist – title).
    expect(preview.textContent).toContain('Hallo Ada Lovelace');
    expect(preview.textContent).toContain('Q-Records');
    expect(preview.textContent).toContain('Miles Davis – Kind of Blue');
    // Recipient + locked subject are shown to the staff member.
    expect(screen.getByText(/ada@example.com/)).toBeTruthy();
    expect(screen.getByText(/Dein Wunsch ist da: Miles Davis – Kind of Blue/)).toBeTruthy();
  });

  it('notify-send calls notifyWishlistMatch once with the matchId then closes', async () => {
    const onClose = vi.fn();
    render(<NotifyModal match={pendingMatch} tenantName="Q-Records" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('notify-send'));
    await waitFor(() => expect(notifyWishlistMatch).toHaveBeenCalledTimes(1));
    expect(notifyWishlistMatch).toHaveBeenCalledWith({ matchId: 55 });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('notify-cancel closes without calling the action', () => {
    const onClose = vi.fn();
    render(<NotifyModal match={pendingMatch} tenantName="Q-Records" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('notify-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(notifyWishlistMatch).not.toHaveBeenCalled();
  });
});
```

**12. Run the test, expecting FAIL** (module `NotifyModal` does not exist):

```bash
pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: FAIL — `Failed to resolve import "@/app/(app)/wunschlisten/_components/NotifyModal"`.

**13. Minimal implementation — create `src/app/(app)/wunschlisten/_components/NotifyModal.tsx`:**

```tsx
'use client';

// src/app/(app)/wunschlisten/_components/NotifyModal.tsx
// Benachrichtigen-Modal (spec §5.5). The preview is READ-ONLY (CONTRACTS §0a delta 1 / C10):
// it renders the sendWishlistNotificationEmail copy verbatim; there is NO staff-editable body in Slice 3.
// "Senden" enqueues the notify job via notifyWishlistMatch (C11); the worker is the sole sender (C9.4).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PendingMatchRow } from '@/lib/wishlist';
import { notifyWishlistMatch } from '../actions';

export interface NotifyModalProps {
  match: PendingMatchRow;
  tenantName: string;
  onClose: () => void;
}

/** Read-only preview text mirroring the locked C10 sendWishlistNotificationEmail template
 *  (permalinkUrl omitted in Slice 3). Kept in sync with C10 by contract. */
function buildPreview(match: PendingMatchRow, tenantName: string): { subject: string; body: string } {
  const subject = `Dein Wunsch ist da: ${match.artist} – ${match.title}`;
  const body = [
    `Hallo ${match.customerName},`,
    '',
    `gute Nachrichten! Ein Titel von deiner Wunschliste ist bei ${tenantName} eingetroffen:`,
    '',
    `${match.artist} – ${match.title}`,
    '',
    'Komm gern vorbei oder melde dich, wenn du ihn reservieren möchtest.',
    '',
    'Viele Grüße',
    tenantName,
  ].join('\n');
  return { subject, body };
}

export function NotifyModal({ match, tenantName, onClose }: NotifyModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const { subject, body } = buildPreview(match, tenantName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSend = async () => {
    setError(null);
    setIsPending(true);
    try {
      const res = await notifyWishlistMatch({ matchId: match.matchId });
      if (res.ok) {
        onClose();
      } else {
        setError(res.message ?? 'Benachrichtigung fehlgeschlagen.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        padding: '16px',
        background: 'rgba(20,14,8,.42)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="notify-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          background: 'var(--surface-1)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--text-1)' }}>
          Kunde benachrichtigen
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>An: {match.customerEmail}</p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>Betreff: {subject}</p>

        {/* READ-ONLY rendered template — NOT an editable field (CONTRACTS §0a delta 1). */}
        <pre
          data-testid="notify-preview"
          style={{
            margin: 0,
            padding: '12px 14px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text-1)',
            fontFamily: 'inherit',
            fontSize: '13px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {body}
        </pre>

        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: '13px' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            data-testid="notify-cancel"
            onClick={onClose}
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="notify-send"
            onClick={handleSend}
            disabled={isPending}
            style={{
              padding: '9px 18px',
              borderRadius: 'var(--r-md)',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontWeight: 600,
              fontSize: '14px',
              cursor: isPending ? 'default' : 'pointer',
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? 'Sendet…' : 'Senden'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

**14. Run the test, expecting PASS:**

```bash
pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: PASS (`WishlistForm` + `WishlistList` + `NotifyModal` blocks green).

**15. Commit:**

```bash
git add tests/app/wunschlisten.component.test.tsx src/app/\(app\)/wunschlisten/_components/NotifyModal.tsx
git commit -m "feat(slice3): NotifyModal — read-only C10 preview + notifyWishlistMatch send (T12)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**16. Write the failing test — append the `MatchesSection` import + block** to
`tests/app/wunschlisten.component.test.tsx` (reuses the `pendingMatch` fixture from step 11):

```tsx
import { MatchesSection } from '@/app/(app)/wunschlisten/_components/MatchesSection';

describe('MatchesSection', () => {
  beforeEach(() => {
    dismissMatch.mockClear();
    dismissMatch.mockResolvedValue({ ok: true });
    notifyWishlistMatch.mockClear();
    notifyWishlistMatch.mockResolvedValue({ ok: true });
  });

  it('renders the section + a row with notify/dismiss controls keyed by matchId', () => {
    render(<MatchesSection matches={[pendingMatch]} tenantName="Q-Records" />);
    expect(screen.getByTestId('wishlist-matches')).toBeTruthy();
    expect(screen.getByTestId('wl-match-55')).toBeTruthy();
    expect(screen.getByTestId('wl-notify-55')).toBeTruthy();
    expect(screen.getByTestId('wl-dismiss-55')).toBeTruthy();
    expect(screen.getByText(/Miles Davis – Kind of Blue/)).toBeTruthy();
    // modal is not mounted until "Benachrichtigen" is clicked
    expect(screen.queryByTestId('notify-modal')).toBeNull();
  });

  it('wl-notify opens the NotifyModal for that match', () => {
    render(<MatchesSection matches={[pendingMatch]} tenantName="Q-Records" />);
    fireEvent.click(screen.getByTestId('wl-notify-55'));
    expect(screen.getByTestId('notify-modal')).toBeTruthy();
    expect(screen.getByTestId('notify-preview').textContent).toContain('Hallo Ada Lovelace');
  });

  it('wl-dismiss calls dismissMatch once with the matchId', async () => {
    render(<MatchesSection matches={[pendingMatch]} tenantName="Q-Records" />);
    fireEvent.click(screen.getByTestId('wl-dismiss-55'));
    await waitFor(() => expect(dismissMatch).toHaveBeenCalledTimes(1));
    expect(dismissMatch).toHaveBeenCalledWith({ matchId: 55 });
  });

  it('renders an empty hint when there are no pending matches', () => {
    render(<MatchesSection matches={[]} tenantName="Q-Records" />);
    expect(screen.getByTestId('wishlist-matches')).toBeTruthy();
    expect(screen.getByText(/Keine offenen Treffer/)).toBeTruthy();
  });
});
```

**17. Run the test, expecting FAIL** (module `MatchesSection` does not exist):

```bash
pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: FAIL — `Failed to resolve import "@/app/(app)/wunschlisten/_components/MatchesSection"`.

**18. Minimal implementation — create `src/app/(app)/wunschlisten/_components/MatchesSection.tsx`:**

```tsx
'use client';

// src/app/(app)/wunschlisten/_components/MatchesSection.tsx
// "Offene Treffer" section (spec §5.4): each pending wishlist_match → Benachrichtigen (opens NotifyModal)
// + Verwerfen (dismissMatch, C11). Source: PendingMatchRow[] (C8 listPendingMatches).

import { useState } from 'react';
import type { PendingMatchRow } from '@/lib/wishlist';
import { dismissMatch } from '../actions';
import { NotifyModal } from './NotifyModal';

export interface MatchesSectionProps {
  matches: PendingMatchRow[];
  tenantName: string;
}

export function MatchesSection({ matches, tenantName }: MatchesSectionProps) {
  const [selected, setSelected] = useState<PendingMatchRow | null>(null);
  const [dismissing, setDismissing] = useState<number | null>(null);

  const handleDismiss = async (matchId: number) => {
    setDismissing(matchId);
    try {
      await dismissMatch({ matchId });
    } finally {
      setDismissing(null);
    }
  };

  return (
    <section
      data-testid="wishlist-matches"
      style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--text-1)' }}>
        Offene Treffer
      </h2>

      {matches.length === 0 ? (
        <p style={{ color: 'var(--text-2)', fontSize: '14px', margin: 0 }}>Keine offenen Treffer.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {matches.map((m) => (
            <li
              key={m.matchId}
              data-testid={`wl-match-${m.matchId}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '12px 14px',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--accent-soft-border)',
                background: 'var(--honey-soft)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: '14px' }}>
                  {m.artist} – {m.title}
                </span>
                <span style={{ color: 'var(--text-2)', fontSize: '13px' }}>
                  {m.customerName} · {m.customerEmail}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button
                  type="button"
                  data-testid={`wl-notify-${m.matchId}`}
                  onClick={() => setSelected(m)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--r-md)',
                    border: 'none',
                    background: 'var(--accent)',
                    color: 'var(--on-accent)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Benachrichtigen
                </button>
                <button
                  type="button"
                  data-testid={`wl-dismiss-${m.matchId}`}
                  onClick={() => handleDismiss(m.matchId)}
                  disabled={dismissing === m.matchId}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border-strong)',
                    background: 'var(--surface-2)',
                    color: 'var(--text-1)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: dismissing === m.matchId ? 'default' : 'pointer',
                    opacity: dismissing === m.matchId ? 0.6 : 1,
                  }}
                >
                  Verwerfen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <NotifyModal match={selected} tenantName={tenantName} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}
```

**19. Run the test, expecting PASS:**

```bash
pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: PASS (all four component blocks green).

**20. Commit:**

```bash
git add tests/app/wunschlisten.component.test.tsx src/app/\(app\)/wunschlisten/_components/MatchesSection.tsx
git commit -m "feat(slice3): MatchesSection — pending treffer with notify/dismiss (T12)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**21. Wire the screen — replace `src/app/(app)/wunschlisten/page.tsx`** (RSC data-loader; no vitest test —
`requireSession`/RSC cannot be RTL-rendered, mirroring the kasse `page.tsx`; the `wishlist-screen` root and
full wiring are exercised by **T14** E2E). Overwrite the placeholder with:

```tsx
// src/app/(app)/wunschlisten/page.tsx
// RSC: auth + staff gate → load wishlists + pending matches → render the Wunschlisten screen (spec §5.4/§5.5).

import { requireSession } from '@/auth/session';
import { forbidden } from 'next/navigation';
import { getCurrentTenant } from '@/lib/tenant';
import { listWishlists, listPendingMatches } from '@/lib/wishlist';
import { WishlistForm } from './_components/WishlistForm';
import { WishlistList } from './_components/WishlistList';
import { MatchesSection } from './_components/MatchesSection';

export default async function WunschlistenPage() {
  const user = await requireSession();
  // Staff gate (spec §5.7): wishlists are not customer-facing.
  if (user.role === 'kunde') forbidden();

  const tenant = await getCurrentTenant();
  const ctx = { tenantId: tenant.id, userId: user.id };
  const [wishlists, matches] = await Promise.all([listWishlists(ctx), listPendingMatches(ctx)]);

  return (
    <div
      data-testid="wishlist-screen"
      style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(20px,3vw,26px)',
            letterSpacing: '-.02em',
            margin: 0,
          }}
        >
          Wunschlisten
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: '15px', margin: 0 }}>
          Kundenwünsche erfassen und bei passendem Ankauf benachrichtigen.
        </p>
      </header>

      <WishlistForm />
      <MatchesSection matches={matches} tenantName={tenant.name} />
      <WishlistList wishlists={wishlists} />
    </div>
  );
}
```

**22. Verify the wiring compiles + the whole suite still passes** (typecheck is the real gate for the RSC —
it proves `listWishlists`/`listPendingMatches`/`getCurrentTenant` imports resolve and the component props
type-match; then re-run the component file):

```bash
pnpm typecheck && pnpm test tests/app/wunschlisten.component.test.tsx
```
Expected: typecheck exits 0; component tests PASS.

**23. Commit:**

```bash
git add src/app/\(app\)/wunschlisten/page.tsx
git commit -m "feat(slice3): wunschlisten page — wishlist-screen wiring (form + matches + list) (T12)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

#### Done-when

- `tests/app/wunschlisten.component.test.tsx` green: `WishlistForm` (fields, prefill, trimmed-payload submit
  with empty optionals → null, error path), `WishlistList` (status labels + empty hint), `NotifyModal`
  (read-only C10 preview, send-once + close, cancel without action), `MatchesSection` (testids, modal open,
  dismiss-once, empty hint).
- All C12 testids present verbatim: `wishlist-screen`, `wishlist-form`, `wl-customer-name`,
  `wl-customer-email`, `wl-artist`, `wl-label`, `wl-title`, `wl-country`, `wishlist-submit`,
  `wishlist-matches`, `wl-match-<id>`, `wl-notify-<id>`, `wl-dismiss-<id>`, `notify-modal`, `notify-preview`,
  `notify-send`, `notify-cancel`. No invented testids.
- `notify-preview` is read-only (no `textbox` role); side-effecting action calls asserted by call-count + args
  (non-vacuous). Semantic tokens only (`var(--accent)` / `var(--on-accent)`; no `--accent-ink`, no raw hex).
- `pnpm typecheck` clean.

### Task 13: Navigation + seed

Surfaces the two new Slice-3 screens in the app shell and gives the demo tenant the data the E2E suite (T14)
needs. Two independent deliverables:

1. **Navigation** — add a `Kasse` entry (lucide `ShoppingCart`) to `SidebarNav`, and staff-gate BOTH `Kasse`
   and the existing `Wunschlisten` entry so a `kunde` never sees them. The gate is data-driven: `SidebarNav`
   gains a `role: Role` prop, marks staff-only items with a `staffOnly` flag, and filters them out unless
   `role !== 'kunde'` (i.e. role ∈ {`mitarbeiter`,`admin`,`superadmin`}). `layout.tsx` passes `user.role`.
2. **Seed** — `scripts/seed.ts` gains idempotent `ensureQuickItem` / `ensureWishlist` helpers + a
   `seedTenantSales` wrapper, demo datasets (`DEMO_QUICK_ITEMS`, `DEMO_WISHLISTS`), and a `main()` call that
   seeds the demo tenant with example `quick_items` and ≥1 OPEN wishlist whose `artist` matches a seeded
   record (so a matching Ankauf in T14 produces a `pending` `wishlist_matches` row).

References: spec §5.7 (Navigation), §8 (Seed) · BUILD-CONTEXT T13 · CONTRACTS C12 (testid registry — note nav
links are NOT testids, select by accessible name), C14-T13 (file map), consuming C1 (`Role`), C2
(`quickItems`, `wishlists` tables).

**Depends on:** T1 (schema/RLS — `quick_items` + `wishlists` tables must exist for the seed helpers + their
integration test). The nav half depends only on the existing `Role` type. This task creates NO new screens —
the `Kasse` route page is T10, the `Wunschlisten` screen is T12; T13 only links to them.

**Scope guard:** do NOT introduce any new `var(--accent-ink)` usage (lesson #4). `SidebarNav` already
references `--accent-ink` for its active-link styling; that EXISTING usage is preserved verbatim, but no new
occurrence is added. Do NOT add `data-testid`s to nav links — they are outside the frozen C12 registry; tests
select links by their accessible name.

---

#### Files

- **Modify** `src/app/(app)/_components/SidebarNav.tsx` — add `Kasse` (lucide `ShoppingCart`) entry, a
  `staffOnly` flag on `Kasse` + `Wunschlisten`, a `role: Role` prop, and staff filtering.
- **Modify** `src/app/(app)/layout.tsx` — pass `role={user.role}` to `<SidebarNav />`.
- **Modify** `scripts/seed.ts` — `ensureQuickItem`, `ensureWishlist`, `seedTenantSales` (exported, idempotent),
  `DEMO_QUICK_ITEMS` + `DEMO_WISHLISTS` datasets, and a `main()` call seeding the demo tenant.
- **Test (create)** `tests/ui/sidebar-nav.test.tsx` — role gating: staff sees `Kasse`/`Wunschlisten`, `kunde`
  does not; non-gated items always present.
- **Test (create)** `tests/seed-sales.integration.test.ts` — Testcontainers: `seedTenantSales` inserts active
  quick items + an OPEN wishlist; idempotent on re-run; the seeded wishlist's `artist` matches a seeded record
  (E2E match precondition).

---

#### Interfaces

**Consumes from earlier tasks (copy verbatim):**

```ts
// @/db/schema (C1) — existing role enum + type
export type Role = (typeof roleEnum.enumValues)[number]; // 'superadmin'|'admin'|'mitarbeiter'|'kunde'

// @/db/schema (T1, C2) — new tables this task seeds
export const quickItems; // columns: id, tenantId, name, price (numeric string), active (bool, default true), createdAt
export const wishlists;  // columns: id, tenantId, createdByUserId, customerName, customerEmail, artist,
                         //          label?, title?, country?, status ('open'|'notified'|'closed', default 'open'), createdAt

// @/auth/session (existing) — used by layout.tsx
export type SessionUser = { id: number; email: string; tenantId: number; role: Role; isSuperadmin: boolean };

// tests/helpers/db (existing) — Testcontainers fixture
export async function seedTenant(input: { slug: string; name: string }): Promise<{ tenantId: number; adminUserId: number }>;

// scripts/seed.ts (existing) — reused by the seed integration test
export async function seedTenantInventory(
  ownerPool: Pool, tenantId: number, records: RecordSeed[], purchases: PurchaseSpec[], permalinks: PermalinkSpec[],
): Promise<void>;
export const DEMO_RECORDS: RecordSeed[]; // contains records by 'Miles Davis' (the wishlist match target)
```

**Produces for later tasks (copy verbatim):**

```ts
// src/app/(app)/_components/SidebarNav.tsx
export function SidebarNav({ role }: { role: Role }): JSX.Element;

// scripts/seed.ts — exported so the integration test + T14 can drive them
export const DEMO_QUICK_ITEMS: { name: string; price: string }[];
export const DEMO_WISHLISTS: {
  customerName: string; customerEmail: string; artist: string;
  label?: string | null; title?: string | null; country?: string | null;
}[];
export async function ensureQuickItem(
  ownerPool: Pool, input: { tenantId: number; name: string; price: string },
): Promise<void>;
export async function ensureWishlist(
  ownerPool: Pool,
  input: {
    tenantId: number; createdByUserId: number; customerName: string; customerEmail: string;
    artist: string; label?: string | null; title?: string | null; country?: string | null;
  },
): Promise<void>;
export async function seedTenantSales(
  ownerPool: Pool,
  tenantId: number,
  quickItems: { name: string; price: string }[],
  wishlists: {
    customerName: string; customerEmail: string; artist: string;
    label?: string | null; title?: string | null; country?: string | null;
  }[],
): Promise<void>;
```

---

#### Steps

**Block A — Navigation (staff-gated `Kasse` + `Wunschlisten`)**

1. **Write the failing component test.** Create `tests/ui/sidebar-nav.test.tsx` with this exact content:

   ```tsx
   // tests/ui/sidebar-nav.test.tsx
   // @vitest-environment jsdom

   /// <reference types="@testing-library/jest-dom/vitest" />

   import { describe, it, expect, afterEach, vi } from 'vitest';
   import { render, screen, cleanup } from '@testing-library/react';

   // SidebarNav is a client component that reads the active route via usePathname.
   vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

   import { SidebarNav } from '@/app/(app)/_components/SidebarNav';

   afterEach(cleanup);

   describe('SidebarNav role gating', () => {
     it('shows Kasse and Wunschlisten for staff (mitarbeiter)', () => {
       render(<SidebarNav role="mitarbeiter" />);
       expect(screen.getByRole('link', { name: 'Kasse' })).toBeInTheDocument();
       expect(screen.getByRole('link', { name: 'Wunschlisten' })).toBeInTheDocument();
     });

     it('shows Kasse and Wunschlisten for admin', () => {
       render(<SidebarNav role="admin" />);
       expect(screen.getByRole('link', { name: 'Kasse' })).toBeInTheDocument();
       expect(screen.getByRole('link', { name: 'Wunschlisten' })).toBeInTheDocument();
     });

     it('hides Kasse and Wunschlisten for a kunde', () => {
       render(<SidebarNav role="kunde" />);
       expect(screen.queryByRole('link', { name: 'Kasse' })).toBeNull();
       expect(screen.queryByRole('link', { name: 'Wunschlisten' })).toBeNull();
     });

     it('always shows the non-gated items regardless of role', () => {
       render(<SidebarNav role="kunde" />);
       expect(screen.getByRole('link', { name: 'Übersicht' })).toBeInTheDocument();
       expect(screen.getByRole('link', { name: 'Lagerbestand' })).toBeInTheDocument();
       expect(screen.getByRole('link', { name: 'Schaufenster' })).toBeInTheDocument();
       expect(screen.getByRole('link', { name: 'Analytik' })).toBeInTheDocument();
     });

     it('links Kasse to /kasse', () => {
       render(<SidebarNav role="mitarbeiter" />);
       expect(screen.getByRole('link', { name: 'Kasse' })).toHaveAttribute('href', '/kasse');
     });
   });
   ```

2. **Run it, expecting FAIL** (the current `SidebarNav` takes no `role` prop and has no `Kasse` entry, so the
   `Kasse` queries find nothing and `role="kunde"` still renders `Wunschlisten`):

   ```
   pnpm test tests/ui/sidebar-nav.test.tsx
   ```
   Expected: failures — `getByRole('link', { name: 'Kasse' })` throws (no such link), and the `kunde`
   hide-case fails because `Wunschlisten` is still rendered.

3. **Implement the gated nav.** Replace the entire contents of
   `src/app/(app)/_components/SidebarNav.tsx` with this exact content:

   ```tsx
   // src/app/(app)/_components/SidebarNav.tsx
   'use client';

   import Link from 'next/link';
   import { usePathname } from 'next/navigation';
   import {
     LayoutDashboard,
     Package,
     ShoppingCart,
     Heart,
     Store,
     BarChart3,
     type LucideIcon,
   } from 'lucide-react';
   import type { Role } from '@/db/schema';

   type NavItem = {
     href: string;
     label: string;
     Icon: LucideIcon;
     /** Visible only to staff (role ∈ {mitarbeiter, admin, superadmin}); hidden from `kunde`. */
     staffOnly?: boolean;
   };

   const NAV_ITEMS: NavItem[] = [
     { href: '/',             label: 'Übersicht',    Icon: LayoutDashboard                    },
     { href: '/inventar',     label: 'Lagerbestand', Icon: Package                            },
     { href: '/kasse',        label: 'Kasse',        Icon: ShoppingCart, staffOnly: true      },
     { href: '/wunschlisten', label: 'Wunschlisten', Icon: Heart,        staffOnly: true      },
     { href: '/schaufenster', label: 'Schaufenster', Icon: Store                              },
     { href: '/analytik',     label: 'Analytik',     Icon: BarChart3                          },
   ];

   export function SidebarNav({ role }: { role: Role }) {
     const pathname = usePathname();
     const isStaff = role !== 'kunde';
     const items = NAV_ITEMS.filter((item) => !item.staffOnly || isStaff);

     return (
       <nav aria-label="Hauptnavigation" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
         {items.map(({ href, label, Icon }) => {
           // Exact match for dashboard, prefix match for others
           const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
           return (
             <Link
               key={href}
               href={href}
               aria-current={isActive ? 'page' : undefined}
               style={{
                 display: 'flex',
                 alignItems: 'center',
                 gap: '12px',
                 minHeight: 'var(--tap)',
                 padding: '0 14px',
                 borderRadius: 'var(--r-md)',
                 background: isActive ? 'var(--accent-soft)' : 'transparent',
                 color: isActive ? 'var(--accent-ink)' : 'var(--text-2)',
                 fontWeight: isActive ? 700 : 600,
                 fontSize: '14.5px',
                 textDecoration: 'none',
                 borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                 transition: 'background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)',
               }}
             >
               <Icon size={18} aria-hidden="true" />
               {label}
             </Link>
           );
         })}
       </nav>
     );
   }
   ```

   Then wire the prop in `src/app/(app)/layout.tsx`: replace the existing nav render line

   ```tsx
           {/* Nav — client component (needs usePathname for active state) */}
           <SidebarNav />
   ```

   with (passes the session role so the layout server component decides staff visibility):

   ```tsx
           {/* Nav — client component (needs usePathname for active state).
               Pass the session role so Kasse + Wunschlisten are staff-gated (kunde never sees them). */}
           <SidebarNav role={user.role} />
   ```

4. **Run the component test, expecting PASS, and typecheck:**

   ```
   pnpm test tests/ui/sidebar-nav.test.tsx && pnpm typecheck
   ```
   Expected: all 5 SidebarNav cases pass (staff sees both gated links; `kunde` sees neither; non-gated items
   always present; `Kasse` → `/kasse`); `tsc --noEmit` reports no errors (the `role` prop on `<SidebarNav />`
   in `layout.tsx` now type-checks against `SessionUser.role`).

5. **Commit:**

   ```
   git add "src/app/(app)/_components/SidebarNav.tsx" "src/app/(app)/layout.tsx" tests/ui/sidebar-nav.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(slice3): staff-gated Kasse + Wunschlisten nav entries

   SidebarNav gains a role prop and a staffOnly flag; Kasse (lucide ShoppingCart)
   and Wunschlisten are hidden from kunde (visible only to mitarbeiter/admin/
   superadmin). layout.tsx passes user.role. No new --accent-ink usage; nav links
   carry no testids (outside the frozen registry) and are selected by accessible name.

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

**Block B — Seed demo `quick_items` + matching open wishlist**

6. **Write the failing seed integration test.** Create `tests/seed-sales.integration.test.ts` with this exact
   content:

   ```ts
   // tests/seed-sales.integration.test.ts
   import { afterAll, beforeAll, describe, expect, it } from 'vitest';
   import { Pool } from 'pg';
   import { setupTestDatabase, seedTenant } from './helpers/db';
   import type { TestDatabase } from './helpers/db';

   let testDb: TestDatabase;
   let ownerPool: Pool;

   async function counts(pool: Pool, tenantId: number) {
     const r = await pool.query<{ quick: string; quick_active: string; wishlists: string; open: string }>(
       `SELECT
          (SELECT COUNT(*) FROM quick_items WHERE tenant_id = $1)                       AS quick,
          (SELECT COUNT(*) FROM quick_items WHERE tenant_id = $1 AND active = true)     AS quick_active,
          (SELECT COUNT(*) FROM wishlists   WHERE tenant_id = $1)                       AS wishlists,
          (SELECT COUNT(*) FROM wishlists   WHERE tenant_id = $1 AND status = 'open')   AS open`,
       [tenantId],
     );
     const row = r.rows[0]!;
     return {
       quick: Number(row.quick),
       quickActive: Number(row.quick_active),
       wishlists: Number(row.wishlists),
       open: Number(row.open),
     };
   }

   describe('Seed sales/wishlist data', () => {
     beforeAll(async () => {
       testDb = await setupTestDatabase();
       ownerPool = new Pool({ connectionString: testDb.ownerUrl });
     }, 60_000);

     afterAll(async () => {
       await ownerPool.end();
       await testDb.teardown();
     });

     it('exports seedTenantSales, ensureQuickItem, ensureWishlist and the datasets', async () => {
       const m = await import('../scripts/seed');
       expect(typeof m.seedTenantSales).toBe('function');
       expect(typeof m.ensureQuickItem).toBe('function');
       expect(typeof m.ensureWishlist).toBe('function');
       expect(Array.isArray(m.DEMO_QUICK_ITEMS)).toBe(true);
       expect(m.DEMO_QUICK_ITEMS.length).toBeGreaterThan(0);
       expect(Array.isArray(m.DEMO_WISHLISTS)).toBe(true);
       expect(m.DEMO_WISHLISTS.length).toBeGreaterThan(0);
     });

     it('seeds active quick items + at least one OPEN wishlist; idempotent on re-run', async () => {
       const { seedTenantSales, DEMO_QUICK_ITEMS, DEMO_WISHLISTS } = await import('../scripts/seed');
       const { tenantId } = await seedTenant({ slug: 'sales-seed', name: 'Sales Seed' });

       await seedTenantSales(ownerPool, tenantId, DEMO_QUICK_ITEMS, DEMO_WISHLISTS);
       const c1 = await counts(ownerPool, tenantId);

       expect(c1.quick).toBe(DEMO_QUICK_ITEMS.length);
       expect(c1.quickActive).toBe(DEMO_QUICK_ITEMS.length); // every seeded quick item is active
       expect(c1.wishlists).toBe(DEMO_WISHLISTS.length);
       expect(c1.open).toBe(DEMO_WISHLISTS.length); // default status 'open'

       // Re-run must not duplicate (idempotent ensure* helpers).
       await seedTenantSales(ownerPool, tenantId, DEMO_QUICK_ITEMS, DEMO_WISHLISTS);
       const c2 = await counts(ownerPool, tenantId);
       expect(c2).toEqual(c1);
     }, 60_000);

     it('a seeded wishlist artist matches a seeded record (E2E match precondition)', async () => {
       const { seedTenantInventory, seedTenantSales, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS, DEMO_WISHLISTS } =
         await import('../scripts/seed');
       const { tenantId } = await seedTenant({ slug: 'sales-match', name: 'Sales Match' });

       await seedTenantInventory(ownerPool, tenantId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);
       await seedTenantSales(ownerPool, tenantId, [], DEMO_WISHLISTS);

       // For at least one open wishlist there is a record whose artist (ci) CONTAINS the wishlist artist —
       // exactly the rule handleWishlistMatch (T7) applies, so a matching Ankauf in T14 will produce a pending row.
       const r = await ownerPool.query<{ n: string }>(
         `SELECT COUNT(*) AS n
            FROM wishlists w
            JOIN records  rec
              ON rec.tenant_id = w.tenant_id
             AND lower(rec.artist) LIKE '%' || lower(w.artist) || '%'
           WHERE w.tenant_id = $1 AND w.status = 'open'`,
         [tenantId],
       );
       expect(Number(r.rows[0]!.n)).toBeGreaterThan(0);
     }, 60_000);
   });
   ```

7. **Run it, expecting FAIL** (`scripts/seed` exports none of `seedTenantSales`/`ensureQuickItem`/
   `ensureWishlist`/`DEMO_QUICK_ITEMS`/`DEMO_WISHLISTS` yet):

   ```
   pnpm test tests/seed-sales.integration.test.ts
   ```
   Expected: the export test fails (`typeof m.seedTenantSales` is `'undefined'`); the behaviour tests throw
   `TypeError: seedTenantSales is not a function`.

8. **Implement the seed additions** in `scripts/seed.ts`. Three edits:

   8a. Add the demo datasets immediately after the `DEMO_PERMALINKS` declaration (after the
   `export const DEMO_PERMALINKS: PermalinkSpec[] = [ ... ];` block):

   ```ts
   // ── Slice 3: POS quick items + a matching open wishlist (demo tenant) ───────
   // Non-inventory catalogue buttons for the Kasse screen.
   export const DEMO_QUICK_ITEMS: { name: string; price: string }[] = [
     { name: 'Kaffee',        price: '2.50' },
     { name: 'Plattentasche', price: '1.00' },
   ];

   // ≥1 OPEN wishlist whose `artist` matches a DEMO_RECORDS entry ('Miles Davis' → Kind of Blue / Bitches
   // Brew / Sketches of Spain), so a matching Ankauf in the E2E flow (T14) produces a pending wishlist_matches row.
   export const DEMO_WISHLISTS: {
     customerName: string;
     customerEmail: string;
     artist: string;
     label?: string | null;
     title?: string | null;
     country?: string | null;
   }[] = [
     { customerName: 'Klaus Wunsch', customerEmail: 'klaus.wunsch@example.test', artist: 'Miles Davis' },
   ];
   ```

   8b. Add the idempotent helpers + the `seedTenantSales` wrapper immediately after the existing
   `seedTenantInventory` function (after its closing `}`):

   ```ts
   /**
    * Idempotent quick-item insert. Skip if (tenantId, name) already exists.
    * Seeded items are active (default) so they render as Kasse buttons.
    */
   export async function ensureQuickItem(
     ownerPool: Pool,
     input: { tenantId: number; name: string; price: string },
   ): Promise<void> {
     const db = drizzle(ownerPool, { schema });

     const existing = await db
       .select({ id: schema.quickItems.id })
       .from(schema.quickItems)
       .where(and(eq(schema.quickItems.tenantId, input.tenantId), eq(schema.quickItems.name, input.name)))
       .limit(1);

     if (existing.length > 0) {
       return; // already seeded
     }

     await db.insert(schema.quickItems).values({
       tenantId: input.tenantId,
       name: input.name,
       price: input.price,
     });

     console.log(`[seed]   Quick item "${input.name}" (€${input.price}) created.`);
   }

   /**
    * Idempotent wishlist insert. Skip if (tenantId, customerEmail, artist) already exists.
    * Inserts with the default status 'open'. createdByUserId must be a real users.id of the tenant.
    */
   export async function ensureWishlist(
     ownerPool: Pool,
     input: {
       tenantId: number;
       createdByUserId: number;
       customerName: string;
       customerEmail: string;
       artist: string;
       label?: string | null;
       title?: string | null;
       country?: string | null;
     },
   ): Promise<void> {
     const db = drizzle(ownerPool, { schema });

     const existing = await db
       .select({ id: schema.wishlists.id })
       .from(schema.wishlists)
       .where(
         and(
           eq(schema.wishlists.tenantId, input.tenantId),
           eq(schema.wishlists.customerEmail, input.customerEmail),
           eq(schema.wishlists.artist, input.artist),
         ),
       )
       .limit(1);

     if (existing.length > 0) {
       return; // already seeded
     }

     await db.insert(schema.wishlists).values({
       tenantId: input.tenantId,
       createdByUserId: input.createdByUserId,
       customerName: input.customerName,
       customerEmail: input.customerEmail,
       artist: input.artist,
       label: input.label ?? null,
       title: input.title ?? null,
       country: input.country ?? null,
     });

     console.log(`[seed]   Wishlist for "${input.customerName}" (artist=${input.artist}) created.`);
   }

   /**
    * Resolves the tenant's admin user id (wishlists.createdByUserId is NOT NULL → needs a real user).
    */
   async function tenantAdminUserId(tenantId: number, ownerPool: Pool): Promise<number> {
     const db = drizzle(ownerPool, { schema });
     const rows = await db
       .select({ id: schema.users.id })
       .from(schema.users)
       .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'admin')))
       .limit(1);
     if (!rows[0]) {
       throw new Error(`[seed] no admin user found for tenant ${tenantId} (cannot set wishlists.createdByUserId)`);
     }
     return rows[0].id;
   }

   /**
    * Seeds quick items + wishlists for a tenant. Wishlists are attributed to the tenant's admin user.
    * Exported so integration tests can call it directly with a testcontainer ownerPool.
    */
   export async function seedTenantSales(
     ownerPool: Pool,
     tenantId: number,
     quickItems: { name: string; price: string }[],
     wishlists: {
       customerName: string;
       customerEmail: string;
       artist: string;
       label?: string | null;
       title?: string | null;
       country?: string | null;
     }[],
   ): Promise<void> {
     for (const qi of quickItems) {
       await ensureQuickItem(ownerPool, { tenantId, name: qi.name, price: qi.price });
     }
     if (wishlists.length > 0) {
       const createdByUserId = await tenantAdminUserId(tenantId, ownerPool);
       for (const wl of wishlists) {
         await ensureWishlist(ownerPool, { tenantId, createdByUserId, ...wl });
       }
     }
   }
   ```

   8c. Wire the demo seed into `main()`. In the `// ── demo tenant ──` block of `main()`, immediately after
   the existing `await ensureDiscogsConnection(ownerPool, { ... });` call (and before the
   `// ── vinylcave tenant ──` block), insert:

   ```ts
       // POS quick items + a matching open wishlist — DEMO tenant ONLY (drives the Slice-3 E2E flow).
       console.log(`[seed] Seeding quick items + wishlists for "${DEMO_TENANT.slug}"...`);
       await seedTenantSales(ownerPool, demoId, DEMO_QUICK_ITEMS, DEMO_WISHLISTS);
   ```

9. **Run the seed integration test, expecting PASS, and typecheck:**

   ```
   pnpm test tests/seed-sales.integration.test.ts && pnpm typecheck
   ```
   Expected: all 3 cases pass — exports present; quick items + one open wishlist seeded with idempotent
   re-run counts equal; the seeded `Miles Davis` wishlist matches a seeded record (`COUNT > 0`). `tsc --noEmit`
   clean (the new `schema.quickItems`/`schema.wishlists` references resolve against the T1 schema).

10. **Commit:**

    ```
    git add scripts/seed.ts tests/seed-sales.integration.test.ts
    git commit -m "$(cat <<'EOF'
    feat(slice3): seed demo quick_items + matching open wishlist

    Adds idempotent ensureQuickItem/ensureWishlist + seedTenantSales wrapper and
    DEMO_QUICK_ITEMS/DEMO_WISHLISTS. The demo tenant gets Kasse quick buttons and an
    OPEN 'Miles Davis' wishlist that matches a seeded record, so the T14 Ankauf flow
    produces a pending wishlist_matches row. Integration test proves idempotency and
    the wishlist↔record match precondition.

    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
    EOF
    )"
    ```

---

#### Notes / lessons honored

- **Semantic tokens (lesson #4):** the rewritten `SidebarNav` introduces NO new `var(--accent-ink)` —
  the single pre-existing active-link usage is preserved verbatim. The new `Kasse` icon uses lucide
  `ShoppingCart`; no raw hex is added.
- **Testid discipline (C12):** nav links are deliberately NOT given `data-testid`s (they are outside the
  frozen registry). The component test selects links by accessible name (`getByRole('link', { name })`), and
  the route assertion checks `href`.
- **Idempotent seed (existing convention):** `ensureQuickItem`/`ensureWishlist` mirror the existing
  `ensurePurchase`/`ensurePermalink` skip-if-exists shape; the integration test runs `seedTenantSales` twice
  and asserts counts are unchanged, so `pnpm db:seed` stays safe to re-run.
- **Non-vacuous match seed:** the third test does not merely assert a row was inserted — it joins
  `wishlists → records` with the exact case-insensitive substring rule `handleWishlistMatch` (T7) uses and
  asserts a match exists, proving the E2E precondition rather than trivially passing.
- **NOT NULL FK respected:** `wishlists.createdByUserId` is NOT NULL → `seedTenantSales` resolves the tenant's
  admin `users.id` before inserting (fail-fast if no admin user exists), rather than guessing an id.
- **Scope guard:** this task only links to `/kasse` and `/wunschlisten` and seeds data; the route pages are
  built in T10 (Kasse) and T12 (Wunschlisten). No new screen is created here.
- **Depends on T1:** the seed helpers reference `schema.quickItems` / `schema.wishlists`; the integration test
  needs those tables to exist in the Testcontainers DB, so T13 runs after T1's migrations land.

### Task 14: E2E sales+wishlist

The consequential whole-flow acceptance gate for Slice 3, run against the docker-compose stack
(`db → migrate → seed → web + worker + mailpit`, all with `DISCOGS_DRIVER=fake` and `MAIL_DRIVER=mailpit`
from `.env.compose`). Five scenarios, each asserting real server-side state (via `dbQuery`) in addition to
the UI, because several Slice-3 effects (sold status, transaction rows, async wishlist match + notify mail)
have no single UI surface that proves them end-to-end.

References: spec §8 (E2E + seed precondition) · BUILD-CONTEXT T14 · CONTRACTS C12 (the FROZEN testid registry
— every `data-testid` used below is from it; controls without a registry testid are selected by accessible
name/label, never by an invented testid). Consumes the seed datasets from T13
(`DEMO_QUICK_ITEMS` = Kaffee/Plattentasche; `DEMO_WISHLISTS` = the OPEN `Miles Davis` wishlist for
`klaus.wunsch@example.test`) and the Slice-2 Ankauf flow + fake driver (search `blue` → `Kind of Blue` by
**Miles Davis** + `Blue Lines`).

**Depends on:** T1–T13 (this is the final integration gate). The stack must be freshly built so the seed runs
(`docker compose up -d --build`).

**Determinism notes (locked):**
- The fake Discogs driver returns `Kind of Blue` (artist **Miles Davis**) for the query `blue`. Ankaufing it
  creates a NEW purchase whose record artist is `Miles Davis`, which the case-insensitive substring rule in
  `handleWishlistMatch` (T7) matches against the seeded OPEN `Miles Davis` wishlist → one `pending`
  `wishlist_matches` row. (Record-hash dedup against a seeded Miles Davis record is irrelevant: a new
  purchase is always inserted, and the match is per-purchase.)
- At stack start the seeded wishlist has ZERO matches (matches are only ever created by the async match JOB,
  which only runs on a new Ankauf — never by the direct seed inserts).
- Async worker steps (match creation, notify mail) are awaited with `expect.poll` (reload / re-query), never
  a fixed sleep.

---

#### Files

- **Create** `e2e/sales-wishlist.spec.ts` — the five-scenario acceptance suite.
- **Modify** `e2e/helpers.ts` — add a tiny Mailpit query helper (`mailpitMessages`) + a sales-state query
  helper (`salesCounts`) so the spec stays declarative. No change to existing exports.

---

#### Interfaces

**Consumes from earlier tasks / existing code (copy verbatim):**

```ts
// e2e/helpers.ts (existing) — reused as-is
export const DEMO_URL: string;            // 'http://demo.localhost:3000'
export const DEMO_EMAIL: string;          // 'admin@demo.test'
export const DEMO_PASSWORD: string;       // 'E2eDevPassword1!'
export const MAILPIT_API: string;         // 'http://localhost:8025/api/v1'
export const DEMO_JAZZ_SLUG: string;      // 'jazz' (public permalink)
export async function login(page: Page, baseUrl: string, email: string, password: string): Promise<void>;
export async function dbQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
export async function demoTenantId(): Promise<number>;
export async function assertNoPrivateFields(page: Page): Promise<void>;

// C12 testid registry (FROZEN) — used below verbatim:
//  Kasse:  kasse-screen, kasse-inventory-search, kasse-quick-item-<id>, kasse-adhoc-add,
//          kasse-cart, kasse-cart-item-<key>, kasse-discount-input, kasse-discount-mode,
//          kasse-pay-<method>, voucher-code-input, kasse-total, kasse-submit
//  Sell:   sell-modal, sell-price-input, sell-pay-<method>, sell-submit, sell-cancel
//  Reserve:reserve-action, reserve-cancel-action
//  Wish:   wishlist-screen, wishlist-form, wl-customer-name, wl-customer-email, wl-artist, wl-label,
//          wl-title, wl-country, wishlist-submit, wishlist-matches, wl-match-<id>, wl-notify-<id>,
//          wl-dismiss-<id>, notify-modal, notify-preview, notify-send, notify-cancel, add-to-wishlist
//  Slice-2 Ankauf (existing): discogs-search-form, discogs-results, discogs-result-card, ankauf-open,
//          ankauf-modal, ek-input, ankauf-submit
```

**Produces for later tasks:** none (terminal task). The two new helpers are E2E-internal.

---

#### Steps

**Block A — Helpers**

1. **Add the helpers to `e2e/helpers.ts`** (append at end of file). Exact content:

   ```ts
   // ── Slice-3 additions (Task 14) ─────────────────────────────────────────────

   /** A Mailpit message shape (subset of its API). */
   export interface MailpitMessage {
     ID: string;
     Subject: string;
     To: Array<{ Address: string }>;
   }

   /** Fetch the current Mailpit inbox (newest first). Used to assert wishlist notification mail. */
   export async function mailpitMessages(
     request: import('@playwright/test').APIRequestContext,
   ): Promise<MailpitMessage[]> {
     const res = await request.get(`${MAILPIT_API}/messages`);
     if (!res.ok()) return [];
     const body = (await res.json()) as { messages?: MailpitMessage[] };
     return body.messages ?? [];
   }

   /** Per-tenant sales counters straight from the DB (no UI surface proves these alone). */
   export async function salesCounts(tenantId: number): Promise<{
     transactions: number;
     verkauft: number;
     reserviert: number;
     pendingMatches: number;
     notifiedMatches: number;
   }> {
     const rows = await dbQuery<{
       transactions: string; verkauft: string; reserviert: string; pending: string; notified: string;
     }>(
       `SELECT
          (SELECT COUNT(*) FROM transactions     WHERE tenant_id = $1)                                AS transactions,
          (SELECT COUNT(*) FROM purchases        WHERE tenant_id = $1 AND status = 'verkauft')        AS verkauft,
          (SELECT COUNT(*) FROM purchases        WHERE tenant_id = $1 AND status = 'reserviert')      AS reserviert,
          (SELECT COUNT(*) FROM wishlist_matches WHERE tenant_id = $1 AND status = 'pending')         AS pending,
          (SELECT COUNT(*) FROM wishlist_matches WHERE tenant_id = $1 AND status = 'notified')        AS notified`,
       [tenantId],
     );
     const r = rows[0]!;
     return {
       transactions: Number(r.transactions),
       verkauft: Number(r.verkauft),
       reserviert: Number(r.reserviert),
       pendingMatches: Number(r.pending),
       notifiedMatches: Number(r.notified),
     };
   }
   ```

2. **Typecheck the helper change:**

   ```
   pnpm typecheck
   ```
   Expected: `tsc --noEmit` clean (the new helpers reference existing `MAILPIT_API`/`dbQuery` and the
   `transactions`/`wishlist_matches` tables created in T1).

3. **Commit the helpers:**

   ```
   git add e2e/helpers.ts
   git commit -m "$(cat <<'EOF'
   test(slice3): e2e helpers — mailpitMessages + salesCounts

   Mailpit inbox fetch + per-tenant DB counters (transactions / verkauft /
   reserviert / pending+notified matches) for the Slice-3 acceptance suite.

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

**Block B — The acceptance suite**

4. **Write the spec.** Create `e2e/sales-wishlist.spec.ts` with this exact content:

   ```ts
   /**
    * E2E acceptance — Slice 3 Verkauf/POS + Wunschlisten (C12).
    *
    * Whole-flow gates: (1) single-item sell from the inventory row → verkauft + transaction;
    * (2) POS cart with inventory + quick item + ad-hoc + transaction discount → server-recomputed
    * total + transaction persisted; (3) reserve → storno round-trip; (4) wishlist → matching Ankauf
    * → async pending match → staff notify → Mailpit mail + match 'notified'; (5) no customer-data leak
    * on the public storefront.
    *
    * Prerequisites: docker compose up -d --build (db → migrate → seed → web + worker + mailpit).
    *   • web AND worker run DISCOGS_DRIVER=fake; MAIL_DRIVER=mailpit comes from .env.compose, so the
    *     worker's notify job actually delivers to Mailpit (:8025 API).
    *   • The demo tenant is seeded WITH a fake Discogs connection (Slice 2) AND, from T13, with
    *     DEMO_QUICK_ITEMS (Kaffee/Plattentasche) + an OPEN 'Miles Davis' wishlist
    *     (klaus.wunsch@example.test).
    *   • Compose Postgres is exposed on host :55432 so dbQuery can assert state with no UI surface.
    *
    * Fake driver: query "blue" → "Kind of Blue" (Miles Davis) + "Blue Lines". We Ankauf "Kind of Blue"
    * so the new purchase's artist (Miles Davis) matches the seeded wishlist.
    */
   import { test, expect, type Page } from '@playwright/test';
   import {
     DEMO_URL,
     DEMO_EMAIL,
     DEMO_PASSWORD,
     DEMO_JAZZ_SLUG,
     login,
     dbQuery,
     demoTenantId,
     salesCounts,
     mailpitMessages,
   } from './helpers';

   // Run serially: scenarios mutate shared tenant state (sold copies, matches) and assert deltas.
   test.describe.configure({ mode: 'serial' });

   /** Open the first enabled "Verkaufen" row action on the inventory page (no registry testid for the
    *  trigger — it is selected by accessible name, per C12). */
   async function firstSellButton(page: Page) {
     return page.getByRole('button', { name: /^verkaufen$/i }).first();
   }

   test.describe('Slice 3 — Verkauf/POS + Wunschlisten', () => {
     test('1. sell a single copy from the inventory row → verkauft + one transaction', async ({ page }) => {
       const tenantId = await demoTenantId();
       const before = await salesCounts(tenantId);

       await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
       await page.goto(`${DEMO_URL}/inventar`);

       await (await firstSellButton(page)).click();
       const modal = page.getByTestId('sell-modal');
       await expect(modal).toBeVisible();
       // Inventory sell price is a read-only resolved display (C5/C12) — we do not edit it.
       await expect(modal.getByTestId('sell-price-input')).toBeVisible();
       await modal.getByTestId('sell-pay-bar').click();
       await modal.getByTestId('sell-submit').click();
       await expect(modal).toBeHidden();

       const after = await salesCounts(tenantId);
       expect(after.transactions).toBe(before.transactions + 1);
       expect(after.verkauft).toBe(before.verkauft + 1);

       // The created transaction is a single-line bar sale with subtotal == total (no discount).
       const tx = await dbQuery<{ payment_method: string; subtotal: string; discount: string; total: string }>(
         `SELECT payment_method, subtotal, discount, total
            FROM transactions WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
         [tenantId],
       );
       expect(tx[0]!.payment_method).toBe('bar');
       expect(Number(tx[0]!.discount)).toBe(0);
       expect(Number(tx[0]!.total)).toBeCloseTo(Number(tx[0]!.subtotal), 2);

       const items = await dbQuery<{ n: string }>(
         `SELECT COUNT(*) AS n FROM transaction_items ti
            JOIN transactions t ON t.id = ti.transaction_id
           WHERE t.tenant_id = $1 AND t.id = (SELECT MAX(id) FROM transactions WHERE tenant_id = $1)`,
         [tenantId],
       );
       expect(Number(items[0]!.n)).toBe(1);
     });

     test('2. POS cart: inventory + quick item + ad-hoc + discount → recomputed total + transaction', async ({ page }) => {
       const tenantId = await demoTenantId();
       const before = await salesCounts(tenantId);

       // The seeded "Kaffee" quick item id (templated testid kasse-quick-item-<id>).
       const qi = await dbQuery<{ id: number; price: string }>(
         `SELECT id, price FROM quick_items WHERE tenant_id = $1 AND name = 'Kaffee' AND active = true LIMIT 1`,
         [tenantId],
       );
       const kaffeeId = qi[0]!.id;
       const kaffeePrice = Number(qi[0]!.price); // 2.50

       await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
       await page.goto(`${DEMO_URL}/kasse`);
       await expect(page.getByTestId('kasse-screen')).toBeVisible();

       // (a) Add one inventory copy by searching a seeded title and clicking the result.
       //     The result is rendered as a clickable element containing the record title (T10); no
       //     registry testid for an individual result row → select by visible title text.
       const inv = await dbQuery<{ title: string; target_price: string }>(
         `SELECT r.title, p.target_price
            FROM purchases p JOIN records r ON r.id = p.record_id
           WHERE p.tenant_id = $1 AND p.status = 'verfuegbar' AND p.target_price IS NOT NULL
           ORDER BY p.id ASC LIMIT 1`,
         [tenantId],
       );
       const invTitle = inv[0]!.title;
       const invPrice = Number(inv[0]!.target_price);
       await page.getByTestId('kasse-inventory-search').fill(invTitle);
       await page.getByText(invTitle, { exact: false }).first().click();

       // (b) Add the Kaffee quick item.
       await page.getByTestId(`kasse-quick-item-${kaffeeId}`).click();

       // (c) Add an ad-hoc line (name + price selected by accessible label — no registry testid for the
       //     ad-hoc fields; T10 provides labeled inputs).
       await page.getByTestId('kasse-adhoc-add').click();
       await page.getByLabel(/bezeichnung|name/i).last().fill('Reinigung');
       await page.getByLabel(/preis/i).last().fill('5.00');
       const adhocPrice = 5.0;

       // Three cart lines present.
       const cart = page.getByTestId('kasse-cart');
       await expect(cart.getByTestId(/^kasse-cart-item-/)).toHaveCount(3);

       // (d) Apply a €3.00 transaction discount.
       await page.getByTestId('kasse-discount-input').fill('3.00');
       const discount = 3.0;

       const expectedSubtotal = invPrice + kaffeePrice + adhocPrice;
       const expectedTotal = expectedSubtotal - discount;

       // The total control reflects the server-consistent arithmetic (rendered to 2 decimals).
       await expect(page.getByTestId('kasse-total')).toHaveText(
         new RegExp(expectedTotal.toFixed(2).replace('.', '[.,]')),
       );

       // (e) Pay by card and submit.
       await page.getByTestId('kasse-pay-karte').click();
       await page.getByTestId('kasse-submit').click();
       await expect(page.getByTestId('kasse-screen')).toBeVisible();

       // Server persisted the transaction with the recomputed total (numeric(10,2)).
       const after = await salesCounts(tenantId);
       expect(after.transactions).toBe(before.transactions + 1);
       expect(after.verkauft).toBe(before.verkauft + 1); // the one inventory line went to verkauft

       const tx = await dbQuery<{ payment_method: string; subtotal: string; discount: string; total: string }>(
         `SELECT payment_method, subtotal, discount, total
            FROM transactions WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
         [tenantId],
       );
       expect(tx[0]!.payment_method).toBe('karte');
       expect(Number(tx[0]!.subtotal)).toBeCloseTo(expectedSubtotal, 2);
       expect(Number(tx[0]!.discount)).toBeCloseTo(discount, 2);
       expect(Number(tx[0]!.total)).toBeCloseTo(expectedTotal, 2);

       const items = await dbQuery<{ n: string }>(
         `SELECT COUNT(*) AS n FROM transaction_items
           WHERE transaction_id = (SELECT MAX(id) FROM transactions WHERE tenant_id = $1)`,
         [tenantId],
       );
       expect(Number(items[0]!.n)).toBe(3);
     });

     test('3. reserve a copy then cancel the reservation (round-trip)', async ({ page }) => {
       const tenantId = await demoTenantId();
       const before = await salesCounts(tenantId);

       await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
       await page.goto(`${DEMO_URL}/inventar`);

       // Reserve the first available copy.
       await page.getByTestId('reserve-action').first().click();
       await expect
         .poll(async () => (await salesCounts(tenantId)).reserviert)
         .toBe(before.reserviert + 1);

       // Cancel the reservation → back to verfügbar.
       await page.reload();
       await page.getByTestId('reserve-cancel-action').first().click();
       await expect
         .poll(async () => (await salesCounts(tenantId)).reserviert)
         .toBe(before.reserviert);
     });

     test('4. wishlist match on Ankauf → staff notify → Mailpit mail + match notified', async ({ page, request }) => {
       const tenantId = await demoTenantId();
       const before = await salesCounts(tenantId);

       await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);

       // (a) Ankauf "Kind of Blue" (Miles Davis) via the Slice-2 fake Discogs flow.
       await page.goto(`${DEMO_URL}/ankauf`);
       await page.getByTestId('discogs-search-form').getByRole('textbox').first().fill('blue');
       await page.getByTestId('discogs-search-form').getByRole('button', { name: /such/i }).click();
       const results = page.getByTestId('discogs-results');
       await expect(results).toBeVisible();
       const kob = results.getByTestId('discogs-result-card').filter({ hasText: /kind of blue/i }).first();
       await kob.getByTestId('ankauf-open').click();
       const ankauf = page.getByTestId('ankauf-modal');
       await expect(ankauf).toBeVisible();
       await ankauf.getByTestId('ek-input').fill('8.00');
       await ankauf.getByTestId('ankauf-submit').click();
       await expect(ankauf).toBeHidden();

       // (b) The async match job creates exactly one new pending match for the Miles Davis wishlist.
       await expect
         .poll(async () => (await salesCounts(tenantId)).pendingMatches, { timeout: 30_000 })
         .toBe(before.pendingMatches + 1);

       const match = await dbQuery<{ id: number; customer_email: string }>(
         `SELECT m.id, w.customer_email
            FROM wishlist_matches m JOIN wishlists w ON w.id = m.wishlist_id
           WHERE m.tenant_id = $1 AND m.status = 'pending'
           ORDER BY m.id DESC LIMIT 1`,
         [tenantId],
       );
       const matchId = match[0]!.id;
       const customerEmail = match[0]!.customer_email; // klaus.wunsch@example.test

       // (c) Staff opens the wishlist screen, the pending match is listed, and sends the notification.
       await page.goto(`${DEMO_URL}/wunschlisten`);
       await expect(page.getByTestId('wishlist-screen')).toBeVisible();
       await expect(page.getByTestId('wishlist-matches')).toBeVisible();
       await page.getByTestId(`wl-notify-${matchId}`).click();
       const notify = page.getByTestId('notify-modal');
       await expect(notify).toBeVisible();
       await expect(notify.getByTestId('notify-preview')).toBeVisible(); // read-only preview (C9.4/C12)
       await notify.getByTestId('notify-send').click();
       await expect(notify).toBeHidden();

       // (d) The worker's notify job delivers a mail to the customer in Mailpit, and the match flips
       //     to 'notified'.
       await expect
         .poll(async () => {
           const msgs = await mailpitMessages(request);
           return msgs.some((m) => m.To.some((t) => t.Address === customerEmail));
         }, { timeout: 30_000 })
         .toBe(true);

       await expect
         .poll(async () => (await salesCounts(tenantId)).notifiedMatches)
         .toBe(before.notifiedMatches + 1);
       expect((await salesCounts(tenantId)).pendingMatches).toBe(before.pendingMatches);
     });

     test('5. no customer wishlist data leaks onto the public storefront', async ({ page }) => {
       await page.goto(`${DEMO_URL}/p/${DEMO_JAZZ_SLUG}`);
       await page.waitForLoadState('domcontentloaded');
       await assertNoPrivateFields(page); // Slice-1 price/condition guard still holds

       const html = await page.content();
       // Customer name + email captured on the wishlist must never appear publicly.
       expect(html).not.toMatch(/klaus\.wunsch@example\.test/i);
       expect(html).not.toMatch(/Klaus Wunsch/i);
       // Sales internals must not leak either.
       expect(html).not.toMatch(/payment_method|paymentMethod/i);
     });
   });
   ```

5. **Bring up the stack and run the suite, expecting PASS:**

   ```
   docker compose up -d --build
   pnpm exec playwright test e2e/sales-wishlist.spec.ts
   ```
   Expected: all 5 scenarios pass —
   (1) one new transaction + one verfügbar→verkauft copy, single bar line, discount 0, total == subtotal;
   (2) a 3-line cart (inventory + Kaffee + ad-hoc) with a €3 discount persists a karte transaction whose
   server-stored subtotal/discount/total match the displayed `kasse-total`;
   (3) reserve then cancel returns the reserved count to baseline;
   (4) the Ankauf of "Kind of Blue" produces exactly one pending match, the staff notify sends a Mailpit
   mail to `klaus.wunsch@example.test`, and the match becomes `notified`;
   (5) the public permalink page exposes neither the customer's name/email nor sales internals.

6. **Commit:**

   ```
   git add e2e/sales-wishlist.spec.ts
   git commit -m "$(cat <<'EOF'
   test(slice3): e2e acceptance — sell/POS/reserve + wishlist match→notify

   Five-scenario whole-flow gate against the compose stack: single-row sell →
   verkauft+transaction; POS cart (inventory+quick+ad-hoc+discount) → server-
   recomputed total; reserve↔storno; wishlist Ankauf-match → staff notify →
   Mailpit mail + match 'notified'; and a no-leak check that customer name/email
   and sales internals never reach the public storefront.

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

#### Notes / lessons honored

- **Testid discipline (C12):** every `data-testid` used is from the frozen registry; the handful of controls
  with no registry testid (the inventory-row "Verkaufen" trigger, individual Kasse search-result rows, ad-hoc
  name/price inputs) are selected by accessible name/label/visible text. T10/T11 must therefore expose those
  controls with accessible names — a deliberate, documented coupling, not an invented testid.
- **Async correctness:** the match-created and notify-mail steps are awaited with `expect.poll` (re-query /
  re-fetch), never a fixed sleep — the worker processes those jobs asynchronously.
- **DB-backed assertions:** sold status, transaction/line counts, recomputed totals, and match status are
  asserted via `dbQuery` against the host-exposed compose Postgres (:55432), because no single UI surface
  proves them end-to-end. This mirrors the Slice-2 discogs.spec approach.
- **Non-vacuous wishlist gate:** scenario 4 drives the FULL async chain (Ankauf → match job → pending row →
  staff send → notify job → real SMTP delivery to Mailpit → status flip), not a stubbed shortcut.
- **Serial mode:** scenarios mutate shared tenant state and assert deltas off a per-test baseline captured at
  the start of each test, so `mode: 'serial'` plus baseline-relative assertions keep them order-independent
  in effect while sharing one freshly-seeded stack.
- **No-leak parity with Slice 1:** reuses `assertNoPrivateFields` and extends it with customer-PII + sales-
  internal scans on the public permalink page.
