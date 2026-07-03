import 'server-only';
import { sql, eq } from 'drizzle-orm';
import { withTenant, type Tx, type TenantCtx } from '@/db/tenant';
import { tenants } from '@/db/schema';
import { toCents, fromCents } from '@/lib/money';
import { periodRange, type AnalyticsPeriod } from '@/lib/analytics-period';
import { formatEuroWhole } from '@/lib/format';

// `AnalyticsPeriod` is DEFINED in `@/lib/analytics-period` (avoids a cycle) — re-export it here so
// C6's public surface (everything importable from `@/lib/analytics`) is satisfied without a duplicate.
export type { AnalyticsPeriod };

// ── C6: frozen analytics types (screen, module, and CSV must agree) ────────────────────────────

export interface Kpi {
  label: string;
  value: string; // preformatted display value, e.g. '€ 8.940' or '61 %' or '312'
  sub: string; // e.g. 'ggü. Vorwoche' / 'Ø € 28,70 / Bon' / '47 Sammlungen' / 'Wareneinsatz 39 %'
  up: boolean; // trend direction; color resolved at render (up→--ok, down→--bad)
  deltaLabel: string; // e.g. '▲ 12 %' / '▼ 3 %' / '▲ 2 pt'
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

// ── Display formatting helpers (money crosses to a JS number ONLY here, at the display edge) ───
// Whole-euro KPI formatting (`formatEuroWhole`) lives in `@/lib/format` now — shared with the
// Analytik presentational components instead of duplicated here.

/** '€ 28,70' — 2-decimal display value. Splits `fromCents`' exact decimal string instead of
 *  dividing by 100 as a float, per C1 ("fromCents only at the display edge"). */
function formatEuroDetailed(cents: number): string {
  const [whole, frac] = fromCents(cents).split('.');
  return `€ ${Number(whole).toLocaleString('de-DE')},${frac}`;
}

/** current vs prev, as a percent delta. `up` = current >= prev (C7). */
function deltaPct(current: number, prev: number): { up: boolean; deltaLabel: string } {
  const up = current >= prev;
  if (prev === 0) {
    return { up, deltaLabel: current === 0 ? '▲ 0 %' : `${up ? '▲' : '▼'} 100 %` };
  }
  const pct = Math.round((Math.abs(current - prev) / prev) * 100);
  return { up, deltaLabel: `${up ? '▲' : '▼'} ${pct} %` };
}

/** current vs prev, as a percentage-point delta (Rohmarge is itself already a %). */
function deltaPt(current: number, prev: number): { up: boolean; deltaLabel: string } {
  const up = current >= prev;
  const diff = Math.round(Math.abs(current - prev));
  return { up, deltaLabel: `${up ? '▲' : '▼'} ${diff} pt` };
}

// ── Berlin-local calendar helpers (pure calendar math — no float, no DST assumptions) ──────────

/** Berlin-local calendar date 'YYYY-MM-DD' for a UTC instant — matches the SQL
 *  `to_char((col AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD')` bucket keys byte-for-byte. */
function berlinDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(date);
}

/** Add `days` to a 'YYYY-MM-DD' key. Pure calendar arithmetic (Date.UTC normalises month/year
 *  overflow) — never a timezone conversion, so it's immune to DST drift. */
function addCalendarDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const GERMAN_DAYS_ABBR = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']; // 0=Mon..6=Sun
function germanWeekdayAbbrev(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return GERMAN_DAYS_ABBR[jsDay === 0 ? 6 : jsDay - 1];
}

const GERMAN_MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
function monthKey(dayKey: string): string {
  return dayKey.slice(0, 7); // 'YYYY-MM'
}
function monthLabel(bucketKey: string): string {
  return GERMAN_MONTHS_SHORT[Number(bucketKey.slice(5, 7)) - 1];
}

/** ISO-8601 week key 'YYYY-Wnn' (year included so a week straddling a year boundary never
 *  collides) — grouping key only, the display label strips the year (`isoWeekLabel`). */
function isoWeekKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
function isoWeekLabel(bucketKey: string): string {
  return `KW ${Number(bucketKey.split('-W')[1])}`;
}

/** Roll up per-day cents (already Berlin-tz-bucketed in SQL) into ordered, gap-filled bars —
 *  used for all three Umsatzverlauf granularities so the tz-sensitive bucketing lives in one
 *  place (the `dailyRevenue` query); this is pure re-aggregation of already-correct day sums. */
function aggregateBars(
  startKey: string,
  endKeyExclusive: string,
  dailyCents: Map<string, number>,
  bucketOf: (dayKey: string) => string,
  labelOf: (bucketKey: string) => string,
): { bars: BarPoint[]; totalCents: number } {
  const order: string[] = [];
  const sums = new Map<string, number>();
  let cursor = startKey;
  while (cursor < endKeyExclusive) {
    const bucket = bucketOf(cursor);
    if (!sums.has(bucket)) {
      sums.set(bucket, 0);
      order.push(bucket);
    }
    sums.set(bucket, sums.get(bucket)! + (dailyCents.get(cursor) ?? 0));
    cursor = addCalendarDays(cursor, 1);
  }
  const bars = order.map((bucket) => ({ label: labelOf(bucket), valueCents: sums.get(bucket)! }));
  const totalCents = bars.reduce((sum, b) => sum + b.valueCents, 0);
  return { bars, totalCents };
}

/** Text label from the coefficient of variation of the 4 Tageszeit bucket sums. */
function computeConsistency(values: number[]): string {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 'gleichmäßig';
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  return cv < 0.3 ? 'gleichmäßig' : 'schwankend';
}

// ── Category → chart token mapping (C7/C8) ──────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  Vinyl: 'var(--accent)',
  CD: 'var(--info)',
  Getränke: 'var(--honey)',
};
function colorForCategory(cat: string): string {
  return CATEGORY_COLOR[cat] ?? 'var(--text-3)';
}

const MON_FIRST_DOW = [1, 2, 3, 4, 5, 6, 0]; // Postgres EXTRACT(dow): 0=Sun..6=Sat, reordered Monday-first
const GERMAN_WEEKDAYS_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

const TAGESZEIT_BUCKETS = [
  { key: 'vormittag', label: 'Vormittag · 11–14 Uhr' },
  { key: 'mittag', label: 'Mittag · 14–16 Uhr' },
  { key: 'nachmittag', label: 'Nachmittag · 16–18 Uhr' },
  { key: 'abend', label: 'Abend · 18–20 Uhr' },
] as const;

// ── Query building blocks (each a single statement inside the caller's tx) ──────────────────────

async function txAgg(tx: Tx, start: Date, end: Date): Promise<{ umsatzCents: number; txCount: number }> {
  const result = await tx.execute(sql`
    SELECT COALESCE(SUM(total), 0)::text AS umsatz, COUNT(*)::int AS tx
    FROM transactions
    WHERE created_at >= ${start} AND created_at < ${end}
  `);
  const row = result.rows[0] as { umsatz: string; tx: number };
  return { umsatzCents: toCents(row.umsatz), txCount: row.tx };
}

async function purchaseCount(tx: Tx, start: Date, end: Date): Promise<number> {
  const result = await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM purchases WHERE created_at >= ${start} AND created_at < ${end}
  `);
  return (result.rows[0] as { n: number }).n;
}

async function collectionCount(tx: Tx, start: Date, end: Date): Promise<number> {
  const result = await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM collections WHERE acquired_at >= ${start} AND acquired_at < ${end}
  `);
  return (result.rows[0] as { n: number }).n;
}

async function rohmargeAgg(tx: Tx, start: Date, end: Date): Promise<{ profitCents: number; revenueCents: number }> {
  const result = await tx.execute(sql`
    SELECT COALESCE(SUM(sold_price - purchase_price), 0)::text AS profit,
           COALESCE(SUM(sold_price), 0)::text AS revenue
    FROM purchases
    WHERE status = 'verkauft' AND sold_date >= ${start} AND sold_date < ${end}
  `);
  const row = result.rows[0] as { profit: string; revenue: string };
  return { profitCents: toCents(row.profit), revenueCents: toCents(row.revenue) };
}

/** Per-Berlin-calendar-day revenue — the ONE place day/tz bucketing happens; week/month/quarter
 *  bars are all re-aggregated from this in JS (see `aggregateBars`). */
async function dailyRevenue(tx: Tx, start: Date, end: Date): Promise<Map<string, number>> {
  const result = await tx.execute(sql`
    SELECT to_char((created_at AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD') AS day_key,
           COALESCE(SUM(total), 0)::text AS v
    FROM transactions
    WHERE created_at >= ${start} AND created_at < ${end}
    GROUP BY day_key
  `);
  const map = new Map<string, number>();
  for (const row of result.rows as { day_key: string; v: string }[]) {
    map.set(row.day_key, toCents(row.v));
  }
  return map;
}

async function categoryRevenue(tx: Tx, start: Date, end: Date): Promise<CategorySlice[]> {
  const result = await tx.execute(sql`
    SELECT CASE
        WHEN ti.purchase_id IS NOT NULL THEN
          CASE r.format WHEN 'Vinyl' THEN 'Vinyl' WHEN 'CD' THEN 'CD' ELSE 'Sonstiges' END
        ELSE COALESCE(qi.category, 'Sonstiges')
      END AS cat,
      COALESCE(SUM(ti.unit_price * ti.quantity), 0)::text AS v
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    LEFT JOIN purchases p ON p.id = ti.purchase_id
    LEFT JOIN records r ON r.id = p.record_id
    LEFT JOIN quick_items qi ON qi.id = ti.quick_item_id
    WHERE t.created_at >= ${start} AND t.created_at < ${end}
    GROUP BY cat
    ORDER BY SUM(ti.unit_price * ti.quantity) DESC
  `);
  return (result.rows as { cat: string; v: string }[]).map((row) => ({
    label: row.cat,
    valueCents: toCents(row.v),
    colorVar: colorForCategory(row.cat),
  }));
}

async function weekdayRevenue(tx: Tx, start: Date, end: Date): Promise<Map<number, number>> {
  const result = await tx.execute(sql`
    SELECT EXTRACT(dow FROM (created_at AT TIME ZONE 'Europe/Berlin'))::int AS dow,
           COALESCE(SUM(total), 0)::text AS v
    FROM transactions
    WHERE created_at >= ${start} AND created_at < ${end}
    GROUP BY dow
  `);
  const map = new Map<number, number>();
  for (const row of result.rows as { dow: number; v: string }[]) {
    map.set(row.dow, toCents(row.v));
  }
  return map;
}

async function tageszeitRevenue(tx: Tx, start: Date, end: Date): Promise<Map<string, number>> {
  const result = await tx.execute(sql`
    SELECT bucket, COALESCE(SUM(total), 0)::text AS v
    FROM (
      SELECT total,
        CASE
          WHEN hh >= 11 AND hh < 14 THEN 'vormittag'
          WHEN hh >= 14 AND hh < 16 THEN 'mittag'
          WHEN hh >= 16 AND hh < 18 THEN 'nachmittag'
          WHEN hh >= 18 AND hh < 20 THEN 'abend'
          ELSE 'other'
        END AS bucket
      FROM (
        SELECT total, EXTRACT(hour FROM (created_at AT TIME ZONE 'Europe/Berlin'))::int AS hh
        FROM transactions
        WHERE created_at >= ${start} AND created_at < ${end}
      ) hourly
    ) bucketed
    GROUP BY bucket
  `);
  const map = new Map<string, number>();
  for (const row of result.rows as { bucket: string; v: string }[]) {
    map.set(row.bucket, toCents(row.v));
  }
  return map;
}

async function topRecordsQuery(tx: Tx, start: Date, end: Date): Promise<TopRecord[]> {
  const result = await tx.execute(sql`
    SELECT r.artist AS artist, r.title AS title, r.genre[1] AS genre,
           SUM(ti.quantity)::int AS sales,
           COALESCE(SUM(ti.unit_price * ti.quantity), 0)::text AS revenue,
           COALESCE(SUM(ti.unit_price - p.purchase_price), 0)::text AS margin_abs
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    JOIN purchases p ON p.id = ti.purchase_id
    JOIN records r ON r.id = p.record_id
    WHERE t.created_at >= ${start} AND t.created_at < ${end} AND ti.purchase_id IS NOT NULL
    GROUP BY r.id
    ORDER BY sales DESC, SUM(ti.unit_price * ti.quantity) DESC
    LIMIT 5
  `);
  return (
    result.rows as {
      artist: string; title: string; genre: string | null; sales: number; revenue: string; margin_abs: string;
    }[]
  ).map((row) => {
    const revenueCents = toCents(row.revenue);
    const marginAbsCents = toCents(row.margin_abs);
    const marginPct = revenueCents > 0 ? Math.round((marginAbsCents / revenueCents) * 100) : 0;
    return { artist: row.artist, title: row.title, genre: row.genre, sales: row.sales, revenueCents, marginPct };
  });
}

// ── C7: getAnalytics — ONE withTenant read tx ───────────────────────────────────────────────────

export async function getAnalytics(ctx: TenantCtx, period: AnalyticsPeriod): Promise<AnalyticsData> {
  const { start, end, prevStart, prevEnd, rangeLabel } = periodRange(period, new Date());

  return withTenant(ctx, async (tx) => {
    // ── KPIs ──
    const cur = await txAgg(tx, start, end);
    const prev = await txAgg(tx, prevStart, prevEnd);
    const ankaeufeCount = await purchaseCount(tx, start, end);
    const prevAnkaeufeCount = await purchaseCount(tx, prevStart, prevEnd);
    const sammlungenCount = await collectionCount(tx, start, end);
    const curRohmarge = await rohmargeAgg(tx, start, end);
    const prevRohmarge = await rohmargeAgg(tx, prevStart, prevEnd);

    const compareLabel = period === 'week' ? 'ggü. Vorwoche' : period === 'month' ? 'ggü. Vormonat' : 'ggü. Vorquartal';

    const umsatz: Kpi = {
      label: 'Umsatz',
      value: formatEuroWhole(cur.umsatzCents),
      sub: compareLabel,
      ...deltaPct(cur.umsatzCents, prev.umsatzCents),
    };

    const avgPerTxCents = cur.txCount > 0 ? Math.round(cur.umsatzCents / cur.txCount) : 0;
    const transaktionen: Kpi = {
      label: 'Transaktionen',
      value: String(cur.txCount),
      sub: `Ø ${formatEuroDetailed(avgPerTxCents)} / Bon`,
      ...deltaPct(cur.txCount, prev.txCount),
    };

    const ankaeufe: Kpi = {
      label: 'Ankäufe',
      value: String(ankaeufeCount),
      sub: `${sammlungenCount} Sammlungen`,
      ...deltaPct(ankaeufeCount, prevAnkaeufeCount),
    };

    const rohmargePct = curRohmarge.revenueCents > 0
      ? Math.round((curRohmarge.profitCents / curRohmarge.revenueCents) * 100)
      : 0;
    const prevRohmargePct = prevRohmarge.revenueCents > 0
      ? Math.round((prevRohmarge.profitCents / prevRohmarge.revenueCents) * 100)
      : 0;
    const rohmarge: Kpi = {
      label: 'Rohmarge',
      value: `${rohmargePct} %`,
      sub: `Wareneinsatz ${100 - rohmargePct} %`,
      ...deltaPt(rohmargePct, prevRohmargePct),
    };

    // ── Umsatzverlauf ──
    const dailyCents = await dailyRevenue(tx, start, end);
    const startKey = berlinDateKey(start);
    const endKey = berlinDateKey(end);
    let verlauf: { bars: BarPoint[]; totalCents: number };
    let subLabel: string;
    if (period === 'week') {
      verlauf = aggregateBars(startKey, endKey, dailyCents, (k) => k, germanWeekdayAbbrev);
      subLabel = 'letzte 7 Tage';
    } else if (period === 'month') {
      verlauf = aggregateBars(startKey, endKey, dailyCents, isoWeekKey, isoWeekLabel);
      subLabel = 'letzte Wochen';
    } else {
      verlauf = aggregateBars(startKey, endKey, dailyCents, monthKey, monthLabel);
      subLabel = 'letzte Monate';
    }

    // ── Kategorie ──
    const kategorie = await categoryRevenue(tx, start, end);

    // ── Wochentag ──
    const dowMap = await weekdayRevenue(tx, start, end);
    const dowValues = MON_FIRST_DOW.map((d) => dowMap.get(d) ?? 0);
    const maxDow = Math.max(...dowValues);
    const wochentagBars: WeekdayBar[] = dowValues.map((v, i) => ({
      day: GERMAN_WEEKDAYS_FULL[i],
      pct: maxDow > 0 ? Math.round((v / maxDow) * 100) : 0,
    }));
    const bestDay = GERMAN_WEEKDAYS_FULL[dowValues.indexOf(maxDow)];

    // ── Tageszeit ──
    const tzMap = await tageszeitRevenue(tx, start, end);
    const tzValues = TAGESZEIT_BUCKETS.map((b) => tzMap.get(b.key) ?? 0);
    const maxTz = Math.max(...tzValues);
    const tzBuckets: TimeBucket[] = TAGESZEIT_BUCKETS.map((b, i) => ({
      label: b.label,
      pct: maxTz > 0 ? Math.round((tzValues[i] / maxTz) * 100) : 0,
    }));
    const bestTime = TAGESZEIT_BUCKETS[tzValues.indexOf(maxTz)].label;
    const consistency = computeConsistency(tzValues);

    // ── Top-N ──
    const topRecords = await topRecordsQuery(tx, start, end);

    // ── Store name (tenants carries no RLS — explicit tenant predicate is the only scoping) ──
    const tenantRows = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    const storeName = tenantRows[0]?.name ?? '';

    return {
      period,
      rangeLabel,
      storeName,
      kpis: { umsatz, transaktionen, ankaeufe, rohmarge },
      umsatzverlauf: { bars: verlauf.bars, totalCents: verlauf.totalCents, subLabel },
      kategorie,
      wochentag: { bars: wochentagBars, bestDay },
      tageszeit: { buckets: tzBuckets, bestTime, consistency },
      topRecords,
    };
  });
}
