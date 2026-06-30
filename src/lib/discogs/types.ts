export type DiscogsAuth = { token: string; tokenSecret: string };

export interface DiscogsSearchResult {
  discogsId: number;            // Discogs release id
  title: string;
  artist: string;
  country: string | null;
  year: number | null;
  format: string | null;        // already mapped via mapFormat() → 'Vinyl' | 'CD' | 'Kassette' | string
  genre: string[];
  label: string[];
  coverImage: string | null;
  community: { want: number; have: number };
  median: number | null;        // marketplace anchor (lowest_price / stats), display + pricing fallback
}

export interface DiscogsPriceSuggestion {
  /** keys = Discogs grade strings, e.g. 'Very Good Plus (VG+)' → suggested price */
  byGrade: Record<string, number>;
}

export interface DiscogsListingInput {
  releaseId: number;
  conditionRecord: number;      // 0–7 internal scale
  conditionCover: number;       // 0–7 internal scale
  price: number;                // VK
}

export interface DiscogsAdapter {
  getRequestToken(callbackUrl: string): Promise<{ token: string; tokenSecret: string; authorizeUrl: string }>;
  getAccessToken(args: { requestToken: string; requestTokenSecret: string; verifier: string }):
    Promise<{ token: string; tokenSecret: string; username: string }>;
  search(auth: DiscogsAuth, query: string): Promise<DiscogsSearchResult[]>;
  priceSuggestions(auth: DiscogsAuth, releaseId: number): Promise<DiscogsPriceSuggestion | null>;
  createListing(auth: DiscogsAuth, input: DiscogsListingInput): Promise<{ listingId: string }>;
}

export class DiscogsAuthError extends Error {}       // 401/403 → reconnect required
export class DiscogsRateLimitError extends Error {}  // 429 → transient, retryable
export class DiscogsError extends Error {}           // other non-OK
