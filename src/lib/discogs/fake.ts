import 'server-only';
import type {
  DiscogsAdapter,
  DiscogsAuth,
  DiscogsSearchResult,
  DiscogsPriceSuggestion,
  DiscogsListingInput,
} from './types';

/** All 8 Discogs grade strings in ascending-quality order. */
const GRADE_KEYS = [
  'Poor (P)',
  'Fair (F)',
  'Good (G)',
  'Good Plus (G+)',
  'Very Good (VG)',
  'Very Good Plus (VG+)',
  'Near Mint (NM or M-)',
  'Mint (M)',
] as const;

/** Base prices per grade index for the default seed release. */
const BASE_PRICES = [2.5, 5.0, 8.75, 12.5, 16.25, 22.5, 28.75, 33.0];

/**
 * Deterministic fixture catalogue — at least one release whose title or artist
 * contains "Blue" (case-insensitive), satisfying C12 E2E search requirements.
 */
const FIXTURES: DiscogsSearchResult[] = [
  {
    discogsId: 11111,
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    country: 'US',
    year: 1959,
    format: 'Vinyl',
    genre: ['Jazz'],
    label: ['Columbia'],
    coverImage: 'https://i.discogs.com/fake-kind-of-blue.jpg',
    community: { want: 2500, have: 4200 },
    median: 24.99,
  },
  {
    discogsId: 22222,
    title: 'Abbey Road',
    artist: 'The Beatles',
    country: 'UK',
    year: 1969,
    format: 'Vinyl',
    genre: ['Rock'],
    label: ['Apple Records'],
    coverImage: 'https://i.discogs.com/fake-abbey-road.jpg',
    community: { want: 5100, have: 8700 },
    median: 32.5,
  },
  {
    discogsId: 33333,
    title: 'Blue Lines',
    artist: 'Massive Attack',
    country: 'UK',
    year: 1991,
    format: 'CD',
    genre: ['Electronic', 'Hip Hop'],
    label: ['Wild Bunch Records'],
    coverImage: 'https://i.discogs.com/fake-blue-lines.jpg',
    community: { want: 1800, have: 3100 },
    median: 18.75,
  },
];

/** The ONE fake barcode that hits — E2E + integration tests type this EAN (C4). */
export const FAKE_BARCODE_HIT = '4988031234567';

/**
 * Returns a deterministic `byGrade` price map for the given releaseId.
 * All 8 grade strings are always present. Prices vary slightly by releaseId
 * using a simple integer seed, but are always deterministic.
 */
function buildPriceMap(releaseId: number): Record<string, number> {
  // Small, deterministic offset based on releaseId so each release has distinct prices.
  const offset = (releaseId % 100) * 0.1;
  const byGrade: Record<string, number> = {};
  for (let i = 0; i < GRADE_KEYS.length; i++) {
    byGrade[GRADE_KEYS[i]] = Math.round((BASE_PRICES[i]! + offset) * 100) / 100;
  }
  return byGrade;
}

export function createFakeDiscogsAdapter(): DiscogsAdapter {
  return {
    async getRequestToken(_callbackUrl: string) {
      return {
        token: 'fake-req-token',
        tokenSecret: 'fake-req-secret',
        authorizeUrl: 'https://www.discogs.com/oauth/authorize?oauth_token=fake-req-token',
      };
    },

    async getAccessToken(_args: { requestToken: string; requestTokenSecret: string; verifier: string }) {
      return {
        token: 'fake-access-token',
        tokenSecret: 'fake-access-secret',
        username: 'fake-seller',
      };
    },

    async search(_auth: DiscogsAuth, query: string): Promise<DiscogsSearchResult[]> {
      const q = query.trim().toLowerCase();
      if (!q) return [...FIXTURES];
      return FIXTURES.filter(
        (r) => r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q),
      );
    },

    async searchByBarcode(_auth: DiscogsAuth, barcode: string): Promise<DiscogsSearchResult[]> {
      if (barcode.trim() === FAKE_BARCODE_HIT) return [FIXTURES[0]!, FIXTURES[1]!];
      return [];
    },

    async priceSuggestions(_auth: DiscogsAuth, releaseId: number): Promise<DiscogsPriceSuggestion | null> {
      const exists = FIXTURES.some((r) => r.discogsId === releaseId);
      if (!exists) return null;
      return { byGrade: buildPriceMap(releaseId) };
    },

    async createListing(_auth: DiscogsAuth, input: DiscogsListingInput): Promise<{ listingId: string }> {
      return { listingId: `fake-listing-${input.releaseId}` };
    },

    async identity() {
      return { username: 'fake-seller' };
    },
  };
}
