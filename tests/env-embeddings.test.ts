import { describe, expect, it, afterEach, vi } from 'vitest';

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

describe('parseEnv — Embeddings Cross-Field', () => {
  it('http ohne EMBEDDINGS_API_KEY wirft', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    const { parseEnv } = await import('@/env');
    expect(() =>
      parseEnv({ ...BASE, EMBEDDINGS_DRIVER: 'http', EMBEDDINGS_API_KEY: '' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/EMBEDDINGS_API_KEY/);
  });
  it('http mit Key ist ok', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    const { parseEnv } = await import('@/env');
    expect(() =>
      parseEnv({
        ...BASE,
        EMBEDDINGS_DRIVER: 'http',
        EMBEDDINGS_API_KEY: 'sk-x',
      } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
  it('fake ohne Key ist ok (Default)', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    const { parseEnv } = await import('@/env');
    expect(() => parseEnv({ ...BASE, EMBEDDINGS_DRIVER: 'fake' } as unknown as NodeJS.ProcessEnv)).not.toThrow();
  });
});
