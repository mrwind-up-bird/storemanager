// src/app/(app)/analytik/page.tsx
import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getAnalytics, type AnalyticsPeriod } from '@/lib/analytics';
import { PeriodToggle } from './_components/PeriodToggle';
import { AnalyticsKpis } from './_components/AnalyticsKpis';
import { RevenueBars } from './_components/RevenueBars';
import { CategoryBar } from './_components/CategoryBar';
import { WeekdayBars } from './_components/WeekdayBars';
import { TimeBuckets } from './_components/TimeBuckets';
import { TopRecordsTable } from './_components/TopRecordsTable';
import { CsvExportButton } from './_components/CsvExportButton';

export default async function AnalytikPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession();
  // Staff-only screen — analytics exposes Umsatz/Rohmarge (sales internals), same gate as
  // kasse/wunschlisten (Global Constraint: no sales internals to kunde). The CSV route (Task 5)
  // gates identically.
  if (user.role === 'kunde') forbidden();

  const tenant = await getCurrentTenant();
  const ctx = { tenantId: tenant.id, userId: user.id };

  // searchParams is a Promise in Next 15 — await before reading, then validate against the
  // AnalyticsPeriod union (never blind-cast), falling back to 'week'.
  const sp = await searchParams;
  const raw = sp.period;
  const period: AnalyticsPeriod = raw === 'month' || raw === 'quarter' ? raw : 'week';

  const data = await getAnalytics(ctx, period);

  return (
    <div data-testid="analytik-screen" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1200 }}>
      <header className="qr-page-header" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(20px,3vw,26px)',
            letterSpacing: '-.02em',
            margin: 0,
          }}
        >
          Analytik
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 15, margin: 0 }}>{data.storeName}</p>
      </header>

      {/* Verbatim from Q-Records App.dc.html analytics section (~line 429): toggle + range + CSV export */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap' }}>
        <PeriodToggle period={data.period} />
        <span style={{ fontSize: '12.5px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
          {data.rangeLabel}
        </span>
        <CsvExportButton period={data.period} />
      </div>

      <AnalyticsKpis kpis={data.kpis} />

      {/* Verbatim grid-template-columns 1.55fr 1fr, gap 20px — Q-Records App.dc.html line 451 (.qr-dash-cols) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, alignItems: 'start' }}>
        <RevenueBars data={data.umsatzverlauf} />
        <CategoryBar slices={data.kategorie} />
      </div>

      {/* Verbatim grid-template-columns 1fr 1fr, gap 20px — Q-Records App.dc.html line 491 (.qr-dash-cols) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <WeekdayBars data={data.wochentag} />
        <TimeBuckets data={data.tageszeit} />
      </div>

      <TopRecordsTable rows={data.topRecords} />
    </div>
  );
}
