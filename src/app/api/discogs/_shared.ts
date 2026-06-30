export function discogsOAuthCookieName(protocol: 'http' | 'https'): string {
  return protocol === 'https' ? '__Host-discogs_oauth' : 'discogs_oauth';
}

export function parseCallbackParams(sp: URLSearchParams): {
  oauthToken: string | null;
  verifier: string | null;
} {
  return { oauthToken: sp.get('oauth_token'), verifier: sp.get('oauth_verifier') };
}
