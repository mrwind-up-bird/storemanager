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
  BILLING_DRIVER: 'fake',
  EMBEDDINGS_DRIVER: 'fake',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getEmbeddingsAdapter', () => {
  it('liefert per Default den Fake-Adapter (model fake-v1)', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    const { getEmbeddingsAdapter } = await import('@/lib/embeddings');
    expect(getEmbeddingsAdapter().model).toBe('fake-v1');
  });
  it('ist ein Singleton', async () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    const { getEmbeddingsAdapter } = await import('@/lib/embeddings');
    expect(getEmbeddingsAdapter()).toBe(getEmbeddingsAdapter());
  });
});
