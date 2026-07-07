import { fileURLToPath } from 'node:url';
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

// ---------------------------------------------------------------------------
// CLI entry guard — run backfillEmbeddings() only when executed directly, not on import.
// Mirrors scripts/seed.ts's isSeedDirectInvocation (see there for the full esbuild-cjs
// rationale): under `node /app/embeddings-backfill.cjs` (esbuild --format=cjs bundle),
// import.meta.url is empty, so the bundle is ALWAYS treated as the process entrypoint.
// ---------------------------------------------------------------------------
const backfillMetaUrl: string | undefined = import.meta.url;

function isBackfillDirectInvocation(): boolean {
  // esbuild cjs bundle (node embeddings-backfill.cjs): import.meta.url is empty → entrypoint.
  if (!backfillMetaUrl) return true;
  const self = fileURLToPath(backfillMetaUrl);
  return process.argv[1] === self || process.argv[1] === self.replace(/\.ts$/, '.js');
}

if (isBackfillDirectInvocation()) {
  backfillEmbeddings()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error('[embeddings:backfill] failed:', e);
      process.exit(1);
    });
}
