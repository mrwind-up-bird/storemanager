// src/app/(app)/analytik/_components/AnalyticsKpis.tsx
import { Card } from '@/components/ui';
import type { Kpi } from '@/lib/analytics';

export interface AnalyticsKpisProps {
  kpis: { umsatz: Kpi; transaktionen: Kpi; ankaeufe: Kpi; rohmarge: Kpi };
}

/**
 * KPI row — built directly on `Card` (not `KpiCard`, which is dashboard-shaped label+icon;
 * analytics KPIs need a label+trend header — C14).
 *
 * Verbatim layout from Q-Records App.dc.html analytics section (~line 442):
 *   grid repeat(auto-fit,minmax(min(100%,228px),1fr)) gap-16; each card p-20 shadow-1.
 *   header: label (13px text-2 600) + trend (12px 700, color resolved at render — C8).
 *   value: font-mono 500 30px mt-10 ls--.02em. sub: 11.5px text-3 mt-7 font-mono.
 */
export function AnalyticsKpis({ kpis }: AnalyticsKpisProps) {
  const list = [kpis.umsatz, kpis.transaktionen, kpis.ankaeufe, kpis.rohmarge];

  return (
    <div
      data-testid="analytik-kpis"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 228px), 1fr))',
        gap: 16,
      }}
    >
      {list.map((k) => (
        <Card key={k.label} elevation={1} style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>{k.label}</span>
            {/* trend color resolved at render — never stored (C8) */}
            <span style={{ fontSize: 12, fontWeight: 700, color: k.up ? 'var(--ok)' : 'var(--bad)' }}>
              {k.deltaLabel}
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: 30,
              marginTop: 10,
              letterSpacing: '-.02em',
            }}
          >
            {k.value}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: 7, fontFamily: 'var(--font-mono)' }}>
            {k.sub}
          </div>
        </Card>
      ))}
    </div>
  );
}
