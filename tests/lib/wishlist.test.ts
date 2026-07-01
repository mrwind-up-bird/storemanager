import { describe, it, expect, vi } from 'vitest';

// Neutralise the server-only guard + prevent @/db/client (→ @/env → real pg.Pool) from loading.
vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({ appPool: {}, ownerPool: {} }));

import { matchWishlists, type MatchableRecord, type OpenWishlist } from '@/lib/wishlist';

const record: MatchableRecord = {
  artist: 'Miles Davis',
  title: 'Kind of Blue',
  country: 'US',
  label: ['Columbia', 'Legacy'],
};

// Helper: an OpenWishlist with all optional fields null unless overridden.
const wl = (over: Partial<OpenWishlist> & { id: number; artist: string }): OpenWishlist => ({
  label: null,
  title: null,
  country: null,
  ...over,
});

describe('matchWishlists (pure)', () => {
  it('matches on artist as a case-insensitive substring (record CONTAINS wishlist needle)', () => {
    expect(matchWishlists(record, [wl({ id: 1, artist: 'miles' })])).toEqual([1]);
    expect(matchWishlists(record, [wl({ id: 2, artist: 'MILES DAVIS' })])).toEqual([2]);
  });

  it('artist is REQUIRED — a blank/whitespace artist matches NOTHING (over-match guard)', () => {
    expect(matchWishlists(record, [wl({ id: 1, artist: '   ' })])).toEqual([]);
    expect(matchWishlists(record, [wl({ id: 2, artist: '' })])).toEqual([]);
  });

  it('does not match when the artist substring is absent', () => {
    expect(matchWishlists(record, [wl({ id: 1, artist: 'Coltrane' })])).toEqual([]);
  });

  it('applies optional title as a ci-substring filter only when present', () => {
    expect(matchWishlists(record, [wl({ id: 1, artist: 'Miles', title: 'kind of' })])).toEqual([1]);
    expect(matchWishlists(record, [wl({ id: 2, artist: 'Miles', title: 'bitches brew' })])).toEqual([]);
    // blank optional title → treated as absent → still matches on artist alone
    expect(matchWishlists(record, [wl({ id: 3, artist: 'Miles', title: '  ' })])).toEqual([3]);
  });

  it('applies optional country and label ci-substring filters', () => {
    expect(matchWishlists(record, [wl({ id: 1, artist: 'Miles', country: 'us' })])).toEqual([1]);
    expect(matchWishlists(record, [wl({ id: 2, artist: 'Miles', country: 'DE' })])).toEqual([]);
    // label haystack is record.label.join(' ') → 'Columbia Legacy'
    expect(matchWishlists(record, [wl({ id: 3, artist: 'Miles', label: 'columbia' })])).toEqual([3]);
    expect(matchWishlists(record, [wl({ id: 4, artist: 'Miles', label: 'blue note' })])).toEqual([]);
  });

  it('requires artist AND every PRESENT optional field to match', () => {
    expect(
      matchWishlists(record, [
        wl({ id: 1, artist: 'Miles', title: 'Kind', country: 'US', label: 'Columbia' }),
      ]),
    ).toEqual([1]);
    // one optional fails (country) → no match even though artist+title+label all match
    expect(
      matchWishlists(record, [
        wl({ id: 2, artist: 'Miles', title: 'Kind', country: 'JP', label: 'Columbia' }),
      ]),
    ).toEqual([]);
  });

  it('returns only the ids of matching wishlists from a mixed set', () => {
    const ids = matchWishlists(record, [
      wl({ id: 10, artist: 'Miles' }), // match
      wl({ id: 11, artist: 'Coltrane' }), // no
      wl({ id: 12, artist: 'davis', title: 'blue' }), // match ('blue' ⊂ 'kind of blue')
      wl({ id: 13, artist: '   ' }), // blank → no
    ]);
    expect(ids).toEqual([10, 12]);
  });

  it('handles a null record.country safely for country-filtered wishlists', () => {
    const noCountry: MatchableRecord = { ...record, country: null };
    expect(matchWishlists(noCountry, [wl({ id: 1, artist: 'Miles', country: 'US' })])).toEqual([]);
    expect(matchWishlists(noCountry, [wl({ id: 2, artist: 'Miles' })])).toEqual([2]);
  });
});
