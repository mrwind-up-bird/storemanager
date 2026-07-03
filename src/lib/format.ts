// src/lib/format.ts
// Shared euro-display helpers — the single source of truth for money-to-string formatting
// (consolidates what used to be three separate implementations). Pure, no `server-only`, no db
// import — usable from both client and server components. Money crosses to a JS number ONLY here,
// at the display edge (C1); `fromCents` still owns the integer-cent -> decimal-string conversion,
// this module never divides cents by 100 as a float.

import { fromCents } from '@/lib/money';

const EUR_WHOLE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** '€ 8.940' — whole-euro display, rounded half away from zero from the exact `fromCents` decimal
 *  string (never a float division). Rounds the absolute value and re-applies the sign afterwards,
 *  so negative cents round correctly (e.g. -50 cents -> '€ -1', not the mis-signed '€ 1' a naive
 *  `frac >= 50 ? whole + 1 : whole` gives when `whole` is '-0'). */
export function formatEuroWhole(cents: number): string {
  const sign = cents < 0 ? -1 : 1;
  const [whole, frac] = fromCents(Math.abs(cents)).split('.');
  const rounded = Number(frac) >= 50 ? Number(whole) + 1 : Number(whole);
  // Guard against `sign * 0 === -0`: Intl.NumberFormat renders that as the confusing '-0', so a
  // small negative amount that rounds down to nothing (e.g. -5 cents) must format as '€ 0'.
  const signed = rounded === 0 ? 0 : sign * rounded;
  return `€ ${EUR_WHOLE.format(signed)}`;
}

/** '€ 12,34' — 2-decimal display value with a German comma. `fromCents` already yields exactly 2
 *  fractional digits and owns the sign; this just swaps the decimal separator. */
export function formatEuroCents(cents: number): string {
  return `€ ${fromCents(cents).replace('.', ',')}`;
}
