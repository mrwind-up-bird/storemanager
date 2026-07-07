import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { withSuperadmin } from '@/db/tenant';
import { enqueueEmbeddingRefresh } from '@/lib/jobs';

/**
 * Reiht pro Tenant alle Records ohne aktuelles Embedding zum Re-Index ein — für Bestandsdaten
 * und nach Modellwechsel. Idempotent über den content_hash-Guard im Handler.
 */
export async function backfillEmbeddings(): Promise<void> {
  const missing = await withSuperadmin((tx) =>
    tx.execute(sql`
      SELECT r.tenant_id, r.id AS record_id
      FROM records r
      LEFT JOIN record_embeddings e ON e.record_id = r.id AND e.tenant_id = r.tenant_id
      WHERE e.id IS NULL
    `),
  );
  for (const row of missing.rows as { tenant_id: number; record_id: number }[]) {
    await enqueueEmbeddingRefresh({ tenantId: row.tenant_id, recordId: row.record_id });
  }
  console.log(`[embeddings:backfill] ${missing.rows.length} Record(s) eingereiht`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  backfillEmbeddings().then(() => process.exit(0)).catch((e) => {
    console.error('[embeddings:backfill] failed:', e);
    process.exit(1);
  });
}
