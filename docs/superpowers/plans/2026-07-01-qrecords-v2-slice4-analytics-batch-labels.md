# Slice 4 — Analytik + Batch-Ankauf + Etiketten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking. **The locked contracts live in `2026-07-01-qrecords-v2-slice4-CONTRACTS.md` (C1–C14) — every
> task is bound by them; copy signatures verbatim.**

**Goal:** Ship the analytics screen (+CSV export), first-class batch-Ankauf (collections), and A4 price-label
printing as one reviewed, merged vertical slice — pixel-true to the 2026 design handoff.

**Architecture:** Three decoupled modules on the existing multi-tenant codebase. Analytics is a read-only
aggregation module (`getAnalytics`) rendered by a server component with hand-rolled token-`div` charts (no chart
lib) and period as a URL search param. Batch-Ankauf adds a `collections` entity and a `createCollection` service
that shares the extracted `acquireOne` core with Slice 2's `performAnkauf`. Labels are generated client-side with
jsPDF (dynamic import). All mutations follow the frozen server-action boilerplate; all money is integer-cent.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Tailwind v4 · Drizzle ORM · PostgreSQL 17 ·
pg-boss · Vitest + @testcontainers/postgresql · Playwright · jsPDF · qrcode.

## Global Constraints

- **Money:** `numeric(10,2)` storage; exact arithmetic in integer cents via `src/lib/money.ts`; never JS float;
  `fromCents` only at display/CSV edge (C1).
- **RLS:** only `withTenant(ctx, fn)` at runtime; new `collections` table gets the full RLS block + sequence GRANT
  (C3); `TENANT_SCOPED_TABLES` + test mock baseline in lockstep (C5).
- **RBAC + CSRF:** every mutating action `requireSession()` → `if (user.role==='kunde') forbidden()` →
  `isValidOrigin()` → zod → delegate → `revalidatePath` (C2). No customer PII/sales internals on the public storefront.
- **Jobs:** reuse `enqueueWishlistMatch`/`enqueueDiscogsListing`; post-commit enqueue isolated in its own try/catch;
  every payload carries `tenantId` (C11). No new queue.
- **Design:** semantic CSS vars only (no raw hex); charts = token-`div`s; reuse `@/components/ui` primitives (C8, C14).
- **Testids:** only the FROZEN C14 registry; other controls selected by accessible name/label.
- **Migrations:** `0008_slice4_collections` (generated) + `0009_slice4_rls` (hand-authored), both registered in
  `_journal.json` with snapshots (C5).
- **Commits:** feature branch `feat/v2-slice4-analytics-batch-labels` only, never `main`; `.superpowers/` never
  committed; every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

**Create:**
- `src/lib/analytics-period.ts` — pure period→range/label logic (C7).
- `src/lib/analytics.ts` — `getAnalytics` aggregation module + `AnalyticsData` types (C6/C7).
- `src/lib/analytics-csv.ts` — pure CSV serializer (C13).
- `src/lib/collections.ts` — `createCollection`/`listCollections`/`getCollection` (C10).
- `src/lib/labels.ts` — pure label grid/URL/price helpers (C12).
- `drizzle/0008_slice4_collections.sql`, `drizzle/0009_slice4_rls.sql` (+ snapshots).
- `src/app/(app)/analytik/_components/{PeriodToggle,AnalyticsKpis,RevenueBars,CategoryBar,WeekdayBars,TimeBuckets,TopRecordsTable,CsvExportButton}.tsx`.
- `src/app/(app)/analytik/export/route.ts`.
- `src/app/(app)/ankauf/sammlung/{page.tsx,actions.ts,_components/*}`.
- `src/app/(app)/ankauf/sammlungen/{page.tsx,[id]/page.tsx}`.
- `src/app/(app)/inventar/_components/LabelPrintModal.tsx`.
- `e2e/analytics-batch-labels.spec.ts`.
- Tests colocated under `tests/` mirroring existing layout.

**Modify:**
- `src/db/schema.ts` (collections + `purchases.collection_id` + `quick_items.category`), `src/db/assertions.ts`,
  `tests/db/assertions.test.ts`, `drizzle/meta/_journal.json`.
- `src/lib/ankauf.ts` (extract `acquireOne`).
- `src/app/(app)/analytik/page.tsx` (replace placeholder).
- `src/app/(app)/inventar/_components/InventoryList.tsx` (multi-select + label entry).
- `src/app/(app)/_components/SidebarNav.tsx` (Sammlung/Sammlungen entries).
- `scripts/seed.ts` (demo collection + `quick_items.category`).
- `package.json` (jspdf, qrcode, @types/qrcode).

## Task Overview

1. **DB foundation** — schema, migrations, RLS, assertions (+ RLS isolation test).
2. **Analytics period logic** — `analytics-period.ts` (pure, TDD).
3. **Analytics data module** — `getAnalytics` (integration, Testcontainers).
4. **Analytics screen** — page + chart components (component tests).
5. **CSV export** — serializer (pure) + route handler (integration).
6. **acquireOne + collections service** — refactor + `createCollection`/list/get (integration).
7. **Batch-Ankauf wizard** — screen + action (security + component).
8. **Collections list + detail** — two read screens.
9. **Label printing** — `labels.ts` + `LabelPrintModal` + entry points.
10. **Navigation + seed** — sidebar entries + demo data.
11. **E2E acceptance** — full-stack Playwright scenarios.

---

### Task 1: DB foundation (collections, columns, migrations, RLS, assertions)

**Files:**
- Modify: `src/db/schema.ts`, `src/db/assertions.ts`, `tests/db/assertions.test.ts`, `drizzle/meta/_journal.json`
- Create: `drizzle/0008_slice4_collections.sql` (+ snapshot), `drizzle/0009_slice4_rls.sql`
- Test: `tests/db/collections-rls.test.ts`

**Interfaces:**
- Produces: `collections` table, `purchases.collectionId`, `quickItems.category` (C4); RLS per C3; assertion coverage (C5).

- [ ] **Step 1: Add the schema (C4).** In `src/db/schema.ts` add the `collections` table exactly as C4, then add
  `collectionId: integer('collection_id').references(() => collections.id)` + `purchases_collection_idx` to `purchases`,
  and `category: text('category')` to `quickItems`. Place `collections` above `purchases`.

- [ ] **Step 2: Generate the DDL migration.**
  Run: `pnpm drizzle-kit generate --name slice4_collections`
  Expected: creates `drizzle/0008_slice4_collections.sql` (CREATE TABLE collections + 2 ALTER TABLE ADD COLUMN +
  indexes + FKs) and a snapshot in `drizzle/meta/`. Inspect it contains `"collections"`, `"collection_id"`, `"category"`.

- [ ] **Step 3: Hand-author the RLS migration.** Create `drizzle/0009_slice4_rls.sql` with the VERBATIM C3 block for
  `collections` (ENABLE+FORCE, NULLIF-GUC default, tenant_isolation + superadmin_bypass, DML GRANT, sequence GRANT).

- [ ] **Step 4: Register both migrations in `drizzle/meta/_journal.json`.** Append idx 8
  (`{"idx":8,"version":"7","when":<ts>,"tag":"0008_slice4_collections","breakpoints":true}`) and idx 9
  (`…"tag":"0009_slice4_rls"…`). Ensure the drizzle-kit snapshot json files exist for 0008; for 0009 copy the 0008
  snapshot forward (RLS-only migration doesn't change the drizzle schema hash — mirror how 0007 was registered after 0006).

- [ ] **Step 5: Update the boot assertion + mock baseline (C5).** In `src/db/assertions.ts` append `'collections'` to
  `TENANT_SCOPED_TABLES`. In `tests/db/assertions.test.ts` append `'collections'` to the `SOUND_TENANT_ID_TABLES`
  mock baseline.

- [ ] **Step 6: Write the RLS isolation test (fails first).** `tests/db/collections-rls.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { withTenant } from '@/db/tenant';
import { collections } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { setupTestDb, seedTenant } from './helpers'; // existing testcontainer harness

describe('collections RLS isolation', () => {
  it('a tenant cannot read another tenant\'s collection', async () => {
    const a = await seedTenant('a'); const b = await seedTenant('b');
    const { collectionId } = await withTenant({ tenantId: a.id, userId: a.userId }, async (tx) => {
      const [c] = await tx.insert(collections).values({ tenantId: a.id, sellerName: 'Seller A' }).returning({ id: collections.id });
      return { collectionId: c!.id };
    });
    const rowsFromB = await withTenant({ tenantId: b.id, userId: b.userId }, (tx) =>
      tx.select().from(collections).where(eq(collections.id, collectionId)));
    expect(rowsFromB).toHaveLength(0);            // RLS hides it
  });

  it('insert defaults tenant_id from the GUC and rejects cross-tenant writes', async () => {
    const a = await seedTenant('a');
    const rows = await withTenant({ tenantId: a.id, userId: a.userId }, async (tx) => {
      await tx.insert(collections).values({ sellerName: 'GUC default' } as any); // tenant_id omitted → GUC default
      return tx.select().from(collections);
    });
    expect(rows.every((r) => r.tenantId === a.id)).toBe(true);
  });
});
```
  (Adapt `setupTestDb`/`seedTenant` import to the existing helper names in `tests/db/`.)

- [ ] **Step 7: Apply migrations + run tests.**
  Run: `pnpm test tests/db/collections-rls.test.ts tests/db/assertions.test.ts`
  Expected: PASS (the harness applies `drizzle/` migrations incl. 0008/0009 to the container). If the RLS test can
  read across tenants, the RLS block or sequence GRANT is wrong — fix `0009`.

- [ ] **Step 8: Typecheck + commit.**
  Run: `pnpm typecheck` → clean.
```bash
git add src/db drizzle tests/db
git commit -m "feat(slice4): collections table + purchases.collection_id + quick_items.category (schema, RLS, assertions)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Analytics period logic (pure)

**Files:**
- Create: `src/lib/analytics-period.ts`
- Test: `tests/lib/analytics-period.test.ts`

**Interfaces:**
- Produces (C7): `periodRange(period, now): PeriodRange`, `AnalyticsPeriod`, `PeriodRange`.
- Consumed by: Task 3 (`getAnalytics`), Task 5 (CSV route).

- [ ] **Step 1: Write the failing tests.** `tests/lib/analytics-period.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { periodRange } from '@/lib/analytics-period';

// Wednesday 2026-06-17 12:00 Europe/Berlin
const now = new Date('2026-06-17T10:00:00.000Z');

describe('periodRange', () => {
  it('week = ISO Mon..next Mon with prev week and German range label', () => {
    const r = periodRange('week', now);
    expect(r.start.toISOString()).toBe('2026-06-14T22:00:00.000Z'); // Mon 2026-06-15 00:00 Berlin (CEST +2)
    expect(r.end.toISOString()).toBe('2026-06-21T22:00:00.000Z');   // next Mon
    expect(r.prevStart.toISOString()).toBe('2026-06-07T22:00:00.000Z');
    expect(r.prevEnd.toISOString()).toBe('2026-06-14T22:00:00.000Z');
    expect(r.rangeLabel).toBe('15.–21. Juni 2026');
  });
  it('month = 1st..1st next month, label "Juni 2026"', () => {
    const r = periodRange('month', now);
    expect(r.rangeLabel).toBe('Juni 2026');
    expect(r.start.toISOString()).toBe('2026-05-31T22:00:00.000Z'); // 2026-06-01 00:00 Berlin
    expect(r.end.toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });
  it('quarter = Q boundaries, label "Q2 2026"', () => {
    const r = periodRange('quarter', now);
    expect(r.rangeLabel).toBe('Q2 2026');
    expect(r.start.toISOString()).toBe('2026-03-31T22:00:00.000Z'); // 2026-04-01 00:00 Berlin
    expect(r.end.toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });
});
```
  (If the harness runs in UTC, compute the Berlin offset with `Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin'})`
  inside the implementation — do NOT hardcode +2; the test values above assume CEST for June. Add a December case to
  cover CET +1.)

- [ ] **Step 2: Run the tests — expect FAIL** (`periodRange` not defined).
  Run: `pnpm test tests/lib/analytics-period.test.ts`

- [ ] **Step 3: Implement `analytics-period.ts`.** Compute Berlin-local midnight boundaries by formatting `now` in
  `Europe/Berlin`, deriving the local Y/M/D and weekday, then constructing the UTC instant for that local midnight
  (account for the CET/CEST offset via `Intl`). Build `rangeLabel` with German month names
  (`['Januar',…,'Dezember']`). Return `{ start, end, prevStart, prevEnd, rangeLabel }`. No `Date.now()` — always take `now` as a param.

- [ ] **Step 4: Run the tests — expect PASS.**

- [ ] **Step 5: Typecheck + commit.**
```bash
git add src/lib/analytics-period.ts tests/lib/analytics-period.test.ts
git commit -m "feat(slice4): analytics period ranges (week/month/quarter, Europe/Berlin)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Analytics data module `getAnalytics` (integration)

**Files:**
- Create: `src/lib/analytics.ts` (types per C6 + `getAnalytics`)
- Test: `tests/lib/analytics.test.ts` (Testcontainers)

**Interfaces:**
- Consumes: `periodRange` (Task 2, C7), `toCents`/`fromCents` (C1), `withTenant` (C3).
- Produces (C6): `getAnalytics(ctx, period): Promise<AnalyticsData>`, all `AnalyticsData` types.

- [ ] **Step 1: Declare the frozen types.** Copy the C6 type block into the top of `src/lib/analytics.ts` verbatim
  (`AnalyticsPeriod`, `Kpi`, `BarPoint`, `CategorySlice`, `WeekdayBar`, `TimeBucket`, `TopRecord`, `AnalyticsData`).

- [ ] **Step 2: Write the failing integration test.** `tests/lib/analytics.test.ts` — seed one tenant with a known
  set of transactions/purchases/collections spanning the current week, then assert each block. Use a FIXED `now`
  passed through a test-only overload or seed rows relative to `new Date()` and assert invariants (not absolute money):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { getAnalytics } from '@/lib/analytics';
import { seedAnalyticsFixture } from './helpers-analytics'; // create: inserts records/purchases/transactions/collections

describe('getAnalytics(week)', () => {
  let ctx: { tenantId: number; userId: number };
  beforeAll(async () => { ctx = await seedAnalyticsFixture(); });

  it('KPI Umsatz equals the sum of this-week transaction totals', async () => {
    const a = await getAnalytics(ctx, 'week');
    expect(a.kpis.umsatz.value).toMatch(/€/);
    expect(a.period).toBe('week');
    expect(a.umsatzverlauf.bars).toHaveLength(7);                 // 7 daily bars
    expect(a.umsatzverlauf.totalCents).toBeGreaterThan(0);
  });
  it('Kategorie splits Vinyl/CD via records.format and quick_items.category', async () => {
    const a = await getAnalytics(ctx, 'week');
    const labels = a.kategorie.map((c) => c.label);
    expect(labels).toContain('Vinyl');
    const vinyl = a.kategorie.find((c) => c.label === 'Vinyl')!;
    expect(vinyl.colorVar).toBe('var(--accent)');
    expect(a.kategorie.reduce((s, c) => s + c.valueCents, 0)).toBeGreaterThan(0);
  });
  it('Rohmarge is 0..100 and Ankäufe sub names the Sammlungen count', async () => {
    const a = await getAnalytics(ctx, 'week');
    expect(a.kpis.rohmarge.value).toMatch(/%$/);
    expect(a.kpis.ankaeufe.sub).toMatch(/Sammlung/);
    expect(a.topRecords.length).toBeLessThanOrEqual(5);
    expect(a.wochentag.bars).toHaveLength(7);
    expect(a.tageszeit.buckets.map((b) => b.label)).toEqual([
      'Vormittag · 11–14 Uhr','Mittag · 14–16 Uhr','Nachmittag · 16–18 Uhr','Abend · 18–20 Uhr',
    ]);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`getAnalytics` not defined).
  Run: `pnpm test tests/lib/analytics.test.ts`

- [ ] **Step 4: Implement `getAnalytics`** as ONE `withTenant` read (C7). Concrete building blocks (use `sql` from
  `drizzle-orm`; all time bucketing `AT TIME ZONE 'Europe/Berlin'`):
  - `const { start, end, prevStart, prevEnd, rangeLabel } = periodRange(period, new Date());`
  - **KPIs** — two range-scoped aggregate queries (current + prev):
    ```ts
    // Umsatz + Transaktionen
    sql`SELECT COALESCE(SUM(total),0)::text AS umsatz, COUNT(*)::int AS tx
        FROM transactions WHERE created_at >= ${start} AND created_at < ${end}`
    // Ankäufe + Sammlungen
    sql`SELECT COUNT(*)::int AS ankaeufe FROM purchases WHERE created_at >= ${start} AND created_at < ${end}`
    sql`SELECT COUNT(*)::int AS sammlungen FROM collections WHERE acquired_at >= ${start} AND acquired_at < ${end}`
    // Rohmarge
    sql`SELECT COALESCE(SUM(sold_price - purchase_price),0)::text AS profit, COALESCE(SUM(sold_price),0)::text AS revenue
        FROM purchases WHERE status='verkauft' AND sold_date >= ${start} AND sold_date < ${end}`
    ```
    Build each `Kpi` per C6: `value` via `fromCents`+German format helper, `up` = current ≥ prev, `deltaLabel`
    (`'▲ 12 %'`/`'▼ 3 %'`; Rohmarge in `pt`). Money format helper: `formatEuro(cents) => '€ ' + de-DE grouping`.
  - **Umsatzverlauf** — bucket `SUM(total)` by day/week/month per granularity (C7):
    ```ts
    // week: 7 daily buckets
    sql`SELECT to_char((created_at AT TIME ZONE 'Europe/Berlin'), 'Dy') AS lbl,
               date_trunc('day', created_at AT TIME ZONE 'Europe/Berlin') AS d,
               COALESCE(SUM(total),0)::text AS v
        FROM transactions WHERE created_at >= ${start} AND created_at < ${end} GROUP BY d ORDER BY d`
    ```
    Fill missing days with 0 to always return 7 (week)/N bars; German day labels `Mo…So`. `totalCents` = Σ.
    `subLabel` = `'letzte 7 Tage'` (week) / `'letzte Wochen'` (month) / `'letzte Monate'` (quarter).
  - **Kategorie** — one query over `transaction_items` joined to `purchases`→`records` and `quick_items`:
    ```ts
    sql`SELECT CASE
          WHEN ti.purchase_id IS NOT NULL THEN CASE r.format WHEN 'Vinyl' THEN 'Vinyl' WHEN 'CD' THEN 'CD' ELSE 'Sonstiges' END
          ELSE COALESCE(qi.category, 'Sonstiges') END AS cat,
          COALESCE(SUM(ti.unit_price * ti.quantity),0)::text AS v
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.transaction_id
        LEFT JOIN purchases p ON p.id = ti.purchase_id
        LEFT JOIN records r ON r.id = p.record_id
        LEFT JOIN quick_items qi ON qi.id = ti.quick_item_id
        WHERE t.created_at >= ${start} AND t.created_at < ${end} GROUP BY cat ORDER BY v DESC`
    ```
    Map `cat`→`colorVar` per C7 (`Vinyl→var(--accent)`, `CD→var(--info)`, `Getränke→var(--honey)`, else `var(--text-3)`).
  - **Wochentag** — `SUM(total)` grouped by `EXTRACT(dow FROM created_at AT TIME ZONE 'Europe/Berlin')`; reorder
    Mon-first (Postgres dow: 0=Sun); normalize `pct = round(v/max*100)`; `bestDay` = day with max.
  - **Tageszeit** — the four fixed buckets (C7) via a `CASE` on `EXTRACT(hour …)`; `pct` relative to max; peak bucket
    → `bestTime`; `consistency` = a text label from the coefficient of variation (e.g. `'gleichmäßig'`/`'schwankend'`).
  - **Top-N** — `transaction_items`→`purchases`→`records`, `SUM(quantity)` desc limit 5, with genre (`records.genre[1]`),
    `revenueCents`, `marginPct` (`round(SUM(unit_price-purchase_price)/SUM(unit_price)*100)`).
  - `storeName` from `tenants.name` (single-row read scoped by RLS).
  - Return the assembled `AnalyticsData`.

- [ ] **Step 5: Run — expect PASS.** Run: `pnpm test tests/lib/analytics.test.ts`

- [ ] **Step 6: Typecheck + commit.**
```bash
git add src/lib/analytics.ts tests/lib/analytics.test.ts tests/lib/helpers-analytics.ts
git commit -m "feat(slice4): getAnalytics aggregation module (KPIs, charts, top-N; Europe/Berlin)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Analytics screen + chart components

**Files:**
- Modify: `src/app/(app)/analytik/page.tsx` (replace placeholder)
- Create: `src/app/(app)/analytik/_components/{PeriodToggle,AnalyticsKpis,RevenueBars,CategoryBar,WeekdayBars,TimeBuckets,TopRecordsTable,CsvExportButton}.tsx`
- Test: `tests/app/analytik.test.tsx` (component render from fixture `AnalyticsData`)

**Interfaces:**
- Consumes: `getAnalytics` (Task 3), `AnalyticsData` types (C6), `SegmentedControl`/`Card` (C14), chart tokens (C8).

- [ ] **Step 1: Write failing component tests.** Render each widget from a hand-built `AnalyticsData` fixture and assert
  DOM + testids (C14). Example for KPIs + revenue bars:

```tsx
import { render, screen } from '@testing-library/react';
import { AnalyticsKpis } from '@/app/(app)/analytik/_components/AnalyticsKpis';
import { RevenueBars } from '@/app/(app)/analytik/_components/RevenueBars';
import { fixtureAnalytics } from './fixtures-analytics';

it('KPIs render label, value, trend with ok/bad color', () => {
  const a = fixtureAnalytics();
  render(<AnalyticsKpis kpis={a.kpis} />);
  expect(screen.getByTestId('analytik-kpis')).toBeInTheDocument();
  expect(screen.getByText(a.kpis.umsatz.value)).toBeVisible();
  const trend = screen.getByText(a.kpis.umsatz.deltaLabel);
  expect(trend).toHaveStyle({ color: a.kpis.umsatz.up ? 'var(--ok)' : 'var(--bad)' });
});
it('revenue bars: peak bar uses accent, others accent-soft', () => {
  const a = fixtureAnalytics();
  render(<RevenueBars data={a.umsatzverlauf} />);
  const bars = screen.getByTestId('analytik-revenue-bars').querySelectorAll('[data-bar]');
  expect(bars.length).toBe(a.umsatzverlauf.bars.length);
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm test tests/app/analytik.test.tsx`

- [ ] **Step 3: Implement the components** — each a small presentational unit against C8 tokens, translating the
  handoff markup (`Q-Records App.dc.html:441–550`; `sc-for`→`.map`, `sc-if`→conditional, `{{x}}`→`{x}`):
  - `AnalyticsKpis({ kpis })` — grid `repeat(auto-fit,minmax(min(100%,228px),1fr))`; each KPI a `Card elevation={1}`:
    header row label (`13px var(--text-2)`) + trend span (`color: k.up?'var(--ok)':'var(--bad)'`), value
    (`var(--font-mono)` 30px), sub (`var(--text-3)`). `data-testid="analytik-kpis"`.
  - `RevenueBars({ data })` — flex row `align-items:flex-end;height:180px`; each bar a `div[data-bar]` with
    `height: Math.round(v/max*100)+'%'`, `background: v===max?'var(--accent)':'var(--accent-soft)'`, radius `5px 5px 0 0`.
    `data-testid="analytik-revenue-bars"`.
  - `CategoryBar({ slices })` — stacked track (`height:12px;background:var(--surface-3)`) with segments
    `width:(v/total*100).toFixed(1)+'%';background:c.colorVar`; legend rows swatch+label+amount+pct.
    `data-testid="analytik-category-bar"`.
  - `WeekdayBars({ data })` — horizontal bars `width:pct%`, peak `var(--accent)` else `var(--accent-soft)`; header right
    `Spitze: {bestDay}` (`var(--ok)`). `data-testid="analytik-weekday-bars"`.
  - `TimeBuckets({ data })` — bucket rows `width:pct%`, peak `var(--accent)` else `var(--honey)`; two insight tiles
    (`Beste Zeit` = `bestTime`, `Konstanz` = `consistency`). `data-testid="analytik-time-buckets"`.
  - `TopRecordsTable({ rows })` — table (Platte/Genre/Verkäufe/Umsatz/Marge), genre pill `var(--surface-3)`, margin
    cell `var(--ok)`. `data-testid="analytik-top-records"`.
  - `PeriodToggle({ period })` — client component using `SegmentedControl`; options Woche/Monat/Quartal → on change
    `router.push('/analytik?period=' + value)`. `data-testid="analytik-period-toggle"`.
  - `CsvExportButton({ period })` — an `<a href={'/analytik/export?period='+period}>` styled as the border-strong pill
    (⤓ CSV exportieren). `data-testid="analytik-csv-export"`.

- [ ] **Step 4: Implement the page.** `src/app/(app)/analytik/page.tsx` = async server component:
  `const period = (searchParams.period as AnalyticsPeriod) ?? 'week';` (validate against the union, fallback week);
  `const data = await getAnalytics({ tenantId, userId }, period);` (tenant/user from `requireSession()`); render header
  (title + `PeriodToggle` + `rangeLabel` + `storeName` + `CsvExportButton`), KPI grid, the two 2-col grids, top table.
  Wrapper `data-testid="analytik-screen"`, `max-width:1200px`.

- [ ] **Step 5: Run — expect PASS.** Run: `pnpm test tests/app/analytik.test.tsx`

- [ ] **Step 6: Typecheck + lint + commit.**
  Run: `pnpm typecheck && pnpm lint`
```bash
git add "src/app/(app)/analytik" tests/app/analytik.test.tsx tests/app/fixtures-analytics.ts
git commit -m "feat(slice4): analytics screen — period toggle + token-div charts + top records

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CSV export (serializer + route)

**Files:**
- Create: `src/lib/analytics-csv.ts`, `src/app/(app)/analytik/export/route.ts`
- Test: `tests/lib/analytics-csv.test.ts`, `tests/app/analytik-export.test.ts` (integration)

**Interfaces:**
- Consumes: `periodRange` (C7), `fromCents` (C1), `withTenant` (C3), `requireSession`/`forbidden` (C2).
- Produces (C13): `serializeAnalyticsCsv(rows, capped)`, the `GET` route.

- [ ] **Step 1: Failing serializer test.** `tests/lib/analytics-csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeAnalyticsCsv, type CsvTxRow } from '@/lib/analytics-csv';

const rows: CsvTxRow[] = [
  { createdAt: new Date('2026-06-17T12:34:00Z'), id: 7, paymentMethod: 'bar', subtotalCents: 1200, discountCents: 200, totalCents: 1000 },
];
it('emits DE header + semicolon rows + fromCents money', () => {
  const csv = serializeAnalyticsCsv(rows, false);
  const lines = csv.trim().split('\n');
  expect(lines[0]).toBe('Datum;Bon-Nr;Zahlart;Zwischensumme;Rabatt;Summe');
  expect(lines[1]).toContain(';7;bar;12.00;2.00;10.00');
});
it('escapes a field containing a semicolon and appends cap note', () => {
  const csv = serializeAnalyticsCsv([{ ...rows[0], paymentMethod: 'gut;schein' }], true);
  expect(csv).toContain('"gut;schein"');
  expect(csv.trim().split('\n').pop()).toBe('# Hinweis: auf 10000 Zeilen begrenzt');
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm test tests/lib/analytics-csv.test.ts`

- [ ] **Step 3: Implement `analytics-csv.ts`** per C13: header line, each row `de-DE` date `YYYY-MM-DD HH:mm`,
  money via `fromCents`, `;`-join, escape fields containing `;`/`"`/newline (wrap in `"`, double inner `"`), append
  the cap note line when `capped`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Failing route integration test.** `tests/app/analytik-export.test.ts`: call the route handler with a
  kunde session → expect `forbidden`/403; with a staff session and seeded transactions → expect
  `Content-Type: text/csv`, a `Content-Disposition` attachment filename, and the header row present + tenant-scoped
  rows only. (Use the existing route-handler test harness / mocked `requireSession`.)

- [ ] **Step 6: Implement the route.** `src/app/(app)/analytik/export/route.ts` per C13: `GET(request)`;
  `const user = await requireSession(); if (user.role==='kunde') forbidden();`; parse `period` (default week);
  `const { start, end } = periodRange(period, new Date());`; `withTenant` read of transactions in range (order by
  created_at, cap 10 000, `capped` if more exist); `serializeAnalyticsCsv`; return `new Response(csv, { headers })`.

- [ ] **Step 7: Run both test files — expect PASS.**
  Run: `pnpm test tests/lib/analytics-csv.test.ts tests/app/analytik-export.test.ts`

- [ ] **Step 8: Typecheck + commit.**
```bash
git add src/lib/analytics-csv.ts "src/app/(app)/analytik/export" tests/lib/analytics-csv.test.ts tests/app/analytik-export.test.ts
git commit -m "feat(slice4): CSV export — serializer + tenant-scoped route handler (staff-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `acquireOne` extraction + collections service (integration)

**Files:**
- Modify: `src/lib/ankauf.ts` (extract `acquireOne`, keep `performAnkauf` behavior)
- Create: `src/lib/collections.ts`
- Test: `tests/lib/ankauf-acquire.test.ts` (regression), `tests/lib/collections.test.ts` (Testcontainers)

**Interfaces:**
- Consumes: `AnkaufInput`/`AnkaufRelease` (existing), `withTenant` (C3), `toCents` (C1).
- Produces (C10): `acquireOne(tx, ctx, input, collectionId)`, `createCollection`/`listCollections`/`getCollection`.

- [ ] **Step 1: Regression test for `performAnkauf` (must stay green through the refactor).**
  `tests/lib/ankauf-acquire.test.ts`: two identical `performAnkauf` calls → 1 record, 2 purchases, both
  `collection_id IS NULL`. Run it BEFORE refactoring to capture current behavior.

- [ ] **Step 2: Extract `acquireOne`.** In `src/lib/ankauf.ts`, move the body of `withTenant`'s callback into
  `export async function acquireOne(tx, ctx, input, collectionId)`, adding `collectionId` to the `purchases` insert
  values. Rewrite `performAnkauf` as `return withTenant(ctx, (tx) => acquireOne(tx, ctx, input, null));`. `DbTx` type
  = the parameter type of the `withTenant` callback (export it from `@/db/tenant` if not already; otherwise
  `Parameters<Parameters<typeof withTenant>[1]>[0]`).

- [ ] **Step 3: Run the regression test — expect PASS** (behavior unchanged).
  Run: `pnpm test tests/lib/ankauf-acquire.test.ts`

- [ ] **Step 4: Failing collections test.** `tests/lib/collections.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createCollection, listCollections, getCollection } from '@/lib/collections';
import { withTenant } from '@/db/tenant';
import { purchases } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { seedTenant, ankaufItem } from './helpers'; // ankaufItem(): a valid AnkaufInput factory

describe('createCollection', () => {
  it('creates one collection + N purchases in one tx, all carrying collection_id', async () => {
    const a = await seedTenant('a');
    const ctx = { tenantId: a.id, userId: a.userId };
    const res = await createCollection(ctx, { sellerName: 'Nachlass Müller', items: [ankaufItem('3.00'), ankaufItem('5.00')] });
    expect(res.purchaseIds).toHaveLength(2);
    const rows = await withTenant(ctx, (tx) => tx.select().from(purchases).where(eq(purchases.collectionId, res.collectionId)));
    expect(rows).toHaveLength(2);
    const list = await listCollections(ctx);
    const summary = list.find((c) => c.id === res.collectionId)!;
    expect(summary.itemCount).toBe(2);
    expect(summary.totalEkCents).toBe(800); // 3.00 + 5.00
  });
  it('is fail-closed: a bad item rolls back the whole collection', async () => {
    const a = await seedTenant('a'); const ctx = { tenantId: a.id, userId: a.userId };
    const before = await listCollections(ctx);
    await expect(createCollection(ctx, { sellerName: 'x', items: [ankaufItem('3.00'), ankaufItem('not-a-price')] }))
      .rejects.toThrow();
    const after = await listCollections(ctx);
    expect(after).toHaveLength(before.length); // nothing committed
  });
});
```

- [ ] **Step 5: Implement `collections.ts`** per C10: `createCollection` opens ONE `withTenant` tx, inserts
  `collections`, loops `acquireOne(tx, ctx, item, collectionId)`; a thrown item aborts the tx (fail-closed).
  `listCollections` = join `collections` LEFT JOIN `purchases` GROUP BY collection → `{ id, sellerName, acquiredAt,
  itemCount, totalEkCents }` (`totalEkCents` = `SUM(toCents(purchase_price))` — sum in SQL as numeric then `toCents`).
  `getCollection` = the summary + `items` (join purchases→records). Convert money columns to cents at the boundary.
  **No post-commit enqueue here** — that lives in the action (C11).

- [ ] **Step 6: Run — expect PASS.** Run: `pnpm test tests/lib/collections.test.ts tests/lib/ankauf-acquire.test.ts`

- [ ] **Step 7: Typecheck + commit.**
```bash
git add src/lib/ankauf.ts src/lib/collections.ts tests/lib
git commit -m "feat(slice4): extract acquireOne + createCollection/list/get (one tx, fail-closed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Batch-Ankauf wizard + action

**Files:**
- Create: `src/app/(app)/ankauf/sammlung/page.tsx`, `actions.ts`, `_components/{CollectionWizard,CollectionItemRow}.tsx`
- Test: `tests/app/sammlung-actions.test.ts` (security), `tests/app/sammlung-wizard.test.tsx` (component)

**Interfaces:**
- Consumes: `createCollection` (C10), `searchDiscogs`/`getPriceSuggestion` (existing ankauf actions), `pricing.ts` (C14),
  `enqueueWishlistMatch`/`enqueueDiscogsListing` (C11), action boilerplate (C2).
- Produces: `createCollectionAction(input): Promise<CreateCollectionResult>`.

- [ ] **Step 1: Failing security test for the action.** `tests/app/sammlung-actions.test.ts`: assert a `kunde`
  session hits `forbidden()`; a bad-origin request returns `{ ok:false, reason:'error' }`; an empty `items` array
  returns `{ ok:false, reason:'validation' }`. (Mirror the existing kasse/wunschlisten action tests.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `createCollectionAction`** per C2 boilerplate. Zod schema: `sellerName` non-empty,
  `sellerContact?`, `note?`, `acquiredAt?` (ISO string→Date), `items` array `.min(1)` of the AnkaufInput shape
  (release object + `purchasePrice`/`targetPrice` as `decimalString` + condition ints 0–7 + `listOnDiscogs` bool).
  Delegate to `createCollection(ctx, data)`. **Post-commit (isolated try/catch, C11):** for each `recordId` call
  `enqueueWishlistMatch({ tenantId: ctx.tenantId, recordId })`; for each item with `listOnDiscogs` call
  `enqueueDiscogsListing({ tenantId: ctx.tenantId, purchaseId })` (pair purchaseIds by index). Then
  `revalidatePath('/inventar'); revalidatePath('/'); revalidatePath('/analytik'); revalidatePath('/ankauf/sammlungen');`
  return `{ ok:true, collectionId, count: purchaseIds.length }`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Failing wizard component test.** `tests/app/sammlung-wizard.test.tsx`: render `CollectionWizard`,
  assert `data-testid="sammlung-screen"`, `sammlung-seller-input`, `sammlung-add-item`, that adding two items shows
  a running total, and `sammlung-submit` is disabled until seller + ≥1 item are present.

- [ ] **Step 6: Implement the wizard.** `CollectionWizard` (client): header form (`sammlung-seller-input`, contact,
  date, note) + item list (`sammlung-items`) where each `CollectionItemRow` sources a release via the existing
  Discogs `SearchField`/`searchDiscogs` OR manual entry, with `ConditionPill`s (`CONDITION_PILLS`) + EK/VK inputs
  (VK prefilled via `suggestSalePrice` when a price suggestion is fetched). `sammlung-add-item` appends a row;
  running total via `sumLineCents`. `sammlung-submit` calls `createCollectionAction`; on `{ok:true}` route to
  `/ankauf/sammlungen`; on `{ok:false}` show the message. `page.tsx` renders the wizard under a staff layout.

- [ ] **Step 7: Run — expect PASS.** Run: `pnpm test tests/app/sammlung-actions.test.ts tests/app/sammlung-wizard.test.tsx`

- [ ] **Step 8: Typecheck + lint + commit.**
```bash
git add "src/app/(app)/ankauf/sammlung" tests/app/sammlung-actions.test.ts tests/app/sammlung-wizard.test.tsx
git commit -m "feat(slice4): batch-Ankauf wizard + createCollectionAction (post-commit wishlist match)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Collections list + detail screens

**Files:**
- Create: `src/app/(app)/ankauf/sammlungen/page.tsx`, `src/app/(app)/ankauf/sammlungen/[id]/page.tsx`
- Test: `tests/app/sammlungen.test.tsx`

**Interfaces:**
- Consumes: `listCollections`/`getCollection` (C10), `fromCents` (C1), `conditionLabel` (C14).
- Produces: the two read screens; detail hosts the `sammlung-print-labels` entry (wired in Task 9).

- [ ] **Step 1: Failing component test.** `tests/app/sammlungen.test.tsx`: render the list from a `CollectionSummary[]`
  fixture → `data-testid="sammlungen-list"`, one `sammlung-row` per collection showing seller, date, count, total EK
  (`fromCents`). Render the detail from a `CollectionDetail` fixture → `data-testid="sammlung-detail"`, item rows with
  `conditionLabel`, and a `sammlung-print-labels` button present.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the screens** as async server components: list reads `listCollections({tenantId,userId})`
  and renders a table (Verkäufer/Datum/Positionen/Gesamt-EK) with rows linking to `[id]`; detail reads
  `getCollection(ctx, Number(params.id))` (404 via `notFound()` when null), renders header + item table +
  `sammlung-print-labels` button (opens `LabelPrintModal` with the collection's items — modal built in Task 9;
  until then wire the button to a no-op/disabled with the testid present).

- [ ] **Step 4: Run — expect PASS.** Run: `pnpm test tests/app/sammlungen.test.tsx`

- [ ] **Step 5: Typecheck + commit.**
```bash
git add "src/app/(app)/ankauf/sammlungen" tests/app/sammlungen.test.tsx
git commit -m "feat(slice4): collections list + detail screens (drill-in for Sammlungen KPI)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Label printing (pure layout + jsPDF modal + entry points)

**Files:**
- Create: `src/lib/labels.ts`, `src/app/(app)/inventar/_components/LabelPrintModal.tsx`
- Modify: `src/app/(app)/inventar/_components/InventoryList.tsx` (multi-select + `label-print-open`),
  `src/app/(app)/ankauf/sammlungen/[id]/page.tsx` (wire `sammlung-print-labels` to the modal), `package.json`
- Test: `tests/lib/labels.test.ts`, `tests/app/label-print-modal.test.tsx`

**Interfaces:**
- Consumes: `fromCents` (C1), `conditionLabel` (C14), `Modal`/`Checkbox` (C14).
- Produces (C12): `labelGridLayout`/`discogsReleaseUrl`/`labelPriceText`, `AVERY_3x8`, `LabelPrintModal`.

- [ ] **Step 1: Add deps.**
  Run: `pnpm add jspdf qrcode && pnpm add -D @types/qrcode`
  Expected: `package.json` gains `jspdf`, `qrcode`, `@types/qrcode`.

- [ ] **Step 2: Failing pure-helper test.** `tests/lib/labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { labelGridLayout, AVERY_3x8, discogsReleaseUrl, labelPriceText } from '@/lib/labels';

it('AVERY_3x8 places 24 labels per page then wraps to page 2', () => {
  expect(labelGridLayout(0, AVERY_3x8).page).toBe(0);
  expect(labelGridLayout(23, AVERY_3x8).page).toBe(0);
  const c24 = labelGridLayout(24, AVERY_3x8);
  expect(c24.page).toBe(1);
  expect(c24.cell.x).toBeCloseTo(labelGridLayout(0, AVERY_3x8).cell.x); // back to col 0 row 0
});
it('cells advance left-to-right, top-to-bottom', () => {
  const a = labelGridLayout(0, AVERY_3x8).cell; const b = labelGridLayout(1, AVERY_3x8).cell;
  expect(b.x).toBeGreaterThan(a.x); expect(b.y).toBe(a.y);
  const rowNext = labelGridLayout(3, AVERY_3x8).cell; // 4th → next row, col 0
  expect(rowNext.x).toBe(a.x); expect(rowNext.y).toBeGreaterThan(a.y);
});
it('discogs url + price text', () => {
  expect(discogsReleaseUrl(1234)).toBe('https://www.discogs.com/release/1234');
  expect(labelPriceText(1200)).toBe('€ 12,00');
  expect(labelPriceText(null)).toBe('—');
});
```

- [ ] **Step 3: Run — expect FAIL.** Run: `pnpm test tests/lib/labels.test.ts`

- [ ] **Step 4: Implement `labels.ts`** per C12: `AVERY_3x8 = { cols:3, rows:8, pageW:210, pageH:297, marginX:7,
  marginY:15, gutterX:2.5, gutterY:0 }` (mm; cell size derived: `w=(pageW-2*marginX-(cols-1)*gutterX)/cols`,
  `h=(pageH-2*marginY-(rows-1)*gutterY)/rows`). `labelGridLayout(index, t)`: `perPage=cols*rows`,
  `page=floor(index/perPage)`, `k=index%perPage`, `col=k%cols`, `row=floor(k/cols)`; `x=marginX+col*(w+gutterX)`,
  `y=marginY+row*(h+gutterY)`. `discogsReleaseUrl`, `labelPriceText` (via `fromCents`, `.` → `,`, prefix `€ `, `—` for null).

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Failing modal test.** `tests/app/label-print-modal.test.tsx`: render `LabelPrintModal` with 2
  `LabelItem`s → `data-testid="label-print-modal"`, `label-template-select`, `label-print-submit`. Mock
  `jspdf`/`qrcode` dynamic imports; assert clicking submit calls the (mocked) jsPDF `save`. Do NOT render a real PDF.

- [ ] **Step 7: Implement `LabelPrintModal`.** `Modal` from `@/components/ui`; props `{ items: LabelItem[]; open;
  onClose }`. On submit: `const { jsPDF } = await import('jspdf'); const QR = (await import('qrcode')).default;`
  build an A4 doc, for each item compute `labelGridLayout(i, AVERY_3x8)` (new page when `page` increments), draw
  `artist — title`, `format · conditionLabel`, big `labelPriceText`, and — when `discogsId != null` — a QR
  (`await QR.toDataURL(discogsReleaseUrl(discogsId))`) via `doc.addImage`. `doc.save('etiketten.pdf')`.

- [ ] **Step 8: Wire entry points.** In `InventoryList.tsx` add a `Checkbox` per row (selection state) + a
  `label-print-open` button that opens `LabelPrintModal` with the selected rows mapped to `LabelItem`. In the
  collection detail page, wire `sammlung-print-labels` to open the modal with the collection's items.

- [ ] **Step 9: Run tests — expect PASS.** Run: `pnpm test tests/lib/labels.test.ts tests/app/label-print-modal.test.tsx`

- [ ] **Step 10: Typecheck + lint + commit.**
```bash
git add src/lib/labels.ts "src/app/(app)/inventar/_components" "src/app/(app)/ankauf/sammlungen" package.json pnpm-lock.yaml tests
git commit -m "feat(slice4): A4 price-label printing (jsPDF+qrcode, dynamic import) + inventory/collection entries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Navigation + seed

**Files:**
- Modify: `src/app/(app)/_components/SidebarNav.tsx`, `scripts/seed.ts`
- Test: `tests/app/sidebar-nav.test.tsx` (or extend existing nav test)

**Interfaces:**
- Consumes: existing nav/staff-gating pattern; `createCollection` OR direct inserts in the seed.

- [ ] **Step 1: Failing nav test.** Assert the sidebar renders staff-only links for `Sammlungen` (under Ankauf) — the
  `Analytik` entry already exists. A `kunde` role must not see them (mirror the Kasse/Wunschlisten gating from Slice 3).

- [ ] **Step 2: Implement nav.** Add the `Sammlungen` link (`/ankauf/sammlungen`) to `SidebarNav`, staff-gated like the
  existing Kasse/Wunschlisten entries. (The batch-Ankauf wizard is reachable from the Sammlungen screen and/or an
  "Sammlung anlegen" button there.)

- [ ] **Step 3: Run nav test — expect PASS.**

- [ ] **Step 4: Extend the seed.** In `scripts/seed.ts`: give the demo `quick_items` a `category` (e.g. Kaffee/Wasser →
  `'Getränke'`, others → `'Sonstiges'`), and create ONE demo `collection` (seller "Nachlass Beispiel") with 2–3
  purchases via `createCollection` so the Sammlungen screen + Ankäufe/Sammlungen KPI + a batch label print have data.
  Keep the seed idempotent (upsert/guard on re-run, matching the existing seed style).

- [ ] **Step 5: Run the seed against a dev DB.**
  Run: `pnpm seed` (or the project's seed command)
  Expected: no error; one demo collection + categorized quick items present.

- [ ] **Step 6: Typecheck + commit.**
```bash
git add "src/app/(app)/_components/SidebarNav.tsx" scripts/seed.ts tests/app/sidebar-nav.test.tsx
git commit -m "feat(slice4): sidebar Sammlungen entry (staff-gated) + seed demo collection & quick-item categories

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: E2E acceptance

**Files:**
- Create: `e2e/analytics-batch-labels.spec.ts`
- Modify: `e2e/helpers.ts` (add `downloadCsv`/`collectionsCount` helpers if useful)
- Test: the spec itself, run against `docker compose up`.

**Interfaces:**
- Consumes: the seeded demo tenant/data (Task 10), the C14 testids.

- [ ] **Step 1: Write the 5 scenarios.** `e2e/analytics-batch-labels.spec.ts`:
  1. **Analytik rendert** — visit `/analytik`; `analytik-screen` visible; KPIs (`analytik-kpis`) show a `€`-value;
     charts present (`analytik-revenue-bars`, `analytik-category-bar`); switching the period toggle
     (`analytik-period-toggle` → Monat) updates the range label / URL `?period=month`.
  2. **CSV-Download** — click `analytik-csv-export`; assert a download whose filename starts `analytik-` and whose
     body first line is `Datum;Bon-Nr;Zahlart;Zwischensumme;Rabatt;Summe`.
  3. **Batch-Ankauf** — open the Sammlung wizard; enter a seller; add 2 items (manual entry with EK/VK/condition);
     submit; land on `/ankauf/sammlungen` with a new `sammlung-row`; the `Ankäufe`/`Sammlungen` KPI on `/analytik`
     reflects the increase.
  4. **Wishlist match feuert** — precondition: an OPEN wishlist matching one batch item's artist; after the batch
     Ankauf, a pending match appears on `/wunschlisten` (reuses the Slice-3 match job path). (Poll with tenant scope.)
  5. **Etiketten** — select ≥1 inventory row, open `label-print-modal`, submit; assert a PDF download
     (`etiketten.pdf`). No customer PII appears on the public storefront `/s/<slug>` (positive control: an
     `article` card is visible AND the page contains no customer name/email string).

- [ ] **Step 2: Bring up the stack + run.**
  Run: `docker compose up -d --build` then `pnpm exec playwright test e2e/analytics-batch-labels.spec.ts`
  Expected: 5/5 green. Tear down: `docker compose down -v`.

- [ ] **Step 3: Commit.**
```bash
git add e2e/analytics-batch-labels.spec.ts e2e/helpers.ts
git commit -m "test(slice4): e2e acceptance — analytics, CSV, batch-Ankauf→match, label print, no-PII

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final gate (after all tasks)

- [ ] **Full suite:** `pnpm test` green (the Slice-3 vitest fork-cap in `vitest.config.ts` stays — do not raise
  parallelism). `pnpm typecheck` clean. `pnpm lint` 0 errors.
- [ ] **E2E:** `docker compose up -d --build` → `pnpm exec playwright test` (all specs) green → `docker compose down -v`.
- [ ] **Whole-branch review (Opus):** `review-package $(git merge-base main HEAD) HEAD`; dispatch ONE fix subagent for
  any Critical/Important; triage the Minor roll-up.
- [ ] **finishing-a-development-branch:** verify tests green → push `feat/v2-slice4-analytics-batch-labels` → PR to
  `main` → merge → mark Slice 4 "Implementiert + reviewed" in `2026-06-25-qrecords-v2-architecture-overview.md`.

## Notes for the executor

- **`.superpowers/` is gitignored SDD scratch — NEVER `git add` it.** Before each commit, `git status` and confirm
  only intended paths are staged. (A prior slice force-added ignored scratch twice — do not repeat.)
- Implementer/reviewer model: **Sonnet** (this plan carries the code); escalate to Opus only on BLOCKED. Whole-branch
  review on **Opus**.
- Every mutating action must keep the exact C2 order; every new tenant table/read goes through `withTenant`.
- If drizzle-kit numbers the DDL migration differently than `0008`, keep the real generated name and register THAT in
  `_journal.json`; the RLS migration is the next index.

