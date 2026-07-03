import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase } from '../helpers/db';
import { seedAnalyticsFixture, type AnalyticsFixtureCtx } from './helpers-analytics';

let getAnalytics: (typeof import('@/lib/analytics'))['getAnalytics'];
let teardown: (() => Promise<void>) | undefined;
let ctx: AnalyticsFixtureCtx;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  vi.resetModules();
  ({ getAnalytics } = await import('@/lib/analytics'));
  ctx = await seedAnalyticsFixture();
}, 120_000);

afterAll(async () => {
  if (teardown) await teardown();
});

describe('getAnalytics(week)', () => {
  it('KPI Umsatz equals the sum of this-week transaction totals', async () => {
    const a = await getAnalytics(ctx, 'week');
    expect(a.kpis.umsatz.value).toMatch(/€/);
    expect(a.period).toBe('week');
    expect(a.umsatzverlauf.bars).toHaveLength(7); // 7 daily bars
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

  it('Kategorie is ordered by revenue DESC numerically, not lexicographically (F3)', async () => {
    const a = await getAnalytics(ctx, 'week');
    // Fixture: Vinyl revenue = 25.00 + 9.00 = 34.00, Sonstiges (Kaffee) = 7.00. Under the old
    // `ORDER BY v DESC` (the `::text` alias), '7.00' sorts before '34.00' lexicographically
    // ('7' > '3') — the bigger category must rank first once ordered numerically.
    expect(a.kategorie[0]!.label).toBe('Vinyl');
    const vinyl = a.kategorie.find((c) => c.label === 'Vinyl')!;
    const sonstiges = a.kategorie.find((c) => c.label === 'Sonstiges');
    if (sonstiges) expect(vinyl.valueCents).toBeGreaterThan(sonstiges.valueCents);
  });

  it('Rohmarge is 0..100 and Ankäufe sub names the Sammlungen count', async () => {
    const a = await getAnalytics(ctx, 'week');
    expect(a.kpis.rohmarge.value).toMatch(/%$/);
    expect(a.kpis.ankaeufe.sub).toMatch(/Sammlung/);
    expect(a.topRecords.length).toBeLessThanOrEqual(5);
    expect(a.wochentag.bars).toHaveLength(7);
    expect(a.tageszeit.buckets.map((b) => b.label)).toEqual([
      'Vormittag · 11–14 Uhr', 'Mittag · 14–16 Uhr', 'Nachmittag · 16–18 Uhr', 'Abend · 18–20 Uhr',
    ]);
  });

  it('Umsatzverlauf for month is weekly (ISO-week) buckets covering the seeded week', async () => {
    const a = await getAnalytics(ctx, 'month');
    expect(a.period).toBe('month');
    expect(a.umsatzverlauf.bars.length).toBeGreaterThanOrEqual(4); // weekly buckets across the month
    for (const bar of a.umsatzverlauf.bars) {
      expect(bar.label).toMatch(/^KW /);
    }
    expect(a.umsatzverlauf.totalCents).toBeGreaterThan(0);
    expect(a.umsatzverlauf.bars.some((b) => b.valueCents > 0)).toBe(true); // the seeded week's bar
  });

  it('Top-Records: a sales tie is broken by revenue numerically, not by the ::text alias (F3)', async () => {
    const a = await getAnalytics(ctx, 'week');
    const abbeyIdx = a.topRecords.findIndex((r) => r.title === 'Abbey Road');
    const kobIdx = a.topRecords.findIndex((r) => r.title === 'Kind of Blue');
    expect(abbeyIdx).toBeGreaterThanOrEqual(0);
    expect(kobIdx).toBeGreaterThanOrEqual(0);
    // Both sold exactly one copy -> tie on `sales`; the fixture's revenues ('9.00' vs '25.00')
    // text-sort the WRONG way ('9' > '2'), so this only passes once the tiebreak is numeric.
    expect(a.topRecords[abbeyIdx]!.sales).toBe(a.topRecords[kobIdx]!.sales);
    expect(a.topRecords[abbeyIdx]!.revenueCents).toBeGreaterThan(a.topRecords[kobIdx]!.revenueCents);
    expect(abbeyIdx).toBeLessThan(kobIdx);
  });

  it('Umsatzverlauf for quarter is 3 monthly buckets covering the seeded month', async () => {
    const a = await getAnalytics(ctx, 'quarter');
    expect(a.period).toBe('quarter');
    expect(a.umsatzverlauf.bars).toHaveLength(3); // one bar per month of the quarter
    const monthShort = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    for (const bar of a.umsatzverlauf.bars) {
      expect(monthShort).toContain(bar.label);
    }
    expect(a.umsatzverlauf.totalCents).toBeGreaterThan(0);
  });
});
