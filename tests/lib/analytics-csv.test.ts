import { describe, it, expect } from 'vitest';
import { serializeAnalyticsCsv, type CsvTxRow } from '@/lib/analytics-csv';

const rows: CsvTxRow[] = [
  {
    createdAt: new Date('2026-06-17T12:34:00Z'),
    id: 7,
    paymentMethod: 'bar',
    subtotalCents: 1200,
    discountCents: 200,
    totalCents: 1000,
  },
];

it('emits DE header + semicolon rows + fromCents money', () => {
  const csv = serializeAnalyticsCsv(rows, false);
  const lines = csv.trim().split('\n');
  expect(lines[0]).toBe('Datum;Bon-Nr;Zahlart;Zwischensumme;Rabatt;Summe');
  expect(lines[1]).toContain(';7;bar;12.00;2.00;10.00');
});

it('escapes a field containing a semicolon and appends cap note', () => {
  const csv = serializeAnalyticsCsv([{ ...rows[0], paymentMethod: 'gut;schein' }], true);
  expect(csv).toContain('"gut;schein"');
  expect(csv.trim().split('\n').pop()).toBe('# Hinweis: auf 10000 Zeilen begrenzt');
});

// Non-vacuous date assertion (the plan's own test only asserts the money portion of the row) —
// pins the FULL row, including the exact 'YYYY-MM-DD HH:mm' Europe/Berlin date, so a tz regression
// (e.g. accidentally formatting in UTC or the server's local zone) fails this test.
describe('date formatting — deterministic Europe/Berlin, no Date.now()', () => {
  it('2026-06-17T12:34:00Z (CEST, UTC+2) → "2026-06-17 14:34" — full row exact match', () => {
    const csv = serializeAnalyticsCsv(rows, false);
    const dataLine = csv.trim().split('\n')[1];
    expect(dataLine).toBe('2026-06-17 14:34;7;bar;12.00;2.00;10.00');
  });

  it('2026-01-15T10:00:00Z (CET, UTC+1) → "2026-01-15 11:00" — winter offset, not hardcoded +2', () => {
    const csv = serializeAnalyticsCsv(
      [{ ...rows[0], createdAt: new Date('2026-01-15T10:00:00Z') }],
      false,
    );
    const dataLine = csv.trim().split('\n')[1];
    expect(dataLine).toBe('2026-01-15 11:00;7;bar;12.00;2.00;10.00');
  });
});

it('escapes a field containing a double-quote by doubling it and wrapping in quotes', () => {
  const csv = serializeAnalyticsCsv([{ ...rows[0], paymentMethod: 'kar"te' }], false);
  expect(csv).toContain('"kar""te"');
});

it('no rows + not capped → header line only', () => {
  const csv = serializeAnalyticsCsv([], false);
  expect(csv.trim().split('\n')).toEqual(['Datum;Bon-Nr;Zahlart;Zwischensumme;Rabatt;Summe']);
});
