import { describe, it, expect } from 'vitest';
import { mapFormat } from '@/lib/discogs/format';

describe('mapFormat', () => {
  it('maps vinyl synonyms to Vinyl (LP→Vinyl, Slice-1 lesson)', () => {
    expect(mapFormat(['LP', 'Album'])).toBe('Vinyl');
    expect(mapFormat('12"')).toBe('Vinyl');
    expect(mapFormat(['Vinyl'])).toBe('Vinyl');
  });
  it('maps CD and Cassette', () => {
    expect(mapFormat(['CD'])).toBe('CD');
    expect(mapFormat('Cassette')).toBe('Kassette');
  });
  it('falls back / null', () => {
    expect(mapFormat(['Box Set'])).toBe('Box Set');
    expect(mapFormat(null)).toBeNull();
    expect(mapFormat([])).toBeNull();
  });
});
