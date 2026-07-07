import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from '../helpers/db';

describe('handleEmbeddingRefresh', () => {
  let db: TestDatabase;
  let handle: typeof import('@/worker/jobs/embeddingRefresh')['handleEmbeddingRefresh'];
  let embeddingsMod: typeof import('@/lib/embeddings');
  let tenantId: number;
  let recordId: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    vi.resetModules();
    ({ tenantId } = await seedTenant({ slug: 'emb', name: 'Emb' }));
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows } = await owner.query(
        `INSERT INTO records (tenant_id, title, artist, label, genre, hash)
         VALUES ($1, 'A Love Supreme', 'John Coltrane', ARRAY['Impulse!'], ARRAY['Jazz'], 'h1') RETURNING id`,
        [tenantId],
      );
      recordId = rows[0].id;
    } finally {
      await owner.end();
    }
    handle = (await import('@/worker/jobs/embeddingRefresh')).handleEmbeddingRefresh;
    embeddingsMod = await import('@/lib/embeddings');
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  const job = (payload: { tenantId: number; recordId: number }) =>
    ({ id: 'j', name: 'q', data: payload }) as never;

  async function countAndHash() {
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows } = await owner.query(
        `SELECT content_hash, model, updated_at FROM record_embeddings WHERE record_id = $1`,
        [recordId],
      );
      return rows[0] as { content_hash: string; model: string; updated_at: string } | undefined;
    } finally {
      await owner.end();
    }
  }

  it('upsertet ein Embedding für einen neuen Record', async () => {
    await handle(job({ tenantId, recordId }));
    const row = await countAndHash();
    expect(row).toBeDefined();
    expect(row!.model).toBe('fake-v1');
  });

  it('re-embedded NICHT bei unverändertem contentHash+model (kein embed-Call)', async () => {
    const spy = vi.spyOn(embeddingsMod, 'getEmbeddingsAdapter');
    const embedSpy = vi.fn();
    spy.mockReturnValue({ model: 'fake-v1', embed: embedSpy });
    await handle(job({ tenantId, recordId }));
    expect(embedSpy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('re-embedded bei geändertem Dokument', async () => {
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      await owner.query(`UPDATE records SET title = 'Giant Steps' WHERE id = $1`, [recordId]);
    } finally {
      await owner.end();
    }
    const before = await countAndHash();
    await handle(job({ tenantId, recordId }));
    const after = await countAndHash();
    expect(after!.content_hash).not.toBe(before!.content_hash);
  });

  it('fehlender Record → no-op', async () => {
    await expect(handle(job({ tenantId, recordId: 999_999 }))).resolves.toBeUndefined();
  });
});
