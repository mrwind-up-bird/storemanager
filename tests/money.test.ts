import { describe, it, expect } from 'vitest';
import { toCents, fromCents, percentToCents, clamp, sumLineCents } from '@/lib/money';

describe('toCents', () => {
  it('parses 2-decimal, 1-decimal, and integer money strings', () => {
    expect(toCents('12.34')).toBe(1234);
    expect(toCents('12.3')).toBe(1230);
    expect(toCents('12')).toBe(1200);
    expect(toCents('0')).toBe(0);
    expect(toCents('0.05')).toBe(5);
  });
  it('trims surrounding whitespace', () => {
    expect(toCents('  7.50  ')).toBe(750);
  });
  it('parses negative amounts', () => {
    expect(toCents('-3.20')).toBe(-320);
  });
  it('throws on malformed input (no float guessing)', () => {
    expect(() => toCents('12.345')).toThrow(/not a 2-decimal money string/);
    expect(() => toCents('abc')).toThrow(/not a 2-decimal money string/);
    expect(() => toCents('')).toThrow(/not a 2-decimal money string/);
    expect(() => toCents('1,50')).toThrow(/not a 2-decimal money string/);
  });
});

describe('fromCents', () => {
  it('formats integer cents back to a 2-decimal string', () => {
    expect(fromCents(1234)).toBe('12.34');
    expect(fromCents(1200)).toBe('12.00');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(0)).toBe('0.00');
  });
  it('formats negative cents', () => {
    expect(fromCents(-320)).toBe('-3.20');
  });
  it('throws on non-integer cents', () => {
    expect(() => fromCents(12.5)).toThrow(/cents must be an integer/);
  });
  it('round-trips with toCents', () => {
    for (const s of ['0.00', '0.05', '12.34', '999.99', '-3.20']) {
      expect(fromCents(toCents(s))).toBe(s);
    }
  });
});

describe('percentToCents', () => {
  it('computes percent of a base in cents, rounded half-up to the nearest cent', () => {
    expect(percentToCents(1000, 10)).toBe(100); // 10% of 10.00 = 1.00
    expect(percentToCents(0, 25)).toBe(0);
    expect(percentToCents(1000, 0)).toBe(0);
    expect(percentToCents(1000, 100)).toBe(1000);
  });
  it('rounds half-up at the cent boundary', () => {
    // 3% of 12.34 (1234c) = 37.02c -> 37; 33% of 1234c = 407.22 -> 407
    expect(percentToCents(1234, 3)).toBe(37);
    expect(percentToCents(1234, 33)).toBe(407);
    // 50% of 1 cent = 0.5 -> Math.round half-up -> 1
    expect(percentToCents(1, 50)).toBe(1);
  });
});

describe('clamp', () => {
  it('clamps a value into [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp(0, 0, 0)).toBe(0);
  });
});

describe('sumLineCents', () => {
  it('sums unit cents times quantity over lines (pure integer arithmetic)', () => {
    expect(
      sumLineCents([
        { unitCents: 1000, quantity: 2 },
        { unitCents: 250, quantity: 3 },
      ]),
    ).toBe(2750);
    expect(sumLineCents([])).toBe(0);
  });
});
