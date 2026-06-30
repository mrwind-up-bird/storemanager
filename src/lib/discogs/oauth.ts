import 'server-only';
import { createHmac } from 'node:crypto';

/** RFC3986 percent-encoding (encodeURIComponent + !*'() and leaving ~ unreserved). */
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** OAuth 1.0a signature base string: METHOD&encodedURL&encodedSortedParams (params double-encoded). */
export function signatureBaseString(
  method: string,
  url: string,
  params: Record<string, string | string[]>,
): string {
  // Expand array-valued params into one encoded key=value entry per element, so duplicate
  // keys (e.g. RFC 5849 §3.4.1.1's two `a3` values) all appear in the sorted parameter string.
  const pairs: (readonly [string, string])[] = [];
  for (const k of Object.keys(params)) {
    const raw = params[k];
    const encKey = percentEncode(k);
    if (Array.isArray(raw)) {
      for (const v of raw) pairs.push([encKey, percentEncode(v ?? '')] as const);
    } else {
      pairs.push([encKey, percentEncode(raw ?? '')] as const);
    }
  }
  const normalized = pairs
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(normalized)}`;
}

export function hmacSha1Base64(baseString: string, signingKey: string): string {
  return createHmac('sha1', signingKey).update(baseString).digest('base64');
}

export function buildOAuthHeader(args: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  oauthCallback?: string;
  oauthVerifier?: string;
  nonce: string;
  timestamp: string;
  extraParams?: Record<string, string>;
}): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: args.consumerKey,
    oauth_nonce: args.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: args.timestamp,
    oauth_version: '1.0',
  };
  if (args.token) oauth.oauth_token = args.token;
  if (args.oauthCallback) oauth.oauth_callback = args.oauthCallback;
  if (args.oauthVerifier) oauth.oauth_verifier = args.oauthVerifier;

  const allParams = { ...oauth, ...(args.extraParams ?? {}) };
  const base = signatureBaseString(args.method, args.url, allParams);
  const signingKey = `${percentEncode(args.consumerSecret)}&${percentEncode(args.tokenSecret ?? '')}`;
  oauth.oauth_signature = hmacSha1Base64(base, signingKey);

  const header = Object.keys(oauth)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k] ?? '')}"`)
    .join(', ');
  return `OAuth ${header}`;
}
