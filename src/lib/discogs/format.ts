/** Maps raw Discogs format descriptors to the Slice-1 vocabulary. Pure / client-safe. */
export function mapFormat(input: string[] | string | null | undefined): string | null {
  const arr = (Array.isArray(input) ? input : input ? [input] : [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (arr.length === 0) return null;
  const has = (re: RegExp) => arr.some((s) => re.test(s));
  if (has(/^(vinyl|lp|12"|10"|7"|ep)$/i)) return 'Vinyl';
  if (has(/^(cd|cdr)$/i)) return 'CD';
  if (has(/^(cassette|cass)$/i)) return 'Kassette';
  return arr[0] ?? null;
}
