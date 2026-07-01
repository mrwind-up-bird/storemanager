// src/app/(app)/analytik/_components/CsvExportButton.tsx
import type { AnalyticsPeriod } from '@/lib/analytics';

export interface CsvExportButtonProps {
  period: AnalyticsPeriod;
}

/** Anchor styled as the border-strong pill (handoff ~line 438) — GET download, no client JS needed. */
export function CsvExportButton({ period }: CsvExportButtonProps) {
  return (
    <a
      data-testid="analytik-csv-export"
      href={`/analytik/export?period=${period}`}
      className="focus-ring-button"
      style={{
        marginLeft: 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 42,
        padding: '0 18px',
        border: '1.5px solid var(--border-strong)',
        borderRadius: 'var(--r-pill)',
        background: 'var(--surface)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
        fontSize: '13.5px',
        textDecoration: 'none',
      }}
    >
      <span aria-hidden="true">⤓</span> CSV exportieren
    </a>
  );
}
