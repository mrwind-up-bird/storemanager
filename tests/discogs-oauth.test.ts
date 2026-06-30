import { describe, it, expect } from 'vitest';
import { percentEncode, signatureBaseString, hmacSha1Base64, buildOAuthHeader } from '@/lib/discogs/oauth';

describe('percentEncode', () => {
  it('encodes per RFC3986 (space→%20, unreserved ~ stays)', () => {
    expect(percentEncode('a b~c')).toBe('a%20b~c');
    expect(percentEncode('Ladies + Gentlemen')).toBe('Ladies%20%2B%20Gentlemen');
  });
});

describe('signatureBaseString + hmacSha1Base64 (RFC 5849 example)', () => {
  // The canonical RFC 5849 §3.4.1.1 example. Note `a3` appears TWICE in the published
  // request (a3=a in the query string, a3=2 q in the form body), so it is an array here.
  const params: Record<string, string | string[]> = {
    b5: '=%3D', a3: ['a', '2 q'], 'c@': '', a2: 'r b',
    oauth_consumer_key: '9djdj82h48djs9d2', oauth_token: 'kkk9d7dh3k39sjv7',
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: '137131201', oauth_nonce: '7d8f3e4a',
    c2: '',
  };
  it('builds the exact base string', () => {
    const base = signatureBaseString('POST', 'http://example.com/request', params);
    expect(base).toContain('POST&http%3A%2F%2Fexample.com%2Frequest&');
    // a2, a3, b5 sorted & double-encoded
    expect(base).toContain('a2%3Dr%2520b');
    expect(base).toContain('b5%3D%253D%25253D');
  });
  it('matches the RFC 5849 §3.4.1.1 published signature (real vector)', () => {
    // RFC 5849 example: consumer secret 'j49sk3j29djd', token secret 'dh893hdasih9'.
    // Signing key = percentEncode(cs) + '&' + percentEncode(ts) = 'j49sk3j29djd&dh893hdasih9'.
    // The RFC publishes the resulting HMAC-SHA1 signature as 'r6/TJjbCOr97/+UU0NsvSne7s5g='.
    const base = signatureBaseString('POST', 'http://example.com/request', params);
    const sig = hmacSha1Base64(base, 'j49sk3j29djd&dh893hdasih9');
    expect(sig).toBe('r6/TJjbCOr97/+UU0NsvSne7s5g=');
    // If this assertion fails, the IMPLEMENTATION is wrong (base-string or HMAC), not the
    // expected value — RFC 5849 §3.4.1.1 is authoritative. Do NOT edit the expected to match.
  });
});

describe('buildOAuthHeader', () => {
  it('emits an OAuth header with consumer key, signature, callback', () => {
    const h = buildOAuthHeader({
      method: 'GET', url: 'https://api.discogs.com/oauth/request_token',
      consumerKey: 'ck', consumerSecret: 'cs', oauthCallback: 'https://demo.localhost/cb',
      nonce: 'n1', timestamp: '1000',
    });
    expect(h).toMatch(/^OAuth /);
    expect(h).toContain('oauth_consumer_key="ck"');
    expect(h).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(h).toContain('oauth_callback="https%3A%2F%2Fdemo.localhost%2Fcb"');
    expect(h).toContain('oauth_signature=');
  });
});
