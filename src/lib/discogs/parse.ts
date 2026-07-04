// Pure helper: extracts the numeric release id from a Discogs release URL.
// Round-trips with discogsReleaseUrl() (src/lib/labels.ts) — the Slice-4 label QR content.
const RELEASE_URL_RE = /^https?:\/\/(?:www\.)?discogs\.com\/release\/(\d+)(?:[-/?#]|$)/i;

export function parseDiscogsReleaseUrl(text: string): number | null {
  const m = RELEASE_URL_RE.exec(text.trim());
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
