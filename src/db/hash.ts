import { createHash } from 'node:crypto';

export function recordHash(input: {
  title: string;
  artist: string;
  country?: string | null;
  year?: number | null;
  label?: string[];
}): string {
  const { title, artist, country, year, label } = input;
  const parts = [
    artist,
    title,
    country ?? '',
    year ?? '',
    (label ?? []).join(','),
  ].map((s) => String(s).trim().toLowerCase());
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
