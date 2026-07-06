// Slice 6 T5 — Billing-Env: Default fake, stripe erzwingt beide Keys (fail-closed on boot).
import { describe, it, expect, afterEach, vi } from 'vitest';

const BASE: Record<string, string> = {
  ROOT_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://qr_app:x@localhost:5432/db',
  DATABASE_OWNER_URL: 'postgresql://qr_owner:x@localhost:5432/db',
  PGBOSS_DATABASE_URL: 'postgresql://qr_owner:x@localhost:5432/db',
  AUTH_SECRET: 's',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ENCRYPTION_KEY_ID: 'v1',
  MAIL_DRIVER: 'console',
  MAIL_HOST: 'localhost',
  MAIL_PORT: '1025',
  MAIL_FROM: 'noreply@localhost',
  DISCOGS_CONSUMER_KEY: 'k',
  DISCOGS_CONSUMER_SECRET: 's',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('billing env', () => {
  it('BILLING_DRIVER default ist fake', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    const { envSchema } = await import('@/env');
    expect(envSchema.parse(BASE).BILLING_DRIVER).toBe('fake');
  });

  it('fake braucht keine Stripe-Keys', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    vi.stubEnv('BILLING_DRIVER', 'fake');
    const { parseEnv } = await import('@/env');
    expect(() => parseEnv({ ...BASE, BILLING_DRIVER: 'fake' } as unknown as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('stripe ohne Keys wirft; mit beiden Keys ok', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    const { parseEnv } = await import('@/env');
    expect(() => parseEnv({ ...BASE, BILLING_DRIVER: 'stripe' } as unknown as NodeJS.ProcessEnv)).toThrow(/STRIPE_SECRET_KEY/);
    expect(() =>
      parseEnv({
        ...BASE,
        BILLING_DRIVER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_x',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() =>
      parseEnv({
        ...BASE,
        BILLING_DRIVER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
      } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('unbekannter Driver wird abgelehnt', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    const { envSchema } = await import('@/env');
    expect(() => envSchema.parse({ ...BASE, BILLING_DRIVER: 'paddle' })).toThrow();
  });
});
