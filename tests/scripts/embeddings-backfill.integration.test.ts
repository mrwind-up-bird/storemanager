import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from '../helpers/db';

const FAKE_VEC = `[${Array.from({ length: 1536 }, () => 0).map((_, i) => (i === 0 ? 1 : 0)).join(',')}]`;

const enqueueEmbeddingRefresh = vi.fn(async () => undefined);
vi.mock('@/lib/jobs', () => ({ enqueueEmbeddingRefresh }));

describe('backfillEmbeddings', () => {
  let db: TestDatabase;
  let backfillEmbeddings: (typeof import('../../scripts/embeddings-backfill'))['backfillEmbeddings'];
  let tenantId: number;
  let recordWithEmbeddingId: number;
  let recordWithoutEmbeddingId: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    vi.resetModules();
    ({ tenantId } = await seedTenant({ slug: 'backfill', name: 'Backfill' }));

    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows: withEmbedding } = await owner.query(
        `INSERT INTO records (tenant_id, title, artist, label, genre, hash)
         VALUES ($1, 'Has Embedding', 'Artist A', ARRAY['Label'], ARRAY['Jazz'], 'h-has') RETURNING id`,
        [tenantId],
      );
      recordWithEmbeddingId = withEmbedding[0].id;

      const { rows: withoutEmbedding } = await owner.query(
        `INSERT INTO records (tenant_id, title, artist, label, genre, hash)
         VALUES ($1, 'Missing Embedding', 'Artist B', ARRAY['Label'], ARRAY['Rock'], 'h-missing') RETURNING id`,
        [tenantId],
      );
      recordWithoutEmbeddingId = withoutEmbedding[0].id;

      // Only ONE of the two records gets a record_embeddings row — the other must be the
      // sole target of backfillEmbeddings()'s LEFT JOIN ... WHERE missing.
      await owner.query(
        `INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
         VALUES ($1, $2, $3::vector(1536), 'ch', 'fake-v1')`,
        [tenantId, recordWithEmbeddingId, FAKE_VEC],
      );
    } finally {
      await owner.end();
    }

    ({ backfillEmbeddings } = await import('../../scripts/embeddings-backfill'));
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  it('reiht NUR den Record OHNE Embedding ein (nicht den bereits indexierten)', async () => {
    await backfillEmbeddings();

    expect(enqueueEmbeddingRefresh).toHaveBeenCalledTimes(1);
    expect(enqueueEmbeddingRefresh).toHaveBeenCalledWith({
      tenantId,
      recordId: recordWithoutEmbeddingId,
    });
  });
});
