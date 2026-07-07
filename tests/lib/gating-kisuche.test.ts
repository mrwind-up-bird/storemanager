import { describe, expect, it, vi } from 'vitest';

// Mock @/env so the Zod parse at module-load time does not fail in the unit test
// environment where real env vars are not set (see tests/gating.test.ts).
vi.mock('@/env', () => ({
  env: {
    PGBOSS_DATABASE_URL: 'postgresql://qr_owner:pw@localhost:5432/test',
    DATABASE_URL: 'postgresql://qr_app:pw@localhost:5432/test',
    DATABASE_OWNER_URL: 'postgresql://qr_owner:pw@localhost:5432/test',
    ROOT_DOMAIN: 'localhost',
    APP_PROTOCOL: 'http',
    APP_PORT: '3000',
    AUTH_SECRET: 'test-secret',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    ENCRYPTION_KEY_ID: 'v1',
    MAIL_DRIVER: 'console' as const,
    MAIL_HOST: 'localhost',
    MAIL_PORT: 1025,
    MAIL_FROM: 'test@localhost',
    NODE_ENV: 'test' as const,
    DB_POOL_MAX: 10,
    DB_STATEMENT_TIMEOUT_MS: 10_000,
    DB_IDLE_TX_TIMEOUT_MS: 10_000,
  },
}));

import { FREE_FALLBACK_ENTITLEMENTS, UNLIMITED_ENTITLEMENTS, mergeEntitlements } from '@/lib/gating';

describe('kiSuche-Gating', () => {
  it('Free-Fallback hat kiSuche=false (fail-closed)', () => {
    expect(FREE_FALLBACK_ENTITLEMENTS.features.kiSuche).toBe(false);
  });
  it('UNLIMITED hat kiSuche=true', () => {
    expect(UNLIMITED_ENTITLEMENTS.features.kiSuche).toBe(true);
  });
  it('mergeEntitlements liest kiSuche aus den DB-features', () => {
    const ent = mergeEntitlements(
      { slug: 'small', name: 'Small', priceMonthlyCents: 1900, limits: {}, features: { analytik: true, discogsListing: true, kiSuche: true } },
      null,
    );
    expect(ent.features.kiSuche).toBe(true);
  });
  it('mergeEntitlements defaultet fehlendes kiSuche auf false', () => {
    const ent = mergeEntitlements(
      { slug: 'free', name: 'Free', priceMonthlyCents: 0, limits: {}, features: { analytik: false, discogsListing: false } },
      null,
    );
    expect(ent.features.kiSuche).toBe(false);
  });
});
