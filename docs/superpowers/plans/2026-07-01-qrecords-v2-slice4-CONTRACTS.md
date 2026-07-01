# Slice 4 — Locked Contracts (C1–C14)

> **Binding for every task and every review.** These are the frozen interfaces, exact
> values, and cross-task conventions. A task that deviates from a contract fails review.
> Implementers see only their own task brief; this file is how neighboring tasks agree on
> names and types. Copy signatures **verbatim**.

Spec: `docs/superpowers/specs/2026-07-01-qrecords-v2-slice4-analytics-batch-labels-design.md`

---

## C1 — Money (integer-cent, never float)

`src/lib/money.ts` (existing, do NOT change):
```ts
export function toCents(value: string): number;        // '12.34' -> 1234; throws on non /^(-?)(\d+)(?:\.(\d{1,2}))?$/
export function fromCents(cents: number): string;      // 1234 -> '12.34'; throws if non-integer
export function percentToCents(baseCents: number, percent: number): number; // Math.round(base*percent/100)
export function clamp(value: number, min: number, max: number): number;
export function sumLineCents(lines: { unitCents: number; quantity: number }[]): number;
```
- DB money columns are `numeric(10,2)` → Drizzle returns/accepts **strings**. Convert string→cents with
  `toCents` at the read boundary, do ALL arithmetic in integer cents, `fromCents` only for display/return/CSV.
- The zod money validator (copy verbatim): `const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);`

## C2 — Mutating server-action boilerplate (exact order)

Every mutating action file starts with `'use server';` and each action is:
```ts
export async function xAction(input: unknown): Promise<XResult> {
  const user = await requireSession();                       // '@/auth/session'
  if (user.role === 'kunde') forbidden();                    // 'next/navigation'
  if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' }; // '@/lib/csrf'
  const parsed = xSchema.safeParse(input);                   // 'zod'
  if (!parsed.success) return { ok: false, reason: 'validation', message: parsed.error.message };
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const result = await someService(ctx, parsed.data);      // '@/lib/*' owns the single withTenant tx
    revalidatePath(/* every route whose data changed */);    // 'next/cache'
    return { ok: true, /* ids/values */ };
  } catch (e) {
    if (e instanceof SomeDomainError) return { ok: false, reason: 'conflict', message: e.message };
    return { ok: false, reason: 'error' };
  }
}
```
- Result type is always a discriminated union:
  `{ ok: true; … } | { ok: false; reason: 'validation' | 'conflict' | 'not_found' | 'error'; message?: string }`.
- **Never throw to the client.** Actions never open `withTenant` themselves (except the read-then-enqueue
  pattern in C10) — the delegated `@/lib/*` service owns the one tx.
- `requireSession()` returns `SessionUser = { id:number; email:string; tenantId:number; role:Role; isSuperadmin:boolean }`
  (`src/auth/session.ts`); redirects to `/login` if no user, `forbidden()` on tenant mismatch.
- `isValidOrigin()` is defense-in-depth CSRF (returns true when origin/host absent) — NOT the auth gate.

## C3 — RLS / `withTenant` + `collections` RLS SQL

- `withTenant(ctx: TenantCtx, fn)` (`@/db/tenant`) is the ONLY runtime DB surface; `TenantCtx = { tenantId: number; userId?: number }`.
  One tx, `set_config('app.current_tenant'/'app.current_user_id', …, true)`. Never `SET` (only `SET LOCAL`/`set_config(…, true)`).
- `drizzle/0009_slice4_rls.sql` — for `collections`, VERBATIM shape of `0007_slice3_rls.sql` (statement-breakpoints included):
```sql
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "collections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "collections"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "collections"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "collections" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "collections_id_seq" TO qr_app;
```
- `purchases.collection_id` and `quick_items.category` need NO new policy — those tables already have RLS.

## C4 — Schema additions (`src/db/schema.ts`, Drizzle)

```ts
export const collections = pgTable(
  'collections',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id').notNull().references(() => tenants.id),
    sellerName: text('seller_name').notNull(),
    sellerContact: text('seller_contact'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantAcquiredIdx: index('collections_tenant_acquired_idx').on(t.tenantId, t.acquiredAt),
  }),
);
```
- `purchases`: add `collectionId: integer('collection_id').references(() => collections.id)` (nullable) +
  index `purchases_collection_idx` on `(t.tenantId, t.collectionId)`.
- `quickItems`: add `category: text('category')` (nullable).
- Follow existing declaration style (see `records`/`purchases` in schema.ts). `collections` must be declared
  AFTER `users`/`tenants` and BEFORE `purchases`'s FK reference resolves — Drizzle handles forward refs via
  the `() =>` thunk, so ordering is not load-bearing, but place `collections` near `purchases` for readability.

## C5 — Migrations + boot assertion

- `drizzle/0008_slice4_collections.sql` — generated by `pnpm drizzle-kit generate` (collections DDL + the two
  ALTER TABLE ADD COLUMN + indexes + FKs). `drizzle/0009_slice4_rls.sql` — hand-authored (C3).
- Register BOTH in `drizzle/meta/_journal.json`: idx 8 tag `0008_slice4_collections`, idx 9 tag `0009_slice4_rls`
  (`version:"7"`, `breakpoints:true`), each with the drizzle-kit snapshot in `drizzle/meta/`.
- `src/db/assertions.ts`: append `'collections'` to `TENANT_SCOPED_TABLES`.
- `tests/db/assertions.test.ts`: append `'collections'` to the `SOUND_TENANT_ID_TABLES` mock baseline
  (kept in lockstep — the drift guard fails otherwise).

## C6 — Analytics types (FROZEN — screen, module, and CSV must agree)

`src/lib/analytics.ts`:
```ts
export type AnalyticsPeriod = 'week' | 'month' | 'quarter';

export interface Kpi {
  label: string;
  value: string;          // preformatted display value, e.g. '€ 8.940' or '61 %' or '312'
  sub: string;            // e.g. 'ggü. Vorwoche' / 'Ø € 28,70 / Bon' / '47 Sammlungen' / 'Wareneinsatz 39 %'
  up: boolean;            // trend direction; color resolved at render (up→--ok, down→--bad)
  deltaLabel: string;     // e.g. '▲ 12 %' / '▼ 3 %' / '▲ 2 pt'
}
export interface BarPoint { label: string; valueCents: number; }
export interface CategorySlice { label: string; valueCents: number; colorVar: string; } // colorVar e.g. 'var(--accent)'
export interface WeekdayBar { day: string; pct: number; }   // 0..100 (peak=100)
export interface TimeBucket { label: string; pct: number; } // 0..100 relative to max
export interface TopRecord {
  artist: string; title: string; genre: string | null;
  sales: number; revenueCents: number; marginPct: number;
}
export interface AnalyticsData {
  period: AnalyticsPeriod;
  rangeLabel: string;   // '16.–22. Juni 2026'
  storeName: string;    // tenants.name
  kpis: { umsatz: Kpi; transaktionen: Kpi; ankaeufe: Kpi; rohmarge: Kpi };
  umsatzverlauf: { bars: BarPoint[]; totalCents: number; subLabel: string }; // subLabel e.g. 'letzte 7 Tage'
  kategorie: CategorySlice[];
  wochentag: { bars: WeekdayBar[]; bestDay: string };
  tageszeit: { buckets: TimeBucket[]; bestTime: string; consistency: string };
  topRecords: TopRecord[];
}
```

## C7 — Analytics functions + timezone + granularity

`src/lib/analytics-period.ts` (pure, no DB):
```ts
export interface PeriodRange { start: Date; end: Date; prevStart: Date; prevEnd: Date; rangeLabel: string; }
export function periodRange(period: AnalyticsPeriod, now: Date): PeriodRange;
```
- `week` = current ISO week Mon 00:00 → next Mon 00:00 (Europe/Berlin); prev = the 7 days before.
- `month` = 1st of month → 1st of next month; prev = previous calendar month.
- `quarter` = 1st of quarter → 1st of next quarter; prev = previous quarter.
- `rangeLabel`: week `'16.–22. Juni 2026'`; month `'Juni 2026'`; quarter `'Q2 2026'` (German month names).

`src/lib/analytics.ts`:
```ts
export async function getAnalytics(ctx: TenantCtx, period: AnalyticsPeriod): Promise<AnalyticsData>; // ONE withTenant read tx
```
- ALL day/hour bucketing via SQL `(<col> AT TIME ZONE 'Europe/Berlin')`. Money summed as `numeric`, converted to
  cents via `toCents(String(sum))` at the boundary.
- **Umsatzverlauf granularity:** `week` → 7 daily bars (labels `Mo…So`); `month` → weekly bars (labels `KW nn`);
  `quarter` → 3 monthly bars (labels German month short). Bar height (render side): `Math.round(v/max*100)+'%'`.
- **KPIs:** Umsatz `SUM(transactions.total)` (up vs prev); Transaktionen `COUNT` (sub `'Ø € x / Bon'`);
  Ankäufe `COUNT(purchases WHERE created_at ∈ range)` (sub `'<n> Sammlungen'` = `COUNT(collections ∈ range)`);
  Rohmarge = `round(SUM(soldPrice−purchasePrice)/NULLIF(SUM(soldPrice),0)*100)` over purchases with
  `status='verkauft' AND sold_date ∈ range` (sub `'Wareneinsatz <100−marge> %'`, deltaLabel in `pt`).
- **Kategorie mapping:** transaction_items line → category: has `purchase_id` → `records.format`
  (`'Vinyl'→'Vinyl'`, `'CD'→'CD'`, else `'Sonstiges'`); has `quick_item_id` → `quick_items.category ?? 'Sonstiges'`.
  colorVar: `Vinyl→var(--accent)`, `CD→var(--info)`, `Getränke→var(--honey)`, else `var(--text-3)`.
- **Tageszeit buckets (exact labels/edges):** `'Vormittag · 11–14 Uhr'` [11,14), `'Mittag · 14–16 Uhr'` [14,16),
  `'Nachmittag · 16–18 Uhr'` [16,18), `'Abend · 18–20 Uhr'` [18,20).
- **Top-N** = 5, by `SUM(quantity)` desc then revenue.

## C8 — Chart token conventions (all analytics components)

- Bar/track colors: peak bar `var(--accent)`, non-peak `var(--accent-soft)`; horizontal-bar track background
  `var(--surface-3)`, radius `var(--r-pill)`. Tageszeit peak `var(--accent)` else `var(--honey)`.
- Category series fixed per C7 (accent/info/honey/text-3).
- KPI trend color at render: `up ? 'var(--ok)' : 'var(--bad)'`. Never store the color.
- Card shell = `Card` from `@/components/ui` (`elevation={1}`). Period toggle = `SegmentedControl` from `@/components/ui`.
- Values use `var(--font-mono)`. NO raw hex anywhere. Translate handoff `sc-for`→`.map`, `sc-if`→conditional, `{{x}}`→`{x}`.

## C9 — Reserved (folded into C7/C8)

## C10 — Batch-Ankauf: `acquireOne` + collections service

`src/lib/ankauf.ts` — extract the core, keep `performAnkauf` behavior identical:
```ts
// NEW exported helper; runs INSIDE an existing tx (no withTenant of its own):
export async function acquireOne(
  tx: DbTx, ctx: TenantCtx, input: AnkaufInput, collectionId: number | null,
): Promise<{ recordId: number; purchaseId: number }>;
// performAnkauf now: return withTenant(ctx, (tx) => acquireOne(tx, ctx, input, null));
```
- `acquireOne` = the current hash-dedup `records.onConflictDoUpdate` + always-new `purchases` insert, PLUS
  `collectionId` written to `purchases.collection_id`. `DbTx` = the tx handle type used by `withTenant`'s callback.
- `AnkaufInput` (existing, reuse verbatim): `{ release: AnkaufRelease; purchasePrice: string; targetPrice: string; conditionRecord: number; conditionCover: number; listOnDiscogs: boolean }`.

`src/lib/collections.ts`:
```ts
export interface CreateCollectionInput {
  sellerName: string; sellerContact?: string; note?: string; acquiredAt?: Date;
  items: AnkaufInput[];   // reuse AnkaufInput per item
}
export interface CollectionSummary { id: number; sellerName: string; acquiredAt: Date; itemCount: number; totalEkCents: number; }
export interface CollectionDetailItem { purchaseId: number; recordId: number; artist: string; title: string; format: string | null; conditionRecord: number; purchasePriceCents: number; targetPriceCents: number | null; discogsId: number | null; }
export interface CollectionDetail extends CollectionSummary { sellerContact: string | null; note: string | null; items: CollectionDetailItem[]; }

export async function createCollection(ctx: TenantCtx, input: CreateCollectionInput): Promise<{ collectionId: number; purchaseIds: number[]; recordIds: number[] }>;
export async function listCollections(ctx: TenantCtx): Promise<CollectionSummary[]>;
export async function getCollection(ctx: TenantCtx, id: number): Promise<CollectionDetail | null>;
```
- `createCollection`: ONE `withTenant` tx — insert `collections`, then `for (const item of items) acquireOne(tx, ctx, item, collectionId)`.
  Fail-closed: any item throwing rolls back the whole collection. `input.items` must be non-empty (zod `.min(1)`).
- `totalEkCents` = `Σ toCents(purchase_price)`.

## C11 — Jobs reuse (no new queue)

- Reuse `enqueueWishlistMatch({ tenantId, recordId })` and `enqueueDiscogsListing({ tenantId, purchaseId })` from `@/lib/jobs`.
- **Post-commit, outside the tx, isolated:** after `createCollection`'s tx commits, the ACTION (not the service) enqueues,
  in its own try/catch, one `enqueueWishlistMatch` per `recordId` (+ `enqueueDiscogsListing` per purchase whose item had
  `listOnDiscogs`). A failed enqueue must NOT fail the committed collection (log + soft-continue). Every payload carries `tenantId`.

## C12 — Labels (client jsPDF, A4)

`src/lib/labels.ts` (pure, no jsPDF import):
```ts
export interface LabelItem { artist: string; title: string; format: string | null; conditionRecord: number; priceCents: number | null; discogsId: number | null; }
export interface LabelTemplate { cols: number; rows: number; pageW: number; pageH: number; marginX: number; marginY: number; gutterX: number; gutterY: number; } // mm
export const AVERY_3x8: LabelTemplate; // cols:3, rows:8 (24/A4), A4 210×297
export interface LabelCell { x: number; y: number; w: number; h: number; }
export function labelGridLayout(index: number, template: LabelTemplate): { page: number; cell: LabelCell };
export function discogsReleaseUrl(discogsId: number): string; // `https://www.discogs.com/release/${discogsId}`
export function labelPriceText(priceCents: number | null): string; // fromCents → '€ 12,00' or '—'
```
- `src/app/(app)/inventar/_components/LabelPrintModal.tsx` — `Modal` from `@/components/ui`; jsPDF + qrcode via
  **dynamic import** inside the print handler (`const { jsPDF } = await import('jspdf')`), never top-level (keeps
  them out of the server/initial bundle). QR only when `discogsId != null` (→ `discogsReleaseUrl`), else no QR.
- Label content: `artist — title`, `format · conditionLabel(conditionRecord)`, big price `labelPriceText`, optional QR.

## C13 — CSV export

`src/lib/analytics-csv.ts` (pure):
```ts
export interface CsvTxRow { createdAt: Date; id: number; paymentMethod: string; subtotalCents: number; discountCents: number; totalCents: number; }
export function serializeAnalyticsCsv(rows: CsvTxRow[], capped: boolean): string;
```
- Columns (header row, German, `;`-separated for DE-Excel): `Datum;Bon-Nr;Zahlart;Zwischensumme;Rabatt;Summe`.
  Date `de-DE` `YYYY-MM-DD HH:mm`; money via `fromCents`. Escape any field containing `;`/`"`/newline by wrapping in `"`
  and doubling `"`. If `capped`, append a final line `# Hinweis: auf 10000 Zeilen begrenzt`.
- Route `src/app/(app)/analytik/export/route.ts` — `GET`, `requireSession()` + `if (user.role==='kunde') forbidden()`,
  read via `withTenant`, cap 10 000 rows. Headers: `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="analytik-<period>-<start>.csv"`. `period` query parsed via
  `AnalyticsPeriod`; default `'week'`.

## C14 — Testid registry (FROZEN) + UI reuse + revalidate + deps

**Testids (kebab, screen-prefixed — add ONLY these; controls without a testid are selected by accessible name):**
- Analytik: `analytik-screen`, `analytik-period-toggle`, `analytik-kpis`, `analytik-revenue-bars`,
  `analytik-category-bar`, `analytik-weekday-bars`, `analytik-time-buckets`, `analytik-top-records`, `analytik-csv-export`.
- Batch-Ankauf: `sammlung-screen`, `sammlung-seller-input`, `sammlung-add-item`, `sammlung-items`, `sammlung-submit`,
  `sammlungen-list`, `sammlung-row`, `sammlung-detail`, `sammlung-print-labels`.
- Etiketten: `label-print-modal`, `label-print-open`, `label-print-submit`, `label-template-select`.

**UI primitives to reuse (`@/components/ui`, do NOT rebuild):** `SegmentedControl` (period toggle), `Card`
(KPI/widget shells), `Modal` (LabelPrintModal), `Checkbox` (inventory multi-select), `StatusBadge`, `ConditionPill`,
`Button`, `Input`, `Select`, `Textarea`, `SearchField`, `Spinner`. KpiCard exists but is dashboard-shaped
(label+icon header) — analytics KPIs need label+trend header, so build `AnalyticsKpis` on the `Card` primitive directly.

**`pricing.ts` reuse:** `CONDITION_PILLS`, `conditionLabel(g)`, `conditionFromLabel(label)`, `discogsGradeKey`,
`conditionFactor`, `suggestSalePrice({ suggestion, median, conditionRecord })`, `DEFAULT_CONDITION_RECORD=5`,
`DEFAULT_CONDITION_COVER=4`.

**revalidatePath targets:** `createCollectionAction` → `revalidatePath('/inventar')`, `revalidatePath('/')`,
`revalidatePath('/analytik')`, `revalidatePath('/ankauf/sammlungen')`.

**New deps (package.json):** `jspdf` (label PDF, dynamic import) + `qrcode` (QR dataURL). No chart lib, no CSV lib,
no server-PDF lib. Add `@types/qrcode` to devDependencies.
