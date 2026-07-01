// tests/app/analytik.test.tsx
// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />
//
// Presentational component tests for the Analytik screen (Slice 4, Task 4). Each widget is
// rendered directly from a hand-built AnalyticsData fixture (no DB, no server actions).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// PeriodToggle is the only client component that touches next/navigation (useRouter().push).
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { AnalyticsKpis } from '@/app/(app)/analytik/_components/AnalyticsKpis';
import { RevenueBars } from '@/app/(app)/analytik/_components/RevenueBars';
import { CategoryBar } from '@/app/(app)/analytik/_components/CategoryBar';
import { WeekdayBars } from '@/app/(app)/analytik/_components/WeekdayBars';
import { TimeBuckets } from '@/app/(app)/analytik/_components/TimeBuckets';
import { TopRecordsTable } from '@/app/(app)/analytik/_components/TopRecordsTable';
import { PeriodToggle } from '@/app/(app)/analytik/_components/PeriodToggle';
import { CsvExportButton } from '@/app/(app)/analytik/_components/CsvExportButton';
import { fixtureAnalytics } from './fixtures-analytics';

afterEach(cleanup);

describe('AnalyticsKpis', () => {
  it('renders the testid, each label/value, and resolves trend color at render (ok/bad)', () => {
    const a = fixtureAnalytics();
    render(<AnalyticsKpis kpis={a.kpis} />);

    expect(screen.getByTestId('analytik-kpis')).toBeInTheDocument();

    expect(screen.getByText(a.kpis.umsatz.label)).toBeVisible();
    expect(screen.getByText(a.kpis.umsatz.value)).toBeVisible();
    expect(screen.getByText(a.kpis.umsatz.deltaLabel)).toHaveStyle({ color: 'var(--ok)' }); // up:true
    expect(a.kpis.umsatz.up).toBe(true);

    expect(screen.getByText(a.kpis.ankaeufe.value)).toBeVisible();
    expect(screen.getByText(a.kpis.ankaeufe.deltaLabel)).toHaveStyle({ color: 'var(--bad)' }); // up:false
    expect(a.kpis.ankaeufe.up).toBe(false);

    // sub lines render too (non-vacuous — real fixture copy, not just labels)
    expect(screen.getByText(a.kpis.transaktionen.sub)).toBeVisible();
  });
});

describe('RevenueBars', () => {
  it('renders one bar per data point; peak uses --accent, others --accent-soft', () => {
    const a = fixtureAnalytics();
    render(<RevenueBars data={a.umsatzverlauf} />);

    const widget = screen.getByTestId('analytik-revenue-bars');
    expect(widget).toBeInTheDocument();

    const bars = widget.querySelectorAll('[data-bar]');
    expect(bars.length).toBe(a.umsatzverlauf.bars.length);

    const max = Math.max(...a.umsatzverlauf.bars.map((b) => b.valueCents));
    bars.forEach((bar, i) => {
      const expected = a.umsatzverlauf.bars[i].valueCents === max ? 'var(--accent)' : 'var(--accent-soft)';
      expect(bar).toHaveStyle({ background: expected });
    });
    // exactly one peak bar (Fr, index 4 in the fixture)
    expect(bars[4]).toHaveStyle({ background: 'var(--accent)' });
    expect(bars[0]).toHaveStyle({ background: 'var(--accent-soft)' });

    expect(screen.getByText(a.umsatzverlauf.subLabel)).toBeVisible();
    expect(screen.getByText('Fr')).toBeVisible();
  });
});

describe('CategoryBar', () => {
  it('renders a stacked segment + legend row per slice, with the real amounts', () => {
    const a = fixtureAnalytics();
    render(<CategoryBar slices={a.kategorie} />);

    expect(screen.getByTestId('analytik-category-bar')).toBeInTheDocument();
    a.kategorie.forEach((slice) => {
      expect(screen.getByText(slice.label)).toBeVisible();
    });
    // Vinyl is 620000/880000 = 70.5%
    expect(screen.getByText('70.5 %')).toBeVisible();
  });
});

describe('WeekdayBars', () => {
  it('shows "Spitze: {bestDay}" in --ok, and the peak day bar in --accent', () => {
    const a = fixtureAnalytics();
    render(<WeekdayBars data={a.wochentag} />);

    expect(screen.getByTestId('analytik-weekday-bars')).toBeInTheDocument();
    const spitze = screen.getByText(`Spitze: ${a.wochentag.bestDay}`);
    expect(spitze).toHaveStyle({ color: 'var(--ok)' });

    // Freitag (pct:100) is the peak — its fill bar is --accent; Montag (pct:38) is --accent-soft.
    expect(screen.getByText('Fr')).toBeVisible();
    const track = screen.getByTestId('analytik-weekday-bars').querySelectorAll('[data-fill]');
    expect(track.length).toBe(a.wochentag.bars.length);
    expect(track[4]).toHaveStyle({ background: 'var(--accent)' }); // Freitag
    expect(track[0]).toHaveStyle({ background: 'var(--accent-soft)' }); // Montag
  });
});

describe('TimeBuckets', () => {
  it('renders bucket rows (peak --accent, else --honey) + Beste Zeit / Konstanz tiles', () => {
    const a = fixtureAnalytics();
    render(<TimeBuckets data={a.tageszeit} />);

    expect(screen.getByTestId('analytik-time-buckets')).toBeInTheDocument();
    // bestTime happens to also be one of the bucket row labels — scope to the insight tile itself.
    const besteZeitTile = screen.getByText('Beste Zeit').parentElement!;
    expect(within(besteZeitTile).getByText(a.tageszeit.bestTime)).toBeVisible();
    const konstanzTile = screen.getByText('Konstanz').parentElement!;
    expect(within(konstanzTile).getByText(a.tageszeit.consistency)).toBeVisible();

    const fills = screen.getByTestId('analytik-time-buckets').querySelectorAll('[data-fill]');
    expect(fills.length).toBe(a.tageszeit.buckets.length);
    expect(fills[1]).toHaveStyle({ background: 'var(--accent)' }); // Mittag pct:100 — the peak
    expect(fills[0]).toHaveStyle({ background: 'var(--honey)' }); // Vormittag pct:62 — not the peak
  });
});

describe('TopRecordsTable', () => {
  it('renders one row per record with genre pill and --ok margin cell', () => {
    const a = fixtureAnalytics();
    render(<TopRecordsTable rows={a.topRecords} />);

    const widget = screen.getByTestId('analytik-top-records');
    expect(widget).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(a.topRecords.length + 1); // + header row

    expect(screen.getByText('Violator')).toBeVisible();
    expect(screen.getByText('Depeche Mode')).toBeVisible();
    expect(screen.getByText('Electronic')).toBeVisible();
    expect(screen.getByText('62 %')).toHaveStyle({ color: 'var(--ok)' });

    // null genre falls back to an em dash rather than rendering blank/undefined
    expect(screen.getByText('—')).toBeVisible();
  });
});

describe('CsvExportButton', () => {
  it('links to /analytik/export with the current period', () => {
    render(<CsvExportButton period="quarter" />);
    const link = screen.getByTestId('analytik-csv-export');
    expect(link).toHaveAttribute('href', '/analytik/export?period=quarter');
    expect(link).toHaveTextContent('CSV exportieren');
  });
});

describe('PeriodToggle', () => {
  it('renders Woche/Monat/Quartal with the current period selected', () => {
    render(<PeriodToggle period="week" />);
    expect(screen.getByTestId('analytik-period-toggle')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Woche' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Monat' })).not.toBeChecked();
  });

  it('pushes /analytik?period=month when Monat is selected', () => {
    render(<PeriodToggle period="week" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Monat' }));
    expect(push).toHaveBeenCalledWith('/analytik?period=month');
  });
});
