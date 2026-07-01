// src/app/(app)/analytik/_components/TimeBuckets.tsx
import { Card } from '@/components/ui';
import type { AnalyticsData } from '@/lib/analytics';

export interface TimeBucketsProps {
  data: AnalyticsData['tageszeit'];
}

/**
 * Tageszeit & Erkenntnisse panel — Q-Records App.dc.html analytics section (~line 507).
 * Bucket rows: track w-46% h-14 r-pill bg-surface-3; fill width:pct%, peak `var(--accent)` else
 * `var(--honey)` (C8, distinct from the accent/accent-soft convention elsewhere). Two insight
 * tiles below: "Beste Zeit" (accent-soft) and "Konstanz" (surface-2).
 */
export function TimeBuckets({ data }: TimeBucketsProps) {
  const maxPct = Math.max(0, ...data.buckets.map((b) => b.pct));

  return (
    <Card data-testid="analytik-time-buckets" elevation={1}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
          Tageszeit &amp; Erkenntnisse
        </span>
      </div>
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {data.buckets.map((b) => {
          const isPeak = maxPct > 0 && b.pct === maxPct;
          return (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-2)' }}>{b.label}</span>
              <div style={{ width: '46%', height: 14, borderRadius: 'var(--r-pill)', background: 'var(--surface-3)', overflow: 'hidden' }}>
                <span
                  data-fill
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${b.pct}%`,
                    background: isPeak ? 'var(--accent)' : 'var(--honey)',
                    borderRadius: 'var(--r-pill)',
                  }}
                />
              </div>
              <span style={{ width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>
                {b.pct} %
              </span>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
          <div style={{ flex: 1, padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-border)' }}>
            <div style={{ fontSize: 11, color: 'var(--accent-ink)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Beste Zeit
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginTop: 3 }}>
              {data.bestTime}
            </div>
          </div>
          <div style={{ flex: 1, padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Konstanz
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginTop: 3 }}>
              {data.consistency}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
