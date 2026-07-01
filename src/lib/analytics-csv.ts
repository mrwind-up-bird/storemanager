import { fromCents } from '@/lib/money';

// ── C13: CSV export (pure — no DB, no Date.now()) ───────────────────────────────────────────────

export interface CsvTxRow {
  createdAt: Date;
  id: number;
  paymentMethod: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

const HEADER = 'Datum;Bon-Nr;Zahlart;Zwischensumme;Rabatt;Summe';
const CAP_NOTE = '# Hinweis: auf 10000 Zeilen begrenzt';

/** 'YYYY-MM-DD HH:mm' in Europe/Berlin — matches the Berlin-tz convention used throughout Slice 4
 *  (`@/lib/analytics`, `@/lib/analytics-period`). Deterministic: `date` is always a parameter. */
function formatBerlinDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  // Intl reports midnight as "24" with hour12: false — normalise (same fix as analytics-period.ts).
  const hour = String(Number(get('hour')) % 24).padStart(2, '0');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`;
}

/** Wrap in `"` and double inner `"` if the field contains `;`, `"`, or a newline (DE-Excel CSV rule). */
function escapeCsvField(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes transaction rows to DE-Excel CSV (`;`-separated). Pure — money via `fromCents` only
 *  at this display edge, date formatted deterministically from the given `createdAt` (never
 *  `Date.now()`). Appends a cap-note line when `capped` (the route truncated at 10 000 rows). */
export function serializeAnalyticsCsv(rows: CsvTxRow[], capped: boolean): string {
  const lines = [HEADER];
  for (const row of rows) {
    const fields = [
      formatBerlinDateTime(row.createdAt),
      String(row.id),
      row.paymentMethod,
      fromCents(row.subtotalCents),
      fromCents(row.discountCents),
      fromCents(row.totalCents),
    ].map(escapeCsvField);
    lines.push(fields.join(';'));
  }
  if (capped) lines.push(CAP_NOTE);
  return lines.join('\n') + '\n';
}
