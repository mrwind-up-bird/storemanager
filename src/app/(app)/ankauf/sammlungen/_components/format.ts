// src/app/(app)/ankauf/sammlungen/_components/format.ts
import { formatEuroCents } from '@/lib/format';

/** €-display for Sammlungen money cells — delegates to the shared `formatEuroCents` (German comma
 *  decimal), consolidated out of the local period-decimal duplicate that used to live here. */
export const formatEuro = formatEuroCents;

/** German date display for `acquiredAt` (e.g. '27.6.2026'). */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE');
}
