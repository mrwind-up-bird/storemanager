export function discogsOAuthCookieName(protocol: 'http' | 'https'): string {
  return protocol === 'https' ? '__Host-discogs_oauth' : 'discogs_oauth';
}

export function parseCallbackParams(sp: URLSearchParams): {
  oauthToken: string | null;
  verifier: string | null;
} {
  return { oauthToken: sp.get('oauth_token'), verifier: sp.get('oauth_verifier') };
}

// Spec-§11.2-Amendment: Wizard/Einstellungen nutzen den BESTEHENDEN OAuth-Connect-Flow
// (keine manuellen Token-Felder). Geschlossene Whitelist statt freiem returnTo.
export type DiscogsReturnTarget = 'ankauf' | 'einstellungen' | 'onboarding';

export const RETURN_PATHS: Record<DiscogsReturnTarget, { ok: string; err: string }> = {
  ankauf: { ok: '/ankauf?connected=1', err: '/ankauf?error=connect' },
  einstellungen: {
    ok: '/einstellungen?tab=discogs&connected=1',
    err: '/einstellungen?tab=discogs&error=connect',
  },
  onboarding: { ok: '/onboarding?step=2&connected=1', err: '/onboarding?step=2&error=connect' },
};

export function resolveReturnTarget(v: unknown): DiscogsReturnTarget {
  return v === 'einstellungen' || v === 'onboarding' ? v : 'ankauf';
}
