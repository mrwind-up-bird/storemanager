import 'server-only';
import { randomBytes } from 'node:crypto';
import { env } from '@/env';
import { buildOAuthHeader } from '@/lib/discogs/oauth';
import { discogsLimiter } from '@/lib/discogs/ratelimit';
import {
  DiscogsAdapter,
  DiscogsAuth,
  DiscogsSearchResult,
  DiscogsListingInput,
  DiscogsAuthError,
  DiscogsRateLimitError,
  DiscogsError,
} from '@/lib/discogs/types';
import { mapFormat } from '@/lib/discogs/format';
import { discogsGradeKey, type ConditionGrade } from '@/lib/pricing';

interface RawResult {
  id: number;
  title: string;
  country?: string;
  year?: string;
  format?: string[];
  genre?: string[];
  style?: string[];
  label?: string[];
  cover_image?: string;
  community?: { want: number; have: number };
  lowest_price?: number | null;
}

function mapSearchResult(r: RawResult): DiscogsSearchResult {
  const sepIdx = r.title.indexOf(' - ');
  const artist = sepIdx >= 0 ? r.title.slice(0, sepIdx) : '';
  const title = sepIdx >= 0 ? r.title.slice(sepIdx + 3) : r.title;

  return {
    discogsId: r.id,
    title,
    artist,
    country: r.country ?? null,
    year: r.year ? Number(r.year) || null : null,
    format: mapFormat(r.format ?? null),
    genre: r.genre ?? r.style ?? [],
    label: r.label ?? [],
    coverImage: r.cover_image ?? null,
    community: {
      want: r.community?.want ?? 0,
      have: r.community?.have ?? 0,
    },
    median: r.lowest_price ?? null,
  };
}

function parseUrlEncoded(text: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(text));
}

/** Low-level fetch helper: acquires rate limit slot, builds OAuth header, sends request. */
async function doFetch(
  method: string,
  url: string,
  auth: DiscogsAuth | null,
  opts: {
    oauthCallback?: string;
    oauthVerifier?: string;
    body?: unknown;
  } = {},
): Promise<Response> {
  await discogsLimiter.acquire();

  const nonce = randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));

  const authHeader = buildOAuthHeader({
    method,
    url,
    consumerKey: env.DISCOGS_CONSUMER_KEY,
    consumerSecret: env.DISCOGS_CONSUMER_SECRET,
    token: auth?.token,
    tokenSecret: auth?.tokenSecret,
    oauthCallback: opts.oauthCallback,
    oauthVerifier: opts.oauthVerifier,
    nonce,
    timestamp,
  });

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'User-Agent': env.DISCOGS_USER_AGENT,
  };

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** Throws the appropriate typed error for non-OK HTTP status codes. */
function throwForStatus(status: number, url: string): never {
  const msg = `Discogs HTTP ${status}: ${url}`;
  if (status === 401 || status === 403) {
    throw Object.assign(new DiscogsAuthError(msg), { status });
  }
  if (status === 429) {
    throw Object.assign(new DiscogsRateLimitError(msg), { status });
  }
  throw Object.assign(new DiscogsError(msg), { status });
}

/** Sends a request and parses the response body as JSON. Throws typed errors on non-OK. */
async function requestJson(
  method: string,
  path: string,
  auth: DiscogsAuth | null,
  opts: { body?: unknown } = {},
): Promise<unknown> {
  const url = `${env.DISCOGS_API_URL}${path}`;
  const res = await doFetch(method, url, auth, opts);
  if (!res.ok) throwForStatus(res.status, url);
  return res.json();
}

/** Sends a request and parses the response body as text. Throws typed errors on non-OK. */
async function requestText(
  method: string,
  path: string,
  auth: DiscogsAuth | null,
  opts: { oauthCallback?: string; oauthVerifier?: string } = {},
): Promise<string> {
  const url = `${env.DISCOGS_API_URL}${path}`;
  const res = await doFetch(method, url, auth, opts);
  if (!res.ok) throwForStatus(res.status, url);
  return res.text();
}

export function createHttpDiscogsAdapter(): DiscogsAdapter {
  return {
    async getRequestToken(callbackUrl: string) {
      const text = await requestText('GET', '/oauth/request_token', null, { oauthCallback: callbackUrl });
      const params = parseUrlEncoded(text);
      const token = params['oauth_token'] ?? '';
      const tokenSecret = params['oauth_token_secret'] ?? '';
      return {
        token,
        tokenSecret,
        authorizeUrl: `https://www.discogs.com/oauth/authorize?oauth_token=${token}`,
      };
    },

    async getAccessToken({ requestToken, requestTokenSecret, verifier }) {
      const text = await requestText(
        'POST',
        '/oauth/access_token',
        { token: requestToken, tokenSecret: requestTokenSecret },
        { oauthVerifier: verifier },
      );
      const params = parseUrlEncoded(text);
      const token = params['oauth_token'] ?? '';
      const tokenSecret = params['oauth_token_secret'] ?? '';

      const identity = (await requestJson('GET', '/oauth/identity', { token, tokenSecret })) as {
        username: string;
      };
      return { token, tokenSecret, username: identity.username };
    },

    async search(auth: DiscogsAuth, query: string) {
      const encoded = encodeURIComponent(query);
      const body = (await requestJson(
        'GET',
        `/database/search?q=${encoded}&type=release&per_page=25`,
        auth,
      )) as { results: RawResult[] };
      return (body.results ?? []).map(mapSearchResult);
    },

    async searchByBarcode(auth: DiscogsAuth, barcode: string) {
      const encoded = encodeURIComponent(barcode);
      const body = (await requestJson(
        'GET',
        `/database/search?barcode=${encoded}&type=release&per_page=25`,
        auth,
      )) as { results: RawResult[] };
      return (body.results ?? []).map(mapSearchResult);
    },

    async priceSuggestions(auth: DiscogsAuth, releaseId: number) {
      try {
        const body = (await requestJson(
          'GET',
          `/marketplace/price_suggestions/${releaseId}`,
          auth,
        )) as Record<string, { value: number; currency: string }>;
        const byGrade: Record<string, number> = {};
        for (const [grade, data] of Object.entries(body)) {
          byGrade[grade] = data.value;
        }
        return { byGrade };
      } catch (e: unknown) {
        if (e instanceof DiscogsAuthError || e instanceof DiscogsError) {
          const status = (e as { status?: number }).status;
          if (status === 403 || status === 404) return null;
        }
        throw e;
      }
    },

    async createListing(auth: DiscogsAuth, input: DiscogsListingInput) {
      const body = (await requestJson('POST', '/marketplace/listings', auth, {
        body: {
          release_id: input.releaseId,
          condition: discogsGradeKey(input.conditionRecord as ConditionGrade),
          sleeve_condition: discogsGradeKey(input.conditionCover as ConditionGrade),
          price: input.price,
          status: 'For Sale',
        },
      })) as { listing_id: number };
      return { listingId: String(body.listing_id) };
    },

    async identity(auth: DiscogsAuth) {
      const body = (await requestJson('GET', '/oauth/identity', auth)) as { username: string };
      return { username: body.username };
    },
  };
}
