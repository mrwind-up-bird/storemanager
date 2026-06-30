import { describe, it, expect, afterEach, vi } from 'vitest';

/** A complete, valid set of env vars used as a baseline across tests. */
const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  ROOT_DOMAIN: 'localhost',
  APP_PROTOCOL: 'http',
  APP_PORT: '3000',
  DATABASE_URL: 'postgresql://qr_app:pass@localhost:5432/qrdb',
  DATABASE_OWNER_URL: 'postgresql://qr_owner:pass@localhost:5432/qrdb',
  PGBOSS_DATABASE_URL: 'postgresql://qr_owner:pass@localhost:5432/qrdb',
  AUTH_SECRET: 'a-test-secret-that-is-at-least-one-char',
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  ENCRYPTION_KEY_ID: 'v1',
  MAIL_DRIVER: 'console',
  MAIL_HOST: 'localhost',
  MAIL_PORT: '1025',
  MAIL_FROM: 'noreply@localhost',
  DISCOGS_CONSUMER_KEY: 'test-key',
  DISCOGS_CONSUMER_SECRET: 'test-secret',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('env — validation', () => {
  it('throws on boot when DATABASE_URL is missing', async () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = VALID_ENV;
    Object.entries(withoutDb).forEach(([k, v]) => vi.stubEnv(k, v));

    await expect(() => import('@/env')).rejects.toThrow();
  });

  it('throws on boot when MAIL_DRIVER is an invalid value', async () => {
    Object.entries({ ...VALID_ENV, MAIL_DRIVER: 'sendgrid' }).forEach(([k, v]) =>
      vi.stubEnv(k, v),
    );

    await expect(() => import('@/env')).rejects.toThrow();
  });

  it('parses a valid env with correct types', async () => {
    Object.entries(VALID_ENV).forEach(([k, v]) => vi.stubEnv(k, v));

    const { env } = await import('@/env');

    expect(env.ROOT_DOMAIN).toBe('localhost');
    expect(env.APP_PROTOCOL).toBe('http');
    expect(env.APP_PORT).toBe('3000');
    expect(env.MAIL_DRIVER).toBe('console');
    // Numeric defaults applied
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(10000);
    expect(env.DB_IDLE_TX_TIMEOUT_MS).toBe(10000);
  });

  it('applies numeric defaults when optional keys are absent', async () => {
    // DB_POOL_MAX, DB_STATEMENT_TIMEOUT_MS, DB_IDLE_TX_TIMEOUT_MS are optional with defaults
    const {
      DB_POOL_MAX: _1,
      DB_STATEMENT_TIMEOUT_MS: _2,
      DB_IDLE_TX_TIMEOUT_MS: _3,
      ...withoutOptionals
    } = VALID_ENV;
    Object.entries(withoutOptionals).forEach(([k, v]) => vi.stubEnv(k, v));

    const { env } = await import('@/env');

    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(10000);
    expect(env.DB_IDLE_TX_TIMEOUT_MS).toBe(10000);
  });

  it('coerces MAIL_PORT string to number', async () => {
    Object.entries({ ...VALID_ENV, MAIL_PORT: '2525' }).forEach(([k, v]) => vi.stubEnv(k, v));

    const { env } = await import('@/env');

    expect(env.MAIL_PORT).toBe(2525);
    expect(typeof env.MAIL_PORT).toBe('number');
  });
});

describe('tenantUrl()', () => {
  it('includes non-default port (http + 3000)', async () => {
    Object.entries({ ...VALID_ENV, APP_PROTOCOL: 'http', APP_PORT: '3000' }).forEach(([k, v]) =>
      vi.stubEnv(k, v),
    );
    const { tenantUrl } = await import('@/env');

    expect(tenantUrl('demo')).toBe('http://demo.localhost:3000');
  });

  it('omits port 80 for http', async () => {
    Object.entries({ ...VALID_ENV, APP_PROTOCOL: 'http', APP_PORT: '80' }).forEach(([k, v]) =>
      vi.stubEnv(k, v),
    );
    const { tenantUrl } = await import('@/env');

    expect(tenantUrl('demo')).toBe('http://demo.localhost');
  });

  it('omits port 443 for https', async () => {
    Object.entries({
      ...VALID_ENV,
      APP_PROTOCOL: 'https',
      APP_PORT: '443',
      ROOT_DOMAIN: 'example.com',
    }).forEach(([k, v]) => vi.stubEnv(k, v));
    const { tenantUrl } = await import('@/env');

    expect(tenantUrl('vinylcave')).toBe('https://vinylcave.example.com');
  });

  it('uses the slug verbatim in the subdomain position', async () => {
    Object.entries(VALID_ENV).forEach(([k, v]) => vi.stubEnv(k, v));
    const { tenantUrl } = await import('@/env');

    expect(tenantUrl('my-shop')).toMatch(/^http:\/\/my-shop\.localhost/);
  });
});
