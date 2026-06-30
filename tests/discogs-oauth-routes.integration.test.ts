import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

let shared: typeof import('@/app/api/discogs/_shared');
let getConnection: (typeof import('@/lib/discogs-connection'))['getConnection'];
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  process.env.DISCOGS_DRIVER = 'fake';
  process.env.APP_PROTOCOL = 'http';
  vi.resetModules();
  shared = await import('@/app/api/discogs/_shared');
  ({ getConnection } = await import('@/lib/discogs-connection'));
  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});

describe('oauth route helpers', () => {
  it('cookie name is protocol-aware', () => {
    expect(shared.discogsOAuthCookieName('http')).toBe('discogs_oauth');
    expect(shared.discogsOAuthCookieName('https')).toBe('__Host-discogs_oauth');
  });
  it('parseCallbackParams extracts token + verifier', () => {
    const sp = new URLSearchParams({ oauth_token: 'abc', oauth_verifier: 'v1' });
    expect(shared.parseCallbackParams(sp)).toEqual({ oauthToken: 'abc', verifier: 'v1' });
  });
  it('parseCallbackParams returns nulls when params are absent', () => {
    expect(shared.parseCallbackParams(new URLSearchParams())).toEqual({
      oauthToken: null,
      verifier: null,
    });
  });
  it('exposes a usable connection accessor for the seeded tenant', async () => {
    expect(await getConnection({ tenantId: tenantA, userId: null })).toBeNull();
  });
});
