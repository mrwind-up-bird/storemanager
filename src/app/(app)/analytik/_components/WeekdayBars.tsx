// src/app/(app)/analytik/_components/WeekdayBars.tsx
import { Card } from '@/components/ui';
import type { AnalyticsData } from '@/lib/analytics';

export interface WeekdayBarsProps {
  data: AnalyticsData['wochentag'];
}

// Full German weekday (as produced by getAnalytics, C7) → 2-letter axis label (handoff w.l).
const DAY_ABBR: Record<string, string> = {
  Montag: 'Mo', Dienstag: 'Di', Mittwoch: 'Mi', Donnerstag: 'Do', Freitag: 'Fr', Samstag: 'Sa', Sonntag: 'So',
};

/**
 * Verkaufsmuster · Wochentag panel — Q-Records App.dc.html analytics section (~line 494).
 * Horizontal bars: track h-14 r-pill bg-surface-3; fill width:pct%, peak `var(--accent)` else
 * `var(--accent-soft)` (C8). Header right: "Spitze: {bestDay}" in `var(--ok)`.
 */
export function WeekdayBars({ data }: WeekdayBarsProps) {
  const maxPct = Math.max(0, ...data.bars.map((b) => b.pct));

  return (
    <Card data-testid="analytik-weekday-bars" elevation={1}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 18px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
          Verkaufsmuster · Wochentag
        </span>
        <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 700 }}>Spitze: {data.bestDay}</span>
      </div>
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {data.bars.map((b) => {
          const isPeak = maxPct > 0 && b.pct === maxPct;
          return (
            <div key={b.day} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 30, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>
                {DAY_ABBR[b.day] ?? b.day}
              </span>
              <div style={{ flex: 1, height: 14, borderRadius: 'var(--r-pill)', background: 'var(--surface-3)', overflow: 'hidden' }}>
                <span
                  data-fill
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${b.pct}%`,
                    background: isPeak ? 'var(--accent)' : 'var(--accent-soft)',
                    borderRadius: 'var(--r-pill)',
                  }}
                />
              </div>
              <span style={{ width: 40, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                {b.pct} %
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
