// Reine, DB-/env-freie Mapping-Helfer für den v1→v2-Import (scripts/import-qrecords.ts).
// Bewusst ohne 'server-only'/pg/@-Imports, damit sie ohne Testcontainer unit-getestet werden können.

/** Medien-Whitelist. v1.format ist Freitext; alles ohne Format zählt als Medium (Discogs-Import). */
const MEDIA_FORMAT_RX =
  /vinyl|lp\b|\bep\b|single|maxi|\bcd\b|dvd|blu-?ray|cassette|kassette|\btape\b|box|7"|10"|12"|shellac|flexi/i;

export function isMediaFormat(format: string | null | undefined): boolean {
  if (format == null || format.trim() === '') return true; // formatlos = Katalog-Record (kein Getränk)
  return MEDIA_FORMAT_RX.test(format);
}

/** Verkaufs-Wahrheit = purchases.sold_date (deckt sich mit v1s analytics_summary-View). */
export function mapStatus(
  soldDate: Date | string | null | undefined,
  soldFlag = false,
): 'verkauft' | 'verfuegbar' {
  return soldDate != null || soldFlag ? 'verkauft' : 'verfuegbar';
}

/** v1/v2 nutzen beide die 0–7 Discogs-Skala (0 Poor … 7 Mint). Defensiv auf [0,7] clampen. */
export function clampCondition(n: number | null | undefined): number | null {
  if (n == null || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(7, Math.trunc(n)));
}

/** v1 discogs_id ist bigint; v2 discogs_id ist int4. Außerhalb int4 → null (statt Overflow). */
export function toDiscogsId(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n) || n < 0 || n > 2_147_483_647) return null;
  return Math.trunc(n);
}

/** Identifier-Guard für das (nicht bindbare) Quell-Schema — verhindert SQL-Injection über den Env. */
export function safeSchema(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Ungültiges V1_SOURCE_SCHEMA: ${name}`);
  return name;
}
