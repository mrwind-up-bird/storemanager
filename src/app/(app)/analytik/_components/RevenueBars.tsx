// src/app/(app)/analytik/_components/RevenueBars.tsx
import { Card } from '@/components/ui';
import type { AnalyticsData } from '@/lib/analytics';
import { formatEuroWhole } from './format';

export interface RevenueBarsProps {
  data: AnalyticsData['umsatzverlauf'];
}

/**
 * Umsatzverlauf panel — Q-Records App.dc.html analytics section (~line 455).
 * Bars: flex row align-items:flex-end, height:180px; each column is itself a flex column with
 * justify-content:flex-end so [value label, bar, axis label] hug the baseline. Bar height =
 * Math.round(v/max*100)+'%' (C7/C8); peak bar `var(--accent)`, others `var(--accent-soft)`.
 */
export function RevenueBars({ data }: RevenueBarsProps) {
  const max = Math.max(0, ...data.bars.map((b) => b.valueCents));

  return (
    <Card data-testid="analytik-revenue-bars" elevation={1}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          padding: '16px 18px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
            Umsatzverlauf
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{data.subLabel}</div>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 20, letterSpacing: '-.02em' }}>
          {formatEuroWhole(data.totalCents)}
        </span>
      </div>
      <div style={{ padding: '22px 18px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 180 }}>
          {data.bars.map((b) => {
            const isPeak = max > 0 && b.valueCents === max;
            const pct = max > 0 ? Math.round((b.valueCents / max) * 100) : 0;
            return (
              <div
                key={b.label}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  height: '100%',
                  justifyContent: 'flex-end',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--text-3)' }}>
                  {formatEuroWhole(b.valueCents)}
                </span>
                <div
                  data-bar
                  style={{
                    width: '100%',
                    height: `${pct}%`,
                    background: isPeak ? 'var(--accent)' : 'var(--accent-soft)',
                    borderRadius: '5px 5px 0 0',
                  }}
                />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
