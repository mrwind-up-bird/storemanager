// tests/lib/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatEuroWhole, formatEuroCents } from '@/lib/format';

describe('formatEuroWhole', () => {
  it('formats positive whole-euro amounts with de-DE thousands separators', () => {
    expect(formatEuroWhole(894_000)).toBe('€ 8.940');
    expect(formatEuroWhole(100)).toBe('€ 1');
  });

  it('formats zero', () => {
    expect(formatEuroWhole(0)).toBe('€ 0');
  });

  it('rounds half up at the .50 boundary', () => {
    expect(formatEuroWhole(149)).toBe('€ 1'); // 1.49 -> 1
    expect(formatEuroWhole(150)).toBe('€ 2'); // 1.50 -> 2
  });

  it('signs negative cents correctly instead of the mis-signed positive result', () => {
    expect(formatEuroWhole(-50)).toBe('€ -1'); // -0.50 -> -1 (away from zero), not '€ 1'
    expect(formatEuroWhole(-149)).toBe('€ -1'); // -1.49 -> -1
    expect(formatEuroWhole(-150)).toBe('€ -2'); // -1.50 -> -2
    expect(formatEuroWhole(-100)).toBe('€ -1');
  });

  it('never renders a bare negative zero when a small negative amount rounds down to nothing', () => {
    expect(formatEuroWhole(-5)).toBe('€ 0'); // -0.05 rounds to 0, not the confusing '-0'
  });
});

describe('formatEuroCents', () => {
  it('formats positive amounts with a German comma and 2 decimals', () => {
    expect(formatEuroCents(1234)).toBe('€ 12,34');
    expect(formatEuroCents(100)).toBe('€ 1,00');
  });

  it('formats zero', () => {
    expect(formatEuroCents(0)).toBe('€ 0,00');
  });

  it('always renders exactly 2 fractional digits', () => {
    expect(formatEuroCents(1200)).toBe('€ 12,00');
    expect(formatEuroCents(5)).toBe('€ 0,05');
  });

  it('handles negative cents', () => {
    expect(formatEuroCents(-1234)).toBe('€ -12,34');
    expect(formatEuroCents(-5)).toBe('€ -0,05');
  });
});
