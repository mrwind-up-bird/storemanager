import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.mock factories are hoisted; use vi.hoisted() so ENV is defined before the factory runs.
const ENV = vi.hoisted(() => ({
  DISCOGS_API_URL: 'https://api.discogs.com',
  DISCOGS_USER_AGENT: 'QR/2.0',
  DISCOGS_CONSUMER_KEY: 'ck',
  DISCOGS_CONSUMER_SECRET: 'cs',
}));
vi.mock('@/env', () => ({ env: ENV, tenantUrl: (s: string) => `http://${s}.localhost` }));
// Make the limiter a no-op so the test is fast.
vi.mock('@/lib/discogs/ratelimit', async (orig) => ({
  ...(await orig<typeof import('@/lib/discogs/ratelimit')>()),
  discogsLimiter: { acquire: async () => undefined },
}));

import { createHttpDiscogsAdapter } from '@/lib/discogs/client';
import { DiscogsAuthError, DiscogsRateLimitError } from '@/lib/discogs/types';

const auth = { token: 't', tokenSecret: 's' };
afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe('http driver', () => {
  it('maps a search response to DiscogsSearchResult[]', async () => {
    mockFetch(200, {
      results: [{
        id: 42, title: 'Artist - Blue', country: 'US', year: '1959',
        format: ['Vinyl', 'LP'], genre: ['Jazz'], label: ['Columbia'],
        cover_image: 'https://i.discogs.com/x.jpg',
        community: { want: 10, have: 5 }, lowest_price: 24.9,
      }],
    });
    const a = createHttpDiscogsAdapter();
    const res = await a.search(auth, 'blue');
    expect(res[0]).toMatchObject({ discogsId: 42, format: 'Vinyl', median: 24.9, community: { want: 10, have: 5 } });
    // "Artist - Title" split on first ' - '
    expect(res[0]).toMatchObject({ artist: 'Artist', title: 'Blue' });
  });
  it('401 → DiscogsAuthError', async () => {
    mockFetch(401, {});
    await expect(createHttpDiscogsAdapter().search(auth, 'x')).rejects.toBeInstanceOf(DiscogsAuthError);
  });
  it('429 → DiscogsRateLimitError', async () => {
    mockFetch(429, {});
    await expect(createHttpDiscogsAdapter().search(auth, 'x')).rejects.toBeInstanceOf(DiscogsRateLimitError);
  });
  it('createListing returns listingId', async () => {
    mockFetch(201, { listing_id: 9981 });
    const r = await createHttpDiscogsAdapter().createListing(auth, { releaseId: 42, conditionRecord: 5, conditionCover: 4, price: 25 });
    expect(r.listingId).toBe('9981');
  });
  it('priceSuggestions maps byGrade on 200', async () => {
    mockFetch(200, {
      'Very Good Plus (VG+)': { value: 22.5, currency: 'EUR' },
      'Mint (M)': { value: 40, currency: 'EUR' },
    });
    const r = await createHttpDiscogsAdapter().priceSuggestions(auth, 42);
    expect(r?.byGrade['Very Good Plus (VG+)']).toBe(22.5);
    expect(r?.byGrade['Mint (M)']).toBe(40);
  });
  it('priceSuggestions → null on 403 (non-seller)', async () => {
    mockFetch(403, {});
    expect(await createHttpDiscogsAdapter().priceSuggestions(auth, 42)).toBeNull();
  });
  it('priceSuggestions → null on 404', async () => {
    mockFetch(404, {});
    expect(await createHttpDiscogsAdapter().priceSuggestions(auth, 42)).toBeNull();
  });
  it('priceSuggestions throws DiscogsAuthError on 401 (not swallowed)', async () => {
    mockFetch(401, {});
    await expect(createHttpDiscogsAdapter().priceSuggestions(auth, 42)).rejects.toBeInstanceOf(DiscogsAuthError);
  });
});
