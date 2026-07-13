import { describe, it, expect } from 'vitest';
import { marketSignal } from '@/lib/market';

describe('marketSignal — demand level', () => {
  it('returns "unknown" when the community block is missing or empty', () => {
    for (const c of [null, undefined, { want: 0, have: 0 }]) {
      const s = marketSignal(c);
      expect(s.level).toBe('unknown');
      expect(s.ratio).toBeNull();
      expect(s.rare).toBe(false);
      expect(s.label).toBe('—');
    }
  });

  it('buckets want/have ratio: hot ≥2.5, high ≥1.2, normal ≥0.5, else low', () => {
    expect(marketSignal({ want: 250, have: 100 }).level).toBe('hot'); // 2.5
    expect(marketSignal({ want: 130, have: 100 }).level).toBe('high'); // 1.3
    expect(marketSignal({ want: 60, have: 100 }).level).toBe('normal'); // 0.6
    expect(marketSignal({ want: 10, have: 100 }).level).toBe('low'); // 0.1
  });

  it('carries a German label per level', () => {
    expect(marketSignal({ want: 250, have: 100 }).label).toBe('heiß begehrt');
    expect(marketSignal({ want: 130, have: 100 }).label).toBe('stark gefragt');
    expect(marketSignal({ want: 60, have: 100 }).label).toBe('gefragt');
    expect(marketSignal({ want: 10, have: 100 }).label).toBe('ruhig');
  });

  it('computes ratio as want / max(have, 1)', () => {
    expect(marketSignal({ want: 8, have: 4 }).ratio).toBe(2);
    expect(marketSignal({ want: 5, have: 0 }).ratio).toBe(5); // have floored to 1
  });
});

describe('marketSignal — rarity (derived, conservative)', () => {
  it('flags rare when supply is low relative to demand (have ≤ 40 and want ≥ 3× have)', () => {
    expect(marketSignal({ want: 120, have: 30 }).rare).toBe(true); // 4× on low supply
    expect(marketSignal({ want: 90, have: 30 }).rare).toBe(true); // exactly 3×
  });

  it('does not flag rare when supply is plentiful even if demand is high', () => {
    expect(marketSignal({ want: 500, have: 100 }).rare).toBe(false); // have > 40
  });

  it('does not flag rare when demand is under 3× supply', () => {
    expect(marketSignal({ want: 80, have: 30 }).rare).toBe(false); // < 3×
  });

  it('treats a near-unowned release (have 0) as rare only with real want ≥ 5', () => {
    expect(marketSignal({ want: 6, have: 0 }).rare).toBe(true);
    expect(marketSignal({ want: 3, have: 0 }).rare).toBe(false);
  });

  it('truncates fractional counts defensively', () => {
    const s = marketSignal({ want: 12.9, have: 4.9 });
    expect(s.ratio).toBe(12 / 4);
  });
});
