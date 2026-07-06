// Slice 6 T2 — pure Merge-Logik (Spec §10 / §14): feldweiser Override, JSON null = unbegrenzt,
// defekte Werte werden ignoriert, Features strikt boolesch.
import { describe, it, expect, vi } from 'vitest';

// Mock @/env so the Zod parse at module-load time does not fail in the unit test
// environment where real env vars are not set.
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

vi.mock('server-only', () => ({}));

import { mergeEntitlements, FREE_FALLBACK_ENTITLEMENTS } from '@/lib/gating';

const SMALL = {
  slug: 'small',
  name: 'Small',
  priceMonthlyCents: 1900,
  limits: { maxRecords: 5000, maxUsers: 10 },
  features: { analytik: true, discogsListing: true },
};

describe('mergeEntitlements', () => {
  it('ohne Overrides gelten die Plan-Werte', () => {
    const e = mergeEntitlements(SMALL, {});
    expect(e).toEqual({
      plan: 'small',
      planName: 'Small',
      priceMonthlyCents: 1900,
      limits: { maxRecords: 5000, maxUsers: 10 },
      features: { analytik: true, discogsListing: true },
    });
  });

  it('Override gewinnt feldweise — das andere Feld bleibt Plan-Wert', () => {
    const e = mergeEntitlements(SMALL, { maxRecords: 2 });
    expect(e.limits).toEqual({ maxRecords: 2, maxUsers: 10 });
  });

  it('JSON null im Override bedeutet unbegrenzt', () => {
    const e = mergeEntitlements(SMALL, { maxRecords: null });
    expect(e.limits.maxRecords).toBeNull();
    expect(e.limits.maxUsers).toBe(10);
  });

  it('JSON null im Plan bedeutet unbegrenzt (big)', () => {
    const e = mergeEntitlements(
      { ...SMALL, slug: 'big', name: 'Big', limits: { maxRecords: null, maxUsers: null } },
      {},
    );
    expect(e.limits).toEqual({ maxRecords: null, maxUsers: null });
  });

  it('defekte Overrides (string, negative, float) werden ignoriert', () => {
    expect(mergeEntitlements(SMALL, { maxRecords: 'viele' }).limits.maxRecords).toBe(5000);
    expect(mergeEntitlements(SMALL, { maxRecords: -1 }).limits.maxRecords).toBe(5000);
    expect(mergeEntitlements(SMALL, { maxRecords: 1.5 }).limits.maxRecords).toBe(5000);
  });

  it('alte Slice-0-Plan-Keys ({records, discogs}) fallen fail-closed auf Free-Limits', () => {
    const e = mergeEntitlements(
      { ...SMALL, limits: { records: 1000 }, features: { discogs: true } },
      {},
    );
    expect(e.limits).toEqual(FREE_FALLBACK_ENTITLEMENTS.limits);
    expect(e.features).toEqual({ analytik: false, discogsListing: false });
  });

  it('Features sind strikt boolesch (truthy-Strings zählen nicht)', () => {
    const e = mergeEntitlements({ ...SMALL, features: { analytik: 'yes', discogsListing: 1 } }, {});
    expect(e.features).toEqual({ analytik: false, discogsListing: false });
  });
});
