import { describe, it, expect } from 'vitest';
import {
  conditionFromLabel, conditionFactor, discogsGradeKey, conditionLabel, suggestSalePrice,
  DEFAULT_CONDITION_RECORD,
} from '@/lib/pricing';

describe('condition mapping', () => {
  it('label <-> internal grade', () => {
    expect(conditionFromLabel('VG+')).toBe(5);
    expect(conditionLabel(5)).toBe('VG+');
    expect(discogsGradeKey(5)).toBe('Very Good Plus (VG+)');
    expect(conditionFactor(5)).toBe(0.80);
    expect(DEFAULT_CONDITION_RECORD).toBe(5);
  });
  it('throws on unknown label', () => {
    expect(() => conditionFromLabel('ZZ')).toThrow();
  });
});

describe('suggestSalePrice', () => {
  it('uses exact byGrade suggestion when present', () => {
    expect(suggestSalePrice({ suggestion: { byGrade: { 'Very Good Plus (VG+)': 22.5 } }, median: 99, conditionRecord: 5 })).toBe(22.5);
  });
  it('falls back to median × factor', () => {
    expect(suggestSalePrice({ suggestion: null, median: 10, conditionRecord: 5 })).toBe(8); // 10*0.8
  });
  it('null when neither available', () => {
    expect(suggestSalePrice({ suggestion: null, median: null, conditionRecord: 5 })).toBeNull();
  });
  it('rounds to 2dp', () => {
    expect(suggestSalePrice({ suggestion: null, median: 9.999, conditionRecord: 7 })).toBe(10);
  });
});
