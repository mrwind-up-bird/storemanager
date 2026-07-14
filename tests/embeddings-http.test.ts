import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// http.ts reads only these env fields at embed()-time. Mock so the adapter builds without a
// live provider; every network hop is a stubbed global fetch.
vi.mock('@/env', () => ({
  env: {
    EMBEDDINGS_API_KEY: 'sk-test',
    EMBEDDINGS_API_URL: 'https://api.example.test/v1',
    EMBEDDINGS_MODEL: 'text-embedding-3-small',
  },
}));

import { createHttpEmbeddingsAdapter } from '@/lib/embeddings/http';
import { EmbeddingsConfigError } from '@/lib/embeddings/types';

const EMBEDDING_DIM = 1536;
const vec = (dim: number) => Array.from({ length: dim }, (_, i) => (i % 7) / 7);
const jsonResponse = (body: unknown, init?: { ok?: boolean; status?: number }) =>
  ({ ok: init?.ok ?? true, status: init?.status ?? 200, json: async () => body }) as unknown as Response;

describe('createHttpEmbeddingsAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gibt bei korrekter 1536-dim Provider-Antwort die Vektoren zurück', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ embedding: vec(EMBEDDING_DIM) }] }));
    const out = await createHttpEmbeddingsAdapter().embed(['hallo']);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(EMBEDDING_DIM);
  });

  it('wirft EmbeddingsConfigError bei falscher Dimension (fehlkonfiguriertes Modell)', async () => {
    // z.B. text-embedding-3-large ⇒ 3072 dims. Ohne Guard schlägt das erst am
    // ::vector(1536)-Cast in kiSearch als roher Postgres-500 durch.
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ embedding: vec(3072) }] }));
    await expect(createHttpEmbeddingsAdapter().embed(['hallo'])).rejects.toBeInstanceOf(
      EmbeddingsConfigError,
    );
  });

  it('wirft EmbeddingsConfigError bei 200-Antwort ohne data-Array (Malformed)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ oops: true }));
    await expect(createHttpEmbeddingsAdapter().embed(['hallo'])).rejects.toBeInstanceOf(
      EmbeddingsConfigError,
    );
  });

  it('setzt ein AbortSignal (Timeout), damit ein hängender Provider-Request nicht ewig blockiert', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ embedding: vec(EMBEDDING_DIM) }] }));
    await createHttpEmbeddingsAdapter().embed(['hallo']);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('wirft weiterhin EmbeddingsConfigError bei fehlendem API-Key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ embedding: vec(EMBEDDING_DIM) }] }));
    const adapter = createHttpEmbeddingsAdapter();
    // Key zur Laufzeit entfernen (First-Use-Check).
    const { env } = await import('@/env');
    (env as { EMBEDDINGS_API_KEY: string | undefined }).EMBEDDINGS_API_KEY = undefined;
    await expect(adapter.embed(['hallo'])).rejects.toBeInstanceOf(EmbeddingsConfigError);
    (env as { EMBEDDINGS_API_KEY: string | undefined }).EMBEDDINGS_API_KEY = 'sk-test';
  });
});
