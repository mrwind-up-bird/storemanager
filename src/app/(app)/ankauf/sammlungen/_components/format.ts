// src/app/(app)/ankauf/sammlungen/_components/format.ts
import { fromCents } from '@/lib/money';

/** €-display for Sammlungen money cells — mirrors CollectionWizard's `€ {fromCents(cents)}` convention. */
export function formatEuro(cents: number): string {
  return `€ ${fromCents(cents)}`;
}

/** German date display for `acquiredAt` (e.g. '27.6.2026'). */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE');
}
