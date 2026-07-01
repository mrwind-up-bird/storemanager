# Slice 3 — LOCKED CONTRACTS (single source of truth)

**Status:** FINAL (hardened after adversarial review — Athena / Nemesis+Aletheia / Ipcha Mistabra) ·
**Authority:** every per-task implementer (T1–T14) copies names/types/signatures from here VERBATIM. If
reality forces a change, change THIS file first, then the task — never silently drift.

**Provenance:** Verified against the real repo (`src/db/schema.ts`, `src/db/tenant.ts`, `src/lib/jobs.ts`,
`src/worker/index.ts`, `src/worker/jobs/*`, `src/lib/email/*`, `src/auth/session.ts`, `src/lib/ankauf.ts`,
`src/app/(app)/ankauf/actions.ts`, `src/db/assertions.ts`, `tests/db/assertions.test.ts`,
`drizzle/0005_discogs_rls.sql`, `drizzle/meta/_journal.json`, `src/lib/inventory.ts`, `src/lib/pricing.ts`,
`src/app/(app)/_components/SidebarNav.tsx`, `src/app/(app)/inventar/_components/InventoryList.tsx`) on
2026-06-30. Re-verified for this hardening pass: `purchases.targetPrice` is `numeric(10,2)` **NULLABLE**
(schema.ts:156); `ankaufRecord`'s `{ ok:false }` variant includes `message?: string` (actions.ts:95) and
`ankaufRecord` has **NO** `kunde` role gate (only `disconnectDiscogs` is admin-gated, actions.ts:137).
Lens: **Athena** (architectural coherence — one name per concept, invariants pushed to the DB,
service/pure/UI layers cleanly split, no client-trusted money).

---

## 0a. SPEC DELTAS & HARDENING DECISIONS (read first)

Where a review finding conflicts with the approved spec, the spec wins — UNLESS the finding exposes a real
spec/contract bug. The three deltas below are deliberate, locked deviations; everything else implements the
spec as written.

1. **Benachrichtigen-Modal preview is READ-ONLY** (spec §5.5 says "eine editierbare Nachrichtvorschau").
   The locked notify flow renders the body from the `sendWishlistNotificationEmail` template (C10) inside the
   worker; the action carries only `{ matchId }`. An editable textarea would silently discard staff edits —
   the exact latent UX defect Athena flagged. **Decision: `notify-preview` shows the rendered template
   read-only** (C9.4, C12). Threading an editable body is out of scope for Slice 3; revisit as a spec change
   if real editing is required. *(Resolves Athena C9.4 / Nemesis editable-preview findings — option (a).)*

2. **Single-sell modal `Verkaufspreis €` is READ-ONLY for inventory** (spec §5.2 draws an editable field;
   handoff is pixel-true on layout, not on authority). Spec §6.1 is explicit: "Client-Preise … nie als
   Autorität für Inventar/Quick." A client-editable price that the server ignores is a display-vs-charge
   divergence trap. **Decision: for an inventory copy the field renders the resolved `targetPrice`
   read-only; the submitted line is `{ kind:'inventory', purchaseId }` with no client price** (C5 note,
   C14-T11). This is a refinement consistent with §6.1, not a contradiction.

3. **No €0.00 fail-open on missing inventory price** (the DRAFT contract's `unitPrice: targetPrice ?? '0.00'`
   was a contract bug, not in the spec). A null `targetPrice` must **fail closed**, never silently record a
   €0.00 sale. **Decision: C5 throws `SalePriceMissingError` when an inventory line's `targetPrice` is
   null/empty** (mapped to `reason:'conflict'`). In practice every ankauf'd copy already has a `targetPrice`
   (`ankaufSchema.targetPrice` is required), so this is an edge guard for legacy/manual rows; the modal
   disables submit + shows "kein VK-Preis hinterlegt" for such copies. *(Resolves the converged Athena /
   Nemesis / Ipcha critical+important findings on §6.1.)*

---

## 0. Global conventions (apply to every contract below)

- **Money columns:** `numeric('<col>', { precision: 10, scale: 2 })`. Drizzle returns these as **strings**
  (e.g. `'12.34'`). NEVER do float arithmetic on them — convert to integer cents via `@/lib/money` (C3).
- **FK columns:** `integer('<col>').notNull().references(() => <table>.id)` (or `.references(...)` without
  `.notNull()` when nullable). `tenantId` always `.references(() => tenants.id)`.
- **Timestamps:** `timestamp('<col>', { withTimezone: true })` (timestamptz). Created-at default:
  `.defaultNow()`.
- **`tenantId` is always written explicitly** by service code (`tenantId: ctx.tenantId`) even though the RLS
  migration sets a GUC default — this matches `performAnkauf`/existing tables (defence-in-depth).
- **Existing `record_status` enum spelling is `verfuegbar`** (umlaut spelled out). Use that literal
  everywhere; the human-facing copy uses `verfügbar`.
- **Service layer** (`src/lib/*`) is `import 'server-only'` and runs queries on the `Tx` from `withTenant`.
  **Pure layer** (`src/lib/money.ts`, `src/lib/sales.ts`, and the `matchWishlists` export) does NOT touch the
  DB; unit tests that import a `server-only`-tainted module mock it with `vi.mock('server-only', () => ({}))`
  (the established pattern in `tests/db/assertions.test.ts`).
- **`TenantCtx`** (from `@/db/tenant`) is `{ tenantId: number; userId: number | null }`. Functions that write
  `soldByUserId`/`createdByUserId` REQUIRE `ctx.userId !== null` and throw if it is null.
- **Decimal string validator** (reused from ankauf): `const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);`
- **One error shape across all mutating actions:** EVERY `{ ok:false }` action variant carries an optional
  `message?: string` (see C11). This is mandatory so the locked CSRF prologue — which returns a `message` —
  compiles in every action (verified: it compiles in `ankaufRecord` precisely because that variant has
  `message?`).

---

## C1 — Drizzle enums (`src/db/schema.ts`)

Append after the existing `discogsListingStatusEnum`. Exact `pgEnum(name, values)`:

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

**Already exists (do NOT redefine, reference only):**
`recordStatusEnum = pgEnum('record_status', ['verfuegbar','reserviert','verkauft','verliehen'])` — note the
spelling **`verfuegbar`**.

---

## C2 — Drizzle table definitions (`src/db/schema.ts`)

Append after `discogsConnections`, in this exact order (FK targets must be declared first): `quickItems`,
`transactions`, `transactionItems`, `wishlists`, `wishlistMatches`. Style mirrors existing `purchases`
(object-returning second arg `(t) => ({...})`). `check`, `sql`, `unique`, `index`, `boolean`, `numeric`,
`text`, `integer`, `serial`, `timestamp` are already imported in `schema.ts`.

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

**Derived position type** (NOT a column — computed in code, see C4, AND now DB-guarded by
`transaction_items_kind_exclusive` + `transaction_items_inventory_qty_one`): `inventory` (purchaseId set,
quickItemId null, quantity 1) · `quick` (quickItemId set, purchaseId null) · `adhoc` (both null).

**`purchases` is unchanged.** `performSale` writes its EXISTING `soldPrice`/`soldDate`/`paymentMethod`
columns; `purchases.paymentMethod` stays `text` (store the enum value as a string — no column-type migration).

---

## C3 — Money helper (`src/lib/money.ts`, pure, no `server-only`)

All money math goes through integer cents. Exact, no float. Reference implementation is part of the contract
(locks rounding behaviour):

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

No other money function may be introduced by tasks without amending this contract.

---

## C4 — Sales domain types + `computeCartTotals` (`src/lib/sales.ts`, pure, no `server-only`)

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

---

## C5 — `performSale` service (`src/lib/performSale.ts`, `server-only`)

```ts
import 'server-only';
import { withTenant, type TenantCtx } from '@/db/tenant';
import type { CartInput } from '@/lib/sales';

/** performSale receives the SAME shape as the client cart (C4) — one name per concept, cannot diverge. */
export type PerformSaleInput = CartInput;

export type PerformSaleResult = { transactionId: number; total: string };

/** Thrown when an inventory copy cannot be sold (missing or status ∉ {verfuegbar,reserviert}). Aborts the tx. */
export class SaleConflictError extends Error {
  constructor(public readonly purchaseId: number, public readonly status: string | null) {
    super(`purchase ${purchaseId} not sellable (status=${status ?? 'missing'})`);
    this.name = 'SaleConflictError';
  }
}

/** Thrown when an inventory copy has no resolvable price (targetPrice null/empty). Aborts the tx —
 *  NEVER record a €0.00 inventory sale (fail-closed; see §0a delta 3). */
export class SalePriceMissingError extends Error {
  constructor(public readonly purchaseId: number) {
    super(`purchase ${purchaseId} has no target price (cannot resolve inventory unit price)`);
    this.name = 'SalePriceMissingError';
  }
}

export async function performSale(ctx: TenantCtx, input: PerformSaleInput): Promise<PerformSaleResult>;
```

**Transaction semantics (locked):**
1. Require `ctx.userId !== null` (throw `Error` if null — `soldByUserId` is NOT NULL).
2. **Inventory uniqueness guard (HARDENED — Athena/Ipcha double-charge):** collect the `purchaseId`s of all
   `kind:'inventory'` lines; if any value appears more than once → `throw new Error('duplicate inventory
   purchaseId in cart')` BEFORE opening the tx. (The action's `createSaleSchema` `.refine` rejects this first
   with `reason:'validation'`; this is the defence-in-depth backstop for direct service callers/tests, since
   `performSale` is a trusted-but-tested surface and the cart UI key `inv-<purchaseId>` must not be trusted.)
3. **ONE** `withTenant(ctx, async (tx) => { ... })` transaction. No nested `withTenant`.
4. **Lock ordering (HARDENED — Ipcha deadlock):** sort the DISTINCT inventory `purchaseId`s **ascending**,
   then for each in that order: `SELECT ... FROM purchases WHERE id = $1 FOR UPDATE` (drizzle: `.for('update')`).
   If row missing OR `status ∉ {'verfuegbar','reserviert'}` → `throw new SaleConflictError(purchaseId, status)`
   (**fail-closed**, whole tx rolls back — no double-sell). Deterministic ascending order prevents
   lock-order deadlocks between concurrent multi-line checkouts that share copies.
5. **Resolve unitPrice server-side (client price is NEVER authority for inventory/quick — spec §6.1):**
   - `inventory` → load the copy's record `title`. If `purchase.targetPrice` is `null` or empty/whitespace →
     `throw new SalePriceMissingError(purchaseId)` (**fail-closed; no `?? '0.00'` default**). Else
     `{ label: record.title, unitPrice: purchase.targetPrice, quantity: 1 }`.
   - `quick` → load active `quick_items` row → `{ label: row.name, unitPrice: row.price, quantity }`.
     Fail-closed if the quick item is missing/inactive (treat as validation error → throw `Error`).
   - `adhoc` → `{ label: line.label, unitPrice: line.unitPrice, quantity: line.quantity }` (client value used
     ONLY for ad-hoc).
6. `computeCartTotals(resolvedLines, input.discount)` → `{ subtotal, discount, total }` (C4).
7. **Voucher resolution:** `const voucherCode = input.payment === 'gutschein' ? (input.voucherCode?.trim() || null) : null;`
   If `input.payment === 'gutschein'` and `voucherCode` is null → `throw new Error('voucherCode required for
   gutschein')` (the action's `createSaleSchema` refine normally prevents this; this keeps `performSale`
   fail-closed for direct callers and satisfies the `transactions_voucher_iff_gutschein` DB check).
8. Insert `transactions`: `{ tenantId: ctx.tenantId, soldByUserId: ctx.userId, paymentMethod: input.payment,
   subtotal, discount, total, voucherCode }` `.returning({ id })`.
9. Insert all `transaction_items` (`tenantId: ctx.tenantId`, `transactionId`, `purchaseId|null`,
   `quickItemId|null`, `label`, `unitPrice`, `quantity`).
10. For each inventory line (ascending `purchaseId`, already locked): `UPDATE purchases SET status='verkauft',
    soldPrice=<line.unitPrice>, soldDate=now(), paymentMethod=<input.payment as string>, updatedAt=now()
    WHERE id=<purchaseId>`.
11. Return `{ transactionId, total }`.

> **Modal/price reconciliation note (T11) — HARDENED:** For an INVENTORY line the server is the sole price
> authority (spec §6.1). The single-sell modal renders `sell-price-input` as a **read-only** display of the
> copy's `targetPrice` (the stored VK). The submitted line is `{ kind:'inventory', purchaseId }` with NO
> client price. If `targetPrice` is null/empty, the modal shows the `suggestSalePrice` figure as a
> non-authoritative hint, DISABLES `sell-submit`, and surfaces **"kein VK-Preis hinterlegt"** — because
> `performSale` fail-closes on a missing inventory price (`SalePriceMissingError`, no €0.00 sale). In practice
> every ankauf'd copy has a `targetPrice` (`ankaufSchema.targetPrice` is required), so this is an edge guard
> for legacy/manual rows. Do not add a client price to inventory lines without amending this contract.

**Action mapping:** the `createSale` action (C11) maps BOTH `SaleConflictError` and `SalePriceMissingError`
→ `{ ok:false, reason:'conflict' }` (no new reason literal). The duplicate-inventory and quick-missing
`Error`s fall through to `{ ok:false, reason:'error' }` at the service boundary, but are normally caught
first by `createSaleSchema` as `reason:'validation'`.

---

## C6 — Reservation service (`src/lib/reservation.ts`, `server-only`)

```ts
import 'server-only';
import { type TenantCtx } from '@/db/tenant';

/** Thrown when a copy is not in the required source status for the requested transition. Aborts the tx. */
export class ReservationConflictError extends Error {
  constructor(public readonly purchaseId: number, public readonly status: string | null) {
    super(`purchase ${purchaseId} not in required status (status=${status ?? 'missing'})`);
    this.name = 'ReservationConflictError';
  }
}

/** verfuegbar → reserviert. ONE withTenant tx, SELECT ... FOR UPDATE, fail-closed if status !== 'verfuegbar'. */
export async function reserveCopy(ctx: TenantCtx, purchaseId: number): Promise<void>;

/** reserviert → verfuegbar. ONE withTenant tx, SELECT ... FOR UPDATE, fail-closed if status !== 'reserviert'. */
export async function cancelReservation(ctx: TenantCtx, purchaseId: number): Promise<void>;
```

Both throw `ReservationConflictError` on missing row or wrong source status (action layer maps to
`{ ok:false, reason:'conflict' }`). Both `UPDATE ... SET updatedAt = now()`.

---

## C7 — Quick-items catalog (`src/lib/quickItems.ts`, `server-only`)

```ts
import 'server-only';
import { type TenantCtx } from '@/db/tenant';

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

> **Naming collision note (Athena minor):** `createQuickItem`/`updateQuickItem`/`deactivateQuickItem` are the
> SERVICE names here; the like-named C11 actions import these with the `…Svc` alias (see C11). Do not call the
> action from the service or vice-versa.

---

## C8 — Wishlist domain (`src/lib/wishlist.ts`, `server-only`; `matchWishlists` is pure)

```ts
import 'server-only';
import { type TenantCtx } from '@/db/tenant';
import type { WishlistStatus } from '@/db/schema';

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
export async function listWishlists(ctx: TenantCtx): Promise<WishlistRow[]>;

// ── Pending-matches read (HARDENED — Athena: the missing join read) ──────────

/** One pending wishlist match joined to its wishlist (customer) + the arrived copy's record (display). */
export type PendingMatchRow = {
  matchId: number;       // wishlist_matches.id
  wishlistId: number;    // wishlist_matches.wishlistId
  customerName: string;  // wishlists.customerName
  customerEmail: string; // wishlists.customerEmail
  artist: string;        // records.artist  (the arrived copy's record)
  title: string;         // records.title
  coverImage: string | null; // records.coverImage
  createdAt: Date | null;     // wishlist_matches.createdAt
};

/**
 * Pending matches for the tenant — single source for the wunschlisten "Offene Treffer" section (T12
 * MatchesSection) AND the Benachrichtigen-Modal preview (T12 NotifyModal). Joins
 * wishlist_matches → wishlists → records. Returns ONLY rows where
 *   wishlist_matches.status = 'pending' AND wishlists.status = 'open'
 * (a wishlist that has been notified is TERMINAL for matching — its leftover pending matches are hidden;
 * see C9.4). Newest match first (wishlist_matches.createdAt desc). ONE withTenant tx.
 */
export async function listPendingMatches(ctx: TenantCtx): Promise<PendingMatchRow[]>;

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
 * Returns the ids of wishlists that match the record. Matching rule (locked, all comparisons
 * case-insensitive substring with haystack = record, needle = wishlist; ALL fields are `.trim()`ed first):
 *   - artist: REQUIRED. record.artist (ci) CONTAINS wishlist.artist (ci). A wishlist whose artist is
 *             BLANK after trim matches NOTHING (defensive skip — prevents the ' '-substring over-match where
 *             a whitespace needle matches every record; Ipcha finding).
 *   - title:    optional. if present (non-blank after trim), record.title (ci) CONTAINS wishlist.title (ci).
 *   - country:  optional. if present, (record.country ?? '') (ci) CONTAINS wishlist.country (ci).
 *   - label:    optional. if present, record.label.join(' ') (ci) CONTAINS wishlist.label (ci).
 * A wishlist matches only if artist matches AND every PRESENT optional field matches. Empty/whitespace
 * optional fields are treated as absent.
 */
export function matchWishlists(record: MatchableRecord, openWishlists: OpenWishlist[]): number[];

// ── Match persistence + orchestration (used by the match job, T7) ────────────

/**
 * Loads the record (artist/title/country/label) + this tenant's OPEN wishlists, runs `matchWishlists`,
 * and inserts one `wishlist_matches` (status 'pending') per matched wishlist using
 * `.onConflictDoNothing({ target: [wishlistMatches.wishlistId, wishlistMatches.purchaseId] })`
 * (idempotent on the unique (wishlistId, purchaseId)). Returns the number of NEWLY inserted matches
 * (use `.returning()` length — drives non-vacuous idempotency assertions). ONE withTenant tx.
 */
export async function findAndPersistWishlistMatches(
  ctx: TenantCtx,
  args: { purchaseId: number; recordId: number },
): Promise<number>;
```

---

## C9 — Queue additions, enqueue functions, handlers, post-commit enqueue point

### C9.1 `QUEUE` (`src/worker/index.ts`) — add two entries to the existing `as const` object

```ts
export const QUEUE = {
  analyticsSummaryRefresh: 'system.analytics_summary.refresh',
  discogsListingCreate: 'tenant.discogs.listing.create',
  wishlistMatch: 'tenant.wishlist.match',
  wishlistNotify: 'tenant.wishlist.notify',
} as const;
```

In `startWorker()`, register each new queue with the existing pattern (type-only payload import at top of
file, idempotent `createQueue`, then `work` looping the batch):

```ts
const { handleWishlistMatch } = await import('./jobs/wishlistMatch');
const { handleWishlistNotify } = await import('./jobs/wishlistNotify');

await boss.createQueue(QUEUE.wishlistMatch);
await boss.work<WishlistMatchPayload>(QUEUE.wishlistMatch, async (jobs) => {
  for (const job of jobs) await handleWishlistMatch(job);
});

await boss.createQueue(QUEUE.wishlistNotify);
await boss.work<WishlistNotifyPayload>(QUEUE.wishlistNotify, async (jobs) => {
  for (const job of jobs) await handleWishlistNotify(job);
});
```
Payload types are imported type-only at module top: `import type { WishlistMatchPayload } from './jobs/wishlistMatch';`
and `import type { WishlistNotifyPayload } from './jobs/wishlistNotify';` (keeps `import { QUEUE }` env-less).

### C9.2 Payload types (defined in the handler files, exported)

```ts
export type WishlistMatchPayload = { tenantId: number; purchaseId: number; recordId: number };
export type WishlistNotifyPayload = { tenantId: number; matchId: number };
```

### C9.3 Enqueue functions (`src/lib/jobs.ts`)

`getBoss()` MUST `await boss.createQueue(QUEUE.wishlistMatch)` and `await boss.createQueue(QUEUE.wishlistNotify)`
alongside the existing `discogsListingCreate` creation (send() requires the queue to exist in the web process's
boss instance). Add (payload types imported `type`-only from the handler modules):

```ts
export async function enqueueWishlistMatch(payload: WishlistMatchPayload): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE.wishlistMatch, payload, { retryLimit: 5, retryBackoff: true });
}

export async function enqueueWishlistNotification(payload: WishlistNotifyPayload): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE.wishlistNotify, payload, { retryLimit: 5, retryBackoff: true });
}
```

### C9.4 Handler signatures

```ts
// src/worker/jobs/wishlistMatch.ts
export async function handleWishlistMatch(job: PgBoss.Job<WishlistMatchPayload>): Promise<void>;
//   ctx = { tenantId: job.data.tenantId, userId: null };
//   delegates to findAndPersistWishlistMatches(ctx, { purchaseId, recordId }) (C8). Idempotent via the
//   unique (wishlistId, purchaseId) + onConflictDoNothing. NO email here (staff-confirmed flow).

// src/worker/jobs/wishlistNotify.ts
export async function handleWishlistNotify(job: PgBoss.Job<WishlistNotifyPayload>): Promise<void>;
//   ONE withTenant({tenantId, userId:null}) tx:
//   1. SELECT the match row `... FOR UPDATE` (drizzle `.for('update')`) BEFORE any status read — HARDENED
//      (Nemesis/Ipcha): serializes concurrent/retried jobs so the pending gate is race-free (mirrors the
//      C5/C6 FOR UPDATE posture; the ONLY place in the slice that previously lacked it).
//   2. If match missing OR match.status !== 'pending' → return (idempotent no-op; second invocation observes
//      'notified' and stops — no duplicate email).
//   3. Load wishlist + record; read tenant name from `tenants` (qr_app has GRANT SELECT).
//   4. Send via getEmailAdapter().send through sendWishlistNotificationEmail(adapter, {...}) (C10).
//   5. ONLY AFTER a successful send: set wishlist_matches.status='notified', notifiedAt=now() AND
//      wishlists.status='notified'.
//   Error policy: a thrown send (SMTP/transient) RETHROWS → pg-boss retries; the status flip happens only
//   after success, so a retried job re-sends until it succeeds then is a no-op. Accepted residual: a crash
//   AFTER send succeeds but BEFORE the DB flip commits causes one re-send on retry (at-least-once delivery).
//
//   TERMINAL-NOTIFY semantics (locked — Athena C9.4): wishlists.status='notified' is terminal for matching
//   (findAndPersistWishlistMatches only considers status='open' wishlists, C8). A wishlist's OTHER leftover
//   pending matches are therefore HIDDEN from the UI by listPendingMatches' `wishlists.status='open'` filter
//   (C8). This is the intended one-and-done design; do not "reopen" notified wishlists in this slice.
```

### C9.5 Post-commit enqueue point (verified against real code)

**Verified reality:** `performAnkauf` (`src/lib/ankauf.ts`) does NOT enqueue; the existing
`enqueueDiscogsListing` call lives in the **`ankaufRecord` server action** (`src/app/(app)/ankauf/actions.ts`)
AFTER `performAnkauf` resolves (post-commit), in its own try/catch with a soft flag. Slice 3 adds the wishlist
match enqueue at the SAME call site (mirrors the discogs pattern + Slice-0–2 lesson #5: isolate post-commit
enqueue failures, never fail the committed ankauf):

```ts
// in ankaufRecord, after `({ recordId, purchaseId } = await performAnkauf(ctx, parsed.data));`
try {
  await enqueueWishlistMatch({ tenantId: user.tenantId, purchaseId, recordId });
} catch (err) {
  console.error('[ankauf] wishlist-match enqueue failed after purchase committed', err);
  // soft-fail: the ankauf is already committed; do not throw.
}
```

This is enqueued on **every** ankauf (independent of `listOnDiscogs`). This reconciles the spec §6.3 wording
("performAnkauf enqueued nach Commit") with the actual code structure — the enqueue is post-commit in the
ankauf flow, at the verified call site (the action), not inside `performAnkauf`.

---

## C10 — Email template (`src/lib/email/index.ts`)

Add alongside `sendCredentialsEmail`. Arg shape and German copy locked:

```ts
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

**Copy (locked):**
- **Subject:** `` `Dein Wunsch ist da: ${artist} – ${title}` ``
- **Text body:**
  ```
  Hallo ${customerName},

  gute Nachrichten! Ein Titel von deiner Wunschliste ist bei ${tenantName} eingetroffen:

  ${artist} – ${title}

  Komm gern vorbei oder melde dich, wenn du ihn reservieren möchtest.
  [wenn permalinkUrl: ]Zum Schaufenster: ${permalinkUrl}

  Viele Grüße
  ${tenantName}
  ```
- **HTML:** same content, the `sendCredentialsEmail` inline-styled shell (max-width 480, sans-serif). Use
  semantic colour only where a token exists; raw hex is acceptable in email HTML (clients ignore CSS vars) —
  mirror the existing `sendCredentialsEmail` hex usage (`#c84b31` link). The `permalinkUrl` line is rendered
  only when present.

**Note (Athena C9.4 delta 1):** this template is the SOLE source of the notify body. The `notify-preview`
control (C12) renders it READ-ONLY; there is no staff-editable message field in Slice 3.

---

## C11 — Server actions (signatures + zod schemas)

**Shared prologue (locked — every mutating action, byte-for-byte identical):**

```ts
const user = await requireSession();
if (user.role === 'kunde') forbidden();                       // staff gate: role ∈ {mitarbeiter,admin,superadmin}
if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
```

> **Staff-gate provenance caveat (HARDENED — Nemesis security-adjacent):** the `kunde → forbidden()` line is a
> **NEW Slice-3 requirement**. It is NOT inherited from `ankaufRecord`, which has **no** role gate at all
> (only `requireSession()` + `isValidOrigin()`; the sole role gate in that file is the admin-only one on
> `disconnectDiscogs`, actions.ts:137). An implementer who literally "mirrors ankaufRecord" would drop the
> staff gate on a sales/customer-data action — do not. The explicit prologue line above is the authority.

> **Why every `{ ok:false }` variant carries `message?: string` (HARDENED — Nemesis critical):** the prologue's
> CSRF return is the object literal `{ ok:false, reason:'error', message:'…' }`. Under TS excess-property
> checking, that compiles ONLY if the action's error variant declares `message?`. It compiles in
> `ankaufRecord` for exactly this reason (its variant has `message?`). Therefore EVERY action error variant
> below includes `message?: string`. Do not strip it from any signature, and do not strip `message` from the
> prologue — the contract is internally consistent precisely because both are present.

`isValidOrigin` is **extracted** from `src/app/(app)/ankauf/actions.ts` into a shared module
**`src/lib/csrf.ts`** (`export async function isValidOrigin(): Promise<boolean>` — identical body) and imported
by ankauf (refactor: drop the local copy), kasse, and wunschlisten actions. `forbidden`/`requireSession`/`z`
imported as in ankauf actions. Shared validators: `const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);`

> **Service/action aliasing convention (HARDENED — Athena minor):** several actions share a name with the
> service they call (`createQuickItem`/`updateQuickItem`/`deactivateQuickItem`, `createWishlist`,
> `cancelReservation`). To avoid same-name import clashes and "wrong layer" bugs, action files import the
> service with a `…Svc` alias:
> ```ts
> import { createQuickItem as createQuickItemSvc, updateQuickItem as updateQuickItemSvc,
>          deactivateQuickItem as deactivateQuickItemSvc, listActiveQuickItems } from '@/lib/quickItems';
> import { createWishlist as createWishlistSvc, listPendingMatches } from '@/lib/wishlist';
> import { cancelReservation as cancelReservationSvc, reserveCopy } from '@/lib/reservation';
> ```
> `reserveCopy` (service) ↔ `reserve` (action) already differ — no alias needed there.

### Zod schemas (locked)

```ts
const cartLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inventory'), purchaseId: z.number().int().positive() }),
  z.object({ kind: z.literal('quick'), quickItemId: z.number().int().positive(), quantity: z.number().int().min(1).max(999) }),
  z.object({ kind: z.literal('adhoc'), label: z.string().min(1).max(200), unitPrice: decimalString, quantity: z.number().int().min(1).max(999) }),
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
  // HARDENED (Athena/Ipcha double-charge): an inventory purchaseId may appear at most once per cart.
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

const createWishlistSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().max(320),
  // HARDENED (Ipcha whitespace over-match): trim + non-empty so a whitespace artist can't substring-match
  // the whole catalogue.
  artist: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200).nullish(),
  title: z.string().trim().max(200).nullish(),
  country: z.string().trim().max(120).nullish(),
});

const matchIdSchema = z.object({ matchId: z.number().int().positive() });
```

> The wishlist service treats a trimmed-empty optional field (`label`/`title`/`country` === `''`) as `null`
> on insert; `matchWishlists` (C8) treats empty/whitespace optional fields as absent. Together with the
> trimmed non-empty `artist`, this closes the over-match gap.

### Action signatures

`src/app/(app)/kasse/actions.ts`:
```ts
export async function createSale(input: CartInput):
  Promise<{ ok: true; transactionId: number; total: string }
         | { ok: false; reason: 'validation' | 'conflict' | 'error'; message?: string }>;
//   maps SaleConflictError AND SalePriceMissingError → { ok:false, reason:'conflict' };
//   revalidatePath('/inventar') + '/' + '/kasse' on success.

export async function reserve(input: { purchaseId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }>;
export async function cancelReservation(input: { purchaseId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }>;
//   both map ReservationConflictError → reason:'conflict'; revalidatePath('/inventar').

export async function createQuickItem(input: { name: string; price: string }):
  Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }>;
export async function updateQuickItem(input: { id: number; name?: string; price?: string; active?: boolean }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'error'; message?: string }>;
export async function deactivateQuickItem(input: { id: number }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'error'; message?: string }>;
//   quick-item CRUD revalidatePath('/kasse').
```

`src/app/(app)/wunschlisten/actions.ts`:
```ts
export async function createWishlist(input: CreateWishlistInput):
  Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }>;
//   revalidatePath('/wunschlisten').

export async function notifyWishlistMatch(input: { matchId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }>;
//   HARDENED (Nemesis/Ipcha read-then-enqueue): inside ONE withTenant read, load the match by id (RLS scopes
//   to tenant). If not found → { ok:false, reason:'not_found' }. If match.status !== 'pending' → { ok:true }
//   WITHOUT enqueue (idempotent; avoids stacking redundant jobs on double-click). Only when status==='pending'
//   → enqueueWishlistNotification({ tenantId, matchId }) (soft-fail post-enqueue log). revalidatePath('/wunschlisten').

export async function dismissMatch(input: { matchId: number }):
  Promise<{ ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }>;
//   verifies the match exists + belongs to tenant (withTenant), sets wishlist_matches.status='dismissed'
//   (no mail); not found → reason:'not_found'; revalidatePath('/wunschlisten').
```

`CartInput` / `CreateWishlistInput` are the C4 / C8 types. Inputs are zod-validated with the schemas above
(`safeParse` → `{ ok:false, reason:'validation', message }` on failure), identical to `ankaufRecord`.

---

## C12 — Full testid registry (FROZEN — from spec §5.1–§5.6)

Static testids:
```
kasse-screen
kasse-inventory-search
kasse-adhoc-add
kasse-cart
kasse-discount-input
kasse-discount-mode           // €/% toggle for the transaction discount (see expansion below)
voucher-code-input            // shared by Kasse screen AND sell modal
kasse-total
kasse-submit
sell-modal
sell-price-input              // INVENTORY: read-only display of resolved targetPrice (C5 note)
sell-submit
sell-cancel
reserve-action
reserve-cancel-action
wishlist-screen
wishlist-form
wl-customer-name
wl-customer-email
wl-artist
wl-label
wl-title
wl-country
wishlist-submit
wishlist-matches
notify-modal
notify-preview                // READ-ONLY rendered template (spec §0a delta 1) — NOT an editable field
notify-send
notify-cancel
add-to-wishlist
```

Templated (dynamic) testids — expansion rules:
```
kasse-quick-item-<id>         // <id> = quick_items.id
kasse-cart-item-<key>         // <key> = stable cart-line key (see below)
kasse-pay-<method>            // <method> ∈ {bar, karte, paypal, gutschein}  → 4 ids
sell-pay-<method>             // <method> ∈ {bar, karte, paypal, gutschein}  → 4 ids
wl-match-<id>                 // <id> = wishlist_matches.id
wl-notify-<id>                // <id> = wishlist_matches.id
wl-dismiss-<id>               // <id> = wishlist_matches.id
```

**`kasse-discount-mode` (HARDENED — Ipcha minor):** a single control on the discount input that switches the
`DiscountInput.kind`. Its two selectable values map to the union literals **`amount`** (€) and **`percent`**
(%). Tests target the percent path deterministically via this control (e.g. set `kasse-discount-mode` to
`percent`, then type into `kasse-discount-input`). The `kasse-discount-input` field carries the numeric value
for whichever mode is active.

**`<key>` for `kasse-cart-item-<key>` (locked):** `inv-<purchaseId>` | `quick-<quickItemId>` |
`adhoc-<clientLineIndex>` (the client-generated index for ad-hoc lines, stable within the cart session). The
`inv-<purchaseId>` key also enforces single-instance-per-copy in the UI; the server independently dedupes
(C5 step 2 + `createSaleSchema` refine) and never trusts it.
**`<method>` literals are the `payment_method` enum values verbatim** (`bar`,`karte`,`paypal`,`gutschein`).
No task may invent testids outside this registry.

---

## C13 — RLS migration contract

### C13.1 `drizzle/0006_<drizzle-generated>.sql` (DDL)

Produced by `pnpm drizzle-kit generate` AFTER C1+C2 land in `schema.ts` — creates the 3 enums, 5 tables, FKs,
indexes, unique + check constraints. The check set now includes (C2 hardening): `transactions_voucher_iff_gutschein`,
`transaction_items_kind_exclusive`, `transaction_items_inventory_qty_one` (in addition to the
discount/total/quantity/price checks). The generated tag name is random (e.g. `0006_<adjective_noun>`);
register the ACTUAL filename in the journal. A matching `drizzle/meta/0006_snapshot.json` is emitted.

### C13.2 `drizzle/0007_slice3_rls.sql` (HAND-AUTHORED)

drizzle-kit does NOT manage RLS. Mirror `drizzle/0005_discogs_rls.sql` EXACTLY, with
`--> statement-breakpoint` between every statement. Per table, in order `quick_items`, `transactions`,
`transaction_items`, `wishlists`, `wishlist_matches`, emit this 7-statement block (both GRANTs are
load-bearing — INSERT fails without the SEQUENCE grant):

```sql
ALTER TABLE "<t>" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "<t>" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "<t>" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "<t>"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "<t>"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "<t>" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "<t>_id_seq" TO qr_app;
```
Sequence names: `quick_items_id_seq`, `transactions_id_seq`, `transaction_items_id_seq`, `wishlists_id_seq`,
`wishlist_matches_id_seq`. (5 tables × 7 statements = 35 statements; the LAST statement has no trailing
breakpoint, matching 0005.)

### C13.3 `drizzle/meta/_journal.json` registration

Append two entries after idx 5 (use `Date.now()` at generation time for `when`; `0006_*` tag is the actual
generated filename):
```json
{ "idx": 6, "version": "7", "when": <ts>, "tag": "0006_<drizzle-generated>", "breakpoints": true },
{ "idx": 7, "version": "7", "when": <ts>, "tag": "0007_slice3_rls",        "breakpoints": true }
```
`0006_snapshot.json` is emitted by drizzle-kit. `0007_snapshot.json` is a COPY of `0006_snapshot.json` (no
schema delta — RLS is invisible to drizzle), exactly as `0005_snapshot.json` duplicates `0004`'s.

### C13.4 `src/db/assertions.ts` — `TENANT_SCOPED_TABLES` += 5 (append)

```ts
const TENANT_SCOPED_TABLES = [
  'users', 'user_detail', 'sessions', 'records', 'purchases', 'permalinks', 'discogs_connections',
  'quick_items', 'transactions', 'transaction_items', 'wishlists', 'wishlist_matches',
] as const;
```

### C13.5 `tests/db/assertions.test.ts` — `SOUND_TENANT_ID_TABLES` MUST be updated in lockstep (Slice-2 lesson)

```ts
const SOUND_TENANT_ID_TABLES = [
  'users', 'user_detail', 'sessions', 'records', 'purchases', 'permalinks', 'discogs_connections',
  'quick_items', 'transactions', 'transaction_items', 'wishlists', 'wishlist_matches',
];
```
Both lists are edited in the SAME task (T1). The drift guard fails 4 unit tests if `SOUND_TENANT_ID_TABLES`
diverges from `TENANT_SCOPED_TABLES`. The controller runs full `pnpm test` before final review (per-task
reviewers do not).

---

## C14 — File-structure map (every file, single responsibility)

`C` = created, `M` = modified. Test files listed with their target.

### T1 — Schema + migrations + RLS + assertions
- `M src/db/schema.ts` — C1 enums + C2 tables (+ exported TS types; incl. the 3 new check constraints).
- `C drizzle/0006_<generated>.sql` — drizzle-kit DDL (enums, tables, FKs, indexes, checks, unique).
- `C drizzle/meta/0006_snapshot.json` — drizzle-kit snapshot.
- `C drizzle/0007_slice3_rls.sql` — hand-authored RLS (C13.2).
- `C drizzle/meta/0007_snapshot.json` — copy of 0006 snapshot (no delta).
- `M drizzle/meta/_journal.json` — register idx 6 + 7 (C13.3).
- `M src/db/assertions.ts` — `TENANT_SCOPED_TABLES` += 5 (C13.4).
- `M tests/db/assertions.test.ts` — `SOUND_TENANT_ID_TABLES` += 5 (C13.5).

### T2 — Sales totals domain (pure)
- `C src/lib/money.ts` — C3 money helper.
- `C src/lib/sales.ts` — C4 cart types + `computeCartTotals`.
- `C tests/lib/money.test.ts` — toCents/fromCents/percentToCents/clamp edge cases.
- `C tests/lib/sales.test.ts` — totals, discount clamp (0 ≤ discount ≤ subtotal), percent→cents, empty-lines
  (`[]` → all `'0.00'`).

### T3 — performSale service
- `C src/lib/performSale.ts` — C5 `performSale` + `SaleConflictError` + `SalePriceMissingError`.
- `C tests/lib/performSale.integration.test.ts` — Testcontainers: status→verkauft, transaction+items written,
  soldPrice/soldDate/paymentMethod set, double-sell guard, server-recompute, **inventory line with null
  targetPrice rejects (SalePriceMissingError, no €0.00 sale)**, **duplicate inventory purchaseId rejects**,
  gutschein-without-voucher rejects.

### T4 — Reservation service
- `C src/lib/reservation.ts` — C6 `reserveCopy`/`cancelReservation` + `ReservationConflictError`.
- `C tests/lib/reservation.integration.test.ts` — reserve/storno transitions + FOR UPDATE guard.

### T5 — quick_items catalog
- `C src/lib/quickItems.ts` — C7 list/create/update/deactivate.
- `C tests/lib/quickItems.integration.test.ts` — CRUD + tenant isolation.

### T6 — Wishlist domain
- `C src/lib/wishlist.ts` — C8 createWishlist/listWishlists/listPendingMatches/matchWishlists/
  findAndPersistWishlistMatches.
- `C tests/lib/wishlist.test.ts` — PURE `matchWishlists` (artist required + trimmed, blank-artist matches
  nothing, optional ci-substring filters, non-match); `vi.mock('server-only', () => ({}))`.
- `C tests/lib/wishlist.integration.test.ts` — persistence idempotency (unique constraint, onConflictDoNothing);
  `listPendingMatches` returns pending+open joins only (notified-wishlist matches hidden).

### T7 — Wishlist match job
- `M src/worker/index.ts` — `QUEUE.wishlistMatch` + createQueue + work + type-only payload import.
- `M src/lib/jobs.ts` — `enqueueWishlistMatch` + getBoss createQueue.
- `C src/worker/jobs/wishlistMatch.ts` — `WishlistMatchPayload` + `handleWishlistMatch`.
- `M src/app/(app)/ankauf/actions.ts` — post-commit `enqueueWishlistMatch` (C9.5).
- `C tests/worker/wishlistMatch.integration.test.ts` — non-vacuous idempotency (spy persist / count inserts).

### T8 — Wishlist notify job + email
- `M src/worker/index.ts` — `QUEUE.wishlistNotify` + createQueue + work + type-only payload import.
- `M src/lib/jobs.ts` — `enqueueWishlistNotification` + getBoss createQueue.
- `C src/worker/jobs/wishlistNotify.ts` — `WishlistNotifyPayload` + `handleWishlistNotify` (match SELECT FOR
  UPDATE before the pending gate, C9.4).
- `M src/lib/email/index.ts` — `sendWishlistNotificationEmail` (C10).
- `C tests/worker/wishlistNotify.integration.test.ts` — console adapter send-once + pending→notified, wishlist
  →notified, idempotent on re-run (spy `.send`, assert called once across two invocations).

### T9 — Server actions
- `C src/lib/csrf.ts` — shared `isValidOrigin` (extracted).
- `M src/app/(app)/ankauf/actions.ts` — import shared `isValidOrigin` (remove local copy).
- `C src/app/(app)/kasse/actions.ts` — `createSale`, `reserve`, `cancelReservation`, quick-item CRUD (C11;
  alias services with `…Svc`).
- `C src/app/(app)/wunschlisten/actions.ts` — `createWishlist`, `notifyWishlistMatch`, `dismissMatch` (C11;
  notify = read-then-enqueue, only when pending).
- `C tests/app/kasse-actions.integration.test.ts`, `C tests/app/wunschlisten-actions.integration.test.ts` —
  role gate (kunde → forbidden), CSRF, validation, happy path, notify enqueues only when pending.

### T10 — Kasse screen + components
- `C src/app/(app)/kasse/page.tsx` — server component; loads active quick_items + inventory; renders screen.
- `C src/app/(app)/kasse/_components/KasseScreen.tsx` — client orchestrator (cart state, `kasse-screen`).
- `C src/app/(app)/kasse/_components/InventorySearch.tsx` — `kasse-inventory-search` (verfuegbar/reserviert only).
- `C src/app/(app)/kasse/_components/QuickItemButtons.tsx` — `kasse-quick-item-<id>`.
- `C src/app/(app)/kasse/_components/AdhocAdd.tsx` — `kasse-adhoc-add`.
- `C src/app/(app)/kasse/_components/Cart.tsx` — `kasse-cart`, `kasse-cart-item-<key>`, `kasse-total`, `kasse-submit`.
- `C src/app/(app)/kasse/_components/DiscountInput.tsx` — `kasse-discount-input` + `kasse-discount-mode`.
- `C src/app/(app)/kasse/_components/PaymentCluster.tsx` — `kasse-pay-<method>` + `voucher-code-input` (shared).
- `C tests/app/kasse.component.test.tsx` — testids per §5.1, incl. percent-discount path via `kasse-discount-mode`.

### T11 — Einzel-Verkauf-Modal + inventory wiring
- `M src/app/(app)/inventar/_components/InventoryList.tsx` — activate "Verkaufen" (verfuegbar/reserviert only),
  add `reserve-action`/`reserve-cancel-action` + `add-to-wishlist` (♡), open SellModal.
- `C src/app/(app)/inventar/_components/SellModal.tsx` — handoff-true modal: `sell-modal`, `sell-price-input`
  (**read-only** display of `targetPrice`; if null → show `suggestSalePrice` hint, DISABLE `sell-submit`,
  surface "kein VK-Preis hinterlegt"), `sell-pay-<method>`, `voucher-code-input`, `sell-submit`, `sell-cancel`;
  submits a 1-line `{ kind:'inventory', purchaseId }` cart to `createSale`.
- `C tests/app/sell-modal.component.test.tsx` — testids per §5.2/§5.3/§5.6; price field read-only; submit
  disabled when targetPrice absent.

### T12 — Wunschlisten screen + Benachrichtigen-Modal
- `M src/app/(app)/wunschlisten/page.tsx` — real screen (replaces placeholder); loads `listWishlists` +
  `listPendingMatches` (C8).
- `C src/app/(app)/wunschlisten/_components/WishlistForm.tsx` — `wishlist-form` + `wl-*` fields + `wishlist-submit`.
- `C src/app/(app)/wunschlisten/_components/WishlistList.tsx` — status-badged list.
- `C src/app/(app)/wunschlisten/_components/MatchesSection.tsx` — `wishlist-matches`, `wl-match-<id>`,
  `wl-notify-<id>`, `wl-dismiss-<id>` (source: `PendingMatchRow[]`).
- `C src/app/(app)/wunschlisten/_components/NotifyModal.tsx` — `notify-modal`, `notify-preview` (READ-ONLY
  rendered template), `notify-send`, `notify-cancel`; preview fields from `PendingMatchRow`.
- `C tests/app/wunschlisten.component.test.tsx` — testids per §5.4/§5.5; `notify-preview` is read-only.

### T13 — Navigation + seed
- `M src/app/(app)/_components/SidebarNav.tsx` — add `Kasse` entry (lucide `ShoppingCart`); staff-gate `Kasse`
  + existing `Wunschlisten` (add a `role: Role` prop, filter staff-only items; `M src/app/(app)/layout.tsx`
  passes `user.role`).
- `M scripts/seed.ts` — seed demo `quick_items` (e.g. "Kaffee", priced) + ≥1 open wishlist whose `artist`
  matches a seed record (for E2E).

### T14 — E2E
- `C e2e/sales-wishlist.spec.ts` — sell-from-row→verkauft+transaction; POS cart inv+quick+adhoc+discount→total;
  reserve→storno; wishlist→matching Ankauf→pending match→notify→mailpit assertion; no-leak (customer data
  absent from public storefront).
- `M e2e/helpers.ts` — only if shared selectors/fixtures need extending.

### Design-token note (lesson #4)
New components use **semantic tokens only** — text on accent uses `var(--on-accent)` (NOT `--accent-ink`, NOT
raw hex). Status via `StatusBadge`. (The existing `SidebarNav` still references `--accent-ink`; do not
introduce new usages.)

---

## Contract IDs
C1 enums · C2 tables · C3 money · C4 sales-domain · C5 performSale · C6 reservation · C7 quick-items ·
C8 wishlist-domain (incl. `listPendingMatches`) · C9 queue+jobs · C10 email · C11 server-actions ·
C12 testids · C13 rls-migration · C14 file-map.
