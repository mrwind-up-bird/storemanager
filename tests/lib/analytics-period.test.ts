import { describe, it, expect } from 'vitest';
import { periodRange } from '@/lib/analytics-period';

// Wednesday 2026-06-17 12:00 Europe/Berlin (CEST, UTC+2)
const now = new Date('2026-06-17T10:00:00.000Z');

describe('periodRange', () => {
  it('week = ISO Mon..next Mon with prev week and German range label', () => {
    const r = periodRange('week', now);
    expect(r.start.toISOString()).toBe('2026-06-14T22:00:00.000Z'); // Mon 2026-06-15 00:00 Berlin (CEST +2)
    expect(r.end.toISOString()).toBe('2026-06-21T22:00:00.000Z'); // next Mon
    expect(r.prevStart.toISOString()).toBe('2026-06-07T22:00:00.000Z');
    expect(r.prevEnd.toISOString()).toBe('2026-06-14T22:00:00.000Z');
    expect(r.rangeLabel).toBe('15.–21. Juni 2026');
  });

  it('month = 1st..1st next month, label "Juni 2026"', () => {
    const r = periodRange('month', now);
    expect(r.rangeLabel).toBe('Juni 2026');
    expect(r.start.toISOString()).toBe('2026-05-31T22:00:00.000Z'); // 2026-06-01 00:00 Berlin
    expect(r.end.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(r.prevStart.toISOString()).toBe('2026-04-30T22:00:00.000Z'); // 2026-05-01 00:00 Berlin (prev calendar month)
    expect(r.prevEnd.toISOString()).toBe('2026-05-31T22:00:00.000Z');
  });

  it('quarter = Q boundaries, label "Q2 2026"', () => {
    const r = periodRange('quarter', now);
    expect(r.rangeLabel).toBe('Q2 2026');
    expect(r.start.toISOString()).toBe('2026-03-31T22:00:00.000Z'); // 2026-04-01 00:00 Berlin
    expect(r.end.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(r.prevStart.toISOString()).toBe('2025-12-31T23:00:00.000Z'); // Q1 start, 2026-01-01 00:00 Berlin (CET +1)
    expect(r.prevEnd.toISOString()).toBe('2026-03-31T22:00:00.000Z');
  });

  // Wednesday 2026-12-16 11:00 Europe/Berlin (CET, UTC+1) — proves the offset is computed
  // dynamically per boundary, not hardcoded to CEST +2. The quarter case below straddles
  // both offsets in one call (Q4 starts in October, still CEST, and ends in January, CET).
  describe('December (CET, UTC+1)', () => {
    const dec = new Date('2026-12-16T10:00:00.000Z');

    it('week = Mon 2026-12-14..Mon 2026-12-21 (CET +1), label "14.–20. Dezember 2026"', () => {
      const r = periodRange('week', dec);
      expect(r.start.toISOString()).toBe('2026-12-13T23:00:00.000Z'); // Mon 2026-12-14 00:00 Berlin
      expect(r.end.toISOString()).toBe('2026-12-20T23:00:00.000Z'); // next Mon
      expect(r.prevStart.toISOString()).toBe('2026-12-06T23:00:00.000Z');
      expect(r.prevEnd.toISOString()).toBe('2026-12-13T23:00:00.000Z');
      expect(r.rangeLabel).toBe('14.–20. Dezember 2026');
    });

    it('month = Dec 1..Jan 1, label "Dezember 2026"', () => {
      const r = periodRange('month', dec);
      expect(r.rangeLabel).toBe('Dezember 2026');
      expect(r.start.toISOString()).toBe('2026-11-30T23:00:00.000Z'); // 2026-12-01 00:00 Berlin
      expect(r.end.toISOString()).toBe('2026-12-31T23:00:00.000Z'); // 2027-01-01 00:00 Berlin
      expect(r.prevStart.toISOString()).toBe('2026-10-31T23:00:00.000Z'); // 2026-11-01 00:00 Berlin (prev calendar month)
      expect(r.prevEnd.toISOString()).toBe('2026-11-30T23:00:00.000Z');
    });

    it('quarter = Q4 boundaries straddling CEST->CET, label "Q4 2026"', () => {
      const r = periodRange('quarter', dec);
      expect(r.rangeLabel).toBe('Q4 2026');
      expect(r.start.toISOString()).toBe('2026-09-30T22:00:00.000Z'); // 2026-10-01 00:00 Berlin (still CEST +2)
      expect(r.end.toISOString()).toBe('2026-12-31T23:00:00.000Z'); // 2027-01-01 00:00 Berlin (CET +1)
      expect(r.prevStart.toISOString()).toBe('2026-06-30T22:00:00.000Z'); // Q3 start, 2026-07-01 Berlin (CEST)
      expect(r.prevEnd.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    });
  });

  // Wednesday 2026-01-15 11:00 Europe/Berlin (CET, UTC+1) — prev-period arithmetic must roll
  // back across the year boundary (Date.UTC's negative-month-index normalization).
  describe('January (year-rollover prev period)', () => {
    const jan = new Date('2026-01-15T10:00:00.000Z');

    it('month prev = December 2025', () => {
      const r = periodRange('month', jan);
      expect(r.rangeLabel).toBe('Januar 2026');
      expect(r.start.toISOString()).toBe('2025-12-31T23:00:00.000Z'); // 2026-01-01 00:00 Berlin
      expect(r.end.toISOString()).toBe('2026-01-31T23:00:00.000Z'); // 2026-02-01 00:00 Berlin
      expect(r.prevStart.toISOString()).toBe('2025-11-30T23:00:00.000Z'); // 2025-12-01 00:00 Berlin
      expect(r.prevEnd.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    });
  });

  // Sunday 2026-02-15 11:00 Europe/Berlin (CET, UTC+1) — Q1 prev = Q4 2025, same
  // negative-month-index normalization but crossing 3 months instead of 1.
  describe('February (Q1, year-rollover prev period)', () => {
    const feb = new Date('2026-02-15T10:00:00.000Z');

    it('quarter prev = Q4 2025', () => {
      const r = periodRange('quarter', feb);
      expect(r.rangeLabel).toBe('Q1 2026');
      expect(r.start.toISOString()).toBe('2025-12-31T23:00:00.000Z'); // 2026-01-01 00:00 Berlin
      expect(r.end.toISOString()).toBe('2026-03-31T22:00:00.000Z'); // 2026-04-01 00:00 Berlin (CEST +2)
      expect(r.prevStart.toISOString()).toBe('2025-09-30T22:00:00.000Z'); // 2025-10-01 00:00 Berlin (still CEST +2)
      expect(r.prevEnd.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    });
  });

  // Thursday 2026-01-01 11:00 Europe/Berlin (CET, UTC+1) — the ISO week is Mon 2025-12-29..
  // Sun 2026-01-04, straddling both a month AND a year boundary, exercising the
  // germanMonthDay fallback branch of the week rangeLabel (analytics-period.ts:69-71).
  describe('week straddling year boundary', () => {
    const turnOfYear = new Date('2026-01-01T10:00:00.000Z');

    it('week = Mon 2025-12-29..Mon 2026-01-05, label "29. Dezember 2025 – 4. Januar 2026"', () => {
      const r = periodRange('week', turnOfYear);
      expect(r.start.toISOString()).toBe('2025-12-28T23:00:00.000Z'); // Mon 2025-12-29 00:00 Berlin
      expect(r.end.toISOString()).toBe('2026-01-04T23:00:00.000Z'); // next Mon 2026-01-05 00:00 Berlin
      expect(r.prevStart.toISOString()).toBe('2025-12-21T23:00:00.000Z'); // Mon 2025-12-22 00:00 Berlin
      expect(r.prevEnd.toISOString()).toBe('2025-12-28T23:00:00.000Z');
      expect(r.rangeLabel).toBe('29. Dezember 2025 – 4. Januar 2026');
    });
  });
});
