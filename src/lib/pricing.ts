import type { DiscogsPriceSuggestion } from '@/lib/discogs/types';

export type ConditionGrade = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// index = internal grade
const CONDITION = [
  { label: 'P',   grade: 'Poor (P)',                 factor: 0.10 }, // 0
  { label: 'F',   grade: 'Fair (F)',                 factor: 0.20 }, // 1
  { label: 'G',   grade: 'Good (G)',                 factor: 0.35 }, // 2
  { label: 'G+',  grade: 'Good Plus (G+)',           factor: 0.50 }, // 3
  { label: 'VG',  grade: 'Very Good (VG)',           factor: 0.65 }, // 4
  { label: 'VG+', grade: 'Very Good Plus (VG+)',     factor: 0.80 }, // 5
  { label: 'NM',  grade: 'Near Mint (NM or M-)',     factor: 0.95 }, // 6
  { label: 'M',   grade: 'Mint (M)',                 factor: 1.00 }, // 7
] as const;

/** UI pill order (descending), per design handoff. */
export const CONDITION_PILLS = ['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'] as const;

export const DEFAULT_CONDITION_RECORD: ConditionGrade = 5; // VG+
export const DEFAULT_CONDITION_COVER: ConditionGrade = 4;  // VG

/** Short display label, e.g. 5 → 'VG+' */
export function conditionLabel(g: ConditionGrade): string {
  return CONDITION[g].label;
}

/** Discogs marketplace grade key string, e.g. 5 → 'Very Good Plus (VG+)' */
export function discogsGradeKey(g: ConditionGrade): string {
  return CONDITION[g].grade;
}

/** Reverse lookup: 'VG+' → 5. Throws on unknown label. */
export function conditionFromLabel(label: string): ConditionGrade {
  const idx = CONDITION.findIndex((c) => c.label === label);
  if (idx === -1) {
    throw new Error(`Unknown condition label: "${label}"`);
  }
  return idx as ConditionGrade;
}

/** Pricing factor for a grade, e.g. 5 → 0.80 */
export function conditionFactor(g: ConditionGrade): number {
  return CONDITION[g].factor;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * VK suggestion. Primary: exact Discogs price-suggestion for the record's grade.
 * Fallback: median × conditionFactor. Returns null if neither available. Rounded to 2dp.
 */
export function suggestSalePrice(args: {
  suggestion: DiscogsPriceSuggestion | null;
  median: number | null;
  conditionRecord: ConditionGrade;
}): number | null {
  const { suggestion, median, conditionRecord } = args;
  const gradeKey = discogsGradeKey(conditionRecord);
  const byGradePrice = suggestion?.byGrade[gradeKey];
  if (typeof byGradePrice === 'number' && isFinite(byGradePrice)) {
    return round2(byGradePrice);
  }
  if (typeof median === 'number' && isFinite(median)) {
    return round2(median * conditionFactor(conditionRecord));
  }
  return null;
}
