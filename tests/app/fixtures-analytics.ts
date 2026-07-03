// tests/app/fixtures-analytics.ts
// Hand-built AnalyticsData fixture (C6 shape) for the Analytik component tests. Values are chosen
// so every widget has a clear, assertable "peak" (bar/day/bucket) and a mix of up/down KPIs.

import type { AnalyticsData } from '@/lib/analytics';

export function fixtureAnalytics(): AnalyticsData {
  return {
    period: 'week',
    rangeLabel: '16.–22. Juni 2026',
    storeName: 'Q-Records Kreuzberg',
    kpis: {
      umsatz: { label: 'Umsatz', value: '€ 8.940', sub: 'ggü. Vorwoche', up: true, deltaLabel: '▲ 12 %' },
      transaktionen: { label: 'Transaktionen', value: '312', sub: 'Ø € 28,70 / Bon', up: true, deltaLabel: '▲ 4 %' },
      ankaeufe: { label: 'Ankäufe', value: '47', sub: '9 Sammlungen', up: false, deltaLabel: '▼ 3 %' },
      rohmarge: { label: 'Rohmarge', value: '61 %', sub: 'Wareneinsatz 39 %', up: false, deltaLabel: '▼ 2 pt' },
    },
    umsatzverlauf: {
      bars: [
        { label: 'Mo', valueCents: 80_000 },
        { label: 'Di', valueCents: 120_000 },
        { label: 'Mi', valueCents: 95_000 },
        { label: 'Do', valueCents: 140_000 },
        { label: 'Fr', valueCents: 210_000 }, // peak
        { label: 'Sa', valueCents: 175_000 },
        { label: 'So', valueCents: 60_000 },
      ],
      totalCents: 880_000,
      subLabel: 'letzte 7 Tage',
    },
    kategorie: [
      { label: 'Vinyl', valueCents: 620_000, colorVar: 'var(--accent)' },
      { label: 'CD', valueCents: 180_000, colorVar: 'var(--info)' },
      { label: 'Getränke', valueCents: 50_000, colorVar: 'var(--honey)' },
      { label: 'Sonstiges', valueCents: 30_000, colorVar: 'var(--text-3)' },
    ],
    wochentag: {
      bars: [
        { day: 'Montag', pct: 38 },
        { day: 'Dienstag', pct: 57 },
        { day: 'Mittwoch', pct: 45 },
        { day: 'Donnerstag', pct: 67 },
        { day: 'Freitag', pct: 100 }, // peak — matches bestDay
        { day: 'Samstag', pct: 83 },
        { day: 'Sonntag', pct: 29 },
      ],
      bestDay: 'Freitag',
    },
    tageszeit: {
      buckets: [
        { label: 'Vormittag · 11–14 Uhr', pct: 62 },
        { label: 'Mittag · 14–16 Uhr', pct: 100 }, // peak — matches bestTime
        { label: 'Nachmittag · 16–18 Uhr', pct: 74 },
        { label: 'Abend · 18–20 Uhr', pct: 40 },
      ],
      bestTime: 'Mittag · 14–16 Uhr',
      consistency: 'gleichmäßig',
    },
    topRecords: [
      { artist: 'Depeche Mode', title: 'Violator', genre: 'Electronic', sales: 14, revenueCents: 112_000, marginPct: 62 },
      { artist: 'Fleetwood Mac', title: 'Rumours', genre: 'Rock', sales: 11, revenueCents: 93_500, marginPct: 55 },
      { artist: 'Miles Davis', title: 'Kind of Blue', genre: 'Jazz', sales: 9, revenueCents: 81_000, marginPct: 70 },
      { artist: 'Portishead', title: 'Dummy', genre: 'Trip-Hop', sales: 7, revenueCents: 63_000, marginPct: 58 },
      { artist: 'Various', title: 'Ibiza Grooves', genre: null, sales: 6, revenueCents: 42_000, marginPct: 45 },
    ],
  };
}
