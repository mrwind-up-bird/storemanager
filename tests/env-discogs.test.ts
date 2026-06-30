// tests/env-discogs.test.ts
// IMPORTANT: NEVER statically `import … from '@/env'` — src/env.ts runs
// `envSchema.parse(process.env)` at module-eval, which throws a ZodError the
// moment the file loads (vitest does not populate process.env). Mirror the
// existing tests/unit/env.test.ts pattern: stub env, then dynamic-import.
import { describe, it, expect, afterEach, vi } from 'vitest';

const base = {
  ROOT_DOMAIN: 'localhost', DATABASE_URL: 'postgres://x/y', DATABASE_OWNER_URL: 'postgres://x/y',
  PGBOSS_DATABASE_URL: 'postgres://x/y', AUTH_SECRET: 's',
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), ENCRYPTION_KEY_ID: 'k1',
  MAIL_DRIVER: 'console', MAIL_HOST: 'localhost', MAIL_PORT: '1025', MAIL_FROM: 'a@b',
  DISCOGS_CONSUMER_KEY: 'ck', DISCOGS_CONSUMER_SECRET: 'cs',
};

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('env Discogs keys', () => {
  it('defaults DISCOGS_API_URL, USER_AGENT, DRIVER', async () => {
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    const { envSchema } = await import('@/env');
    const e = envSchema.parse(base);
    expect(e.DISCOGS_API_URL).toBe('https://api.discogs.com');
    expect(e.DISCOGS_DRIVER).toBe('http');
    expect(e.DISCOGS_USER_AGENT).toContain('QRecordsStoremanager');
  });
  it('requires consumer key + secret', async () => {
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    const { envSchema } = await import('@/env');
    const { DISCOGS_CONSUMER_KEY: _omit, ...without } = base;
    expect(() => envSchema.parse(without)).toThrow();
  });
});
