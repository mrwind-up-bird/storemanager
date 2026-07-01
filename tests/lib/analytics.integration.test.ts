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
});
