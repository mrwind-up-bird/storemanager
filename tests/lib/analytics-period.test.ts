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
  });

  it('quarter = Q boundaries, label "Q2 2026"', () => {
    const r = periodRange('quarter', now);
    expect(r.rangeLabel).toBe('Q2 2026');
    expect(r.start.toISOString()).toBe('2026-03-31T22:00:00.000Z'); // 2026-04-01 00:00 Berlin
    expect(r.end.toISOString()).toBe('2026-06-30T22:00:00.000Z');
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
    });

    it('quarter = Q4 boundaries straddling CEST->CET, label "Q4 2026"', () => {
      const r = periodRange('quarter', dec);
      expect(r.rangeLabel).toBe('Q4 2026');
      expect(r.start.toISOString()).toBe('2026-09-30T22:00:00.000Z'); // 2026-10-01 00:00 Berlin (still CEST +2)
      expect(r.end.toISOString()).toBe('2026-12-31T23:00:00.000Z'); // 2027-01-01 00:00 Berlin (CET +1)
      expect(r.prevStart.toISOString()).toBe('2026-06-30T22:00:00.000Z'); // Q3 start, 2026-07-01 Berlin (CEST)
    });
  });
});
