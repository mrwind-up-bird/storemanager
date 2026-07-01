// src/app/(app)/analytik/_components/format.ts
import { fromCents } from '@/lib/money';

const EUR_WHOLE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/**
 * Whole-euro display for chart/table money labels (e.g. '€ 1.240'). Mirrors the private
 * `formatEuro` in `@/lib/analytics` — split the `fromCents` decimal string and round from there
 * (per C1, never divide the integer cents by 100 as a float). Not exported from `@/lib/analytics`,
 * so duplicated here at the presentational layer.
 */
export function formatEuroWhole(cents: number): string {
  const [whole, frac] = fromCents(cents).split('.');
  const rounded = Number(frac) >= 50 ? Number(whole) + 1 : Number(whole);
  return `€ ${EUR_WHOLE.format(rounded)}`;
}
