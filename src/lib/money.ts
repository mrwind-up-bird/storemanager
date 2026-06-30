/** Parse a numeric(10,2) decimal string ('12.34', '12', '12.3') to integer cents. Throws on malformed input. */
export function toCents(value: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`toCents: not a 2-decimal money string: "${value}"`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = Number(m[2]);
  const frac = (m[3] ?? '').padEnd(2, '0');
  return sign * (whole * 100 + Number(frac));
}

/** Format integer cents back to a 2-decimal string ('1234' -> '12.34'). */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`fromCents: cents must be an integer, got ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Discount amount in cents for `percent` (0..100) of `baseCents`. Rounded half-up to nearest cent. */
export function percentToCents(baseCents: number, percent: number): number {
  return Math.round((baseCents * percent) / 100);
}

/** Clamp an integer-cent value into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sum of (unit cents * quantity) over lines. Pure integer arithmetic. */
export function sumLineCents(lines: { unitCents: number; quantity: number }[]): number {
  return lines.reduce((acc, l) => acc + l.unitCents * l.quantity, 0);
}
