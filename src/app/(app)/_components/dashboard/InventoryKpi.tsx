import type { InventoryAggregates } from '@/lib/inventory';
import { KpiCard } from './KpiCard';

/**
 * Formats a euro amount for German locale display (e.g. 84210 → "84.210 €").
 * maximumFractionDigits:0 suppresses cents for large totals (clean KPI display).
 */
function formatEuro(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export interface InventoryKpiProps {
  aggregates: InventoryAggregates;
}

/**
 * "Artikel im Lager" KPI card — the only card on the dashboard with REAL data.
 *
 * Verbatim layout from Q-Records App.dc.html DASHBOARD section (card 2):
 *   count: font-mono 500 32px mt-10px ls--.02em
 *   format bar: mt-16px h-8px r-pill bg-surface-3 overflow-hidden flex
 *     Vinyl → --ok · CD → --info · Andere → --honey
 *   caption: font-mono 11.5px text-3 mt-8px
 *   Inventarwert: font-mono 11.5px text-3 mt-4px (extra line, not in handoff KPI)
 */
export function InventoryKpi({ aggregates }: InventoryKpiProps) {
  const { byStatus, valueAvailable, formatSplit } = aggregates;
  const available = byStatus.verfuegbar;

  const fsTotal = formatSplit.vinyl + formatSplit.cd + formatSplit.other;
  const vinylPct = fsTotal > 0 ? Math.round((formatSplit.vinyl / fsTotal) * 100) : 0;
  const cdPct    = fsTotal > 0 ? Math.round((formatSplit.cd    / fsTotal) * 100) : 0;
  const otherPct = fsTotal > 0 ? 100 - vinylPct - cdPct : 0;

  return (
    <KpiCard label="Artikel im Lager" icon="⬤">
      {/* big count — font-mono 500 32px */}
      <div
        data-testid="kpi-inventory-available"
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 500,
          fontSize: '32px',
          marginTop: '10px',
          letterSpacing: '-.02em',
        }}
      >
        {new Intl.NumberFormat('de-DE').format(available)}
      </div>

      {/* segmented progress bar — Vinyl/CD/Andere */}
      <div
        aria-hidden="true"
        style={{
          marginTop: '16px',
          height: '8px',
          borderRadius: 'var(--r-pill)',
          background: 'var(--surface-3)',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <span style={{ width: `${vinylPct}%`, background: 'var(--ok)' }} />
        <span style={{ width: `${cdPct}%`,    background: 'var(--info)' }} />
        <span style={{ width: `${otherPct}%`, background: 'var(--honey)' }} />
      </div>

      {/* caption: e.g. "Vinyl 64% · CD 22% · Andere 14%" */}
      <div
        data-testid="format-caption"
        style={{
          fontSize: '11.5px',
          color: 'var(--text-3)',
          marginTop: '8px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {`Vinyl ${vinylPct}% · CD ${cdPct}% · Andere ${otherPct}%`}
      </div>

      {/* Inventarwert — spec §6.2: may appear as subtle additional line */}
      {valueAvailable > 0 && (
        <div
          data-testid="inventarwert"
          style={{
            fontSize: '11.5px',
            color: 'var(--text-3)',
            marginTop: '4px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {`Inventarwert ${formatEuro(valueAvailable)}`}
        </div>
      )}
    </KpiCard>
  );
}
