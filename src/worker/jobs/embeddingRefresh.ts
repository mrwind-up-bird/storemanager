import type PgBoss from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';
import { records } from '@/db/schema';
import { getEmbeddingsAdapter } from '@/lib/embeddings';
import { buildEmbeddingDocument } from '@/lib/embeddings/document';
import { sha256Hex } from '@/db/hash';

export type EmbeddingRefreshPayload = { tenantId: number; recordId: number };

export async function handleEmbeddingRefresh(job: PgBoss.Job<EmbeddingRefreshPayload>): Promise<void> {
  const { tenantId, recordId } = job.data;
  await withTenant({ tenantId, userId: null }, async (tx) => {
    const [rec] = await tx.select().from(records).where(eq(records.id, recordId)).limit(1);
    if (!rec) return; // Rollback/gelöscht → no-op

    const doc = buildEmbeddingDocument({
      artist: rec.artist,
      title: rec.title,
      label: rec.label,
      genre: rec.genre,
      format: rec.format,
      releaseYear: rec.releaseYear,
      country: rec.country,
    });
    const hash = sha256Hex(doc);
    const adapter = getEmbeddingsAdapter();

    const existing = await tx.execute(
      sql`SELECT content_hash, model FROM record_embeddings WHERE record_id = ${recordId} AND tenant_id = ${tenantId} LIMIT 1`,
    );
    const cur = existing.rows[0] as { content_hash: string; model: string } | undefined;
    if (cur && cur.content_hash === hash && cur.model === adapter.model) return; // unverändert → kein API-Call

    const [vec] = await adapter.embed([doc]);
    const literal = `[${vec!.join(',')}]`;
    await tx.execute(sql`
      INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
      VALUES (${tenantId}, ${recordId}, ${literal}::vector(1536), ${hash}, ${adapter.model})
      ON CONFLICT (tenant_id, record_id) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            content_hash = EXCLUDED.content_hash,
            model = EXCLUDED.model,
            updated_at = now()
    `);
  });
}
