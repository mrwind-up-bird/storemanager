import type PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';
import { purchases, records } from '@/db/schema';
import { getConnection } from '@/lib/discogs-connection';
import { getDiscogsAdapter } from '@/lib/discogs/index';
import { DiscogsRateLimitError } from '@/lib/discogs/types';

export type DiscogsListingPayload = { tenantId: number; purchaseId: number };

/**
 * Worker handler for queue `tenant.discogs.listing.create`.
 *
 * Creates the real Discogs marketplace listing for a purchased copy and writes
 * the resulting status back onto the purchase row.
 *
 * Idempotent: re-running a job for an already-`listed` purchase (with a
 * `discogsListingId`) is a no-op, so pg-boss retries / duplicate sends are safe.
 *
 * Error mapping (per C9):
 *   - DiscogsRateLimitError (429) → RETHROW so pg-boss retries the job later.
 *   - DiscogsAuthError / DiscogsError / any other error → set status 'failed'
 *     and swallow (no retry — the input or auth is the problem, not transient).
 *
 * Tx note: `getConnection(ctx)` deliberately opens its OWN `withTenant`
 * transaction (a second pooled client) rather than reading on the handler's
 * `tx`. That is acceptable here — peak concurrency is 2 pooled clients and
 * pg-boss runs jobs serially (default batchSize=1). Keeping the existing
 * `getConnection` contract avoids duplicating the decrypt logic; the connection
 * read is independent of the purchase write, so a single tx buys us nothing.
 */
export async function handleDiscogsListingCreate(
  job: PgBoss.Job<DiscogsListingPayload>,
): Promise<void> {
  const { tenantId, purchaseId } = job.data;
  const ctx = { tenantId, userId: null };

  await withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        purchaseId: purchases.id,
        status: purchases.discogsListingStatus,
        listingId: purchases.discogsListingId,
        targetPrice: purchases.targetPrice,
        conditionRecord: purchases.conditionRecord,
        conditionCover: purchases.conditionCover,
        discogsId: records.discogsId,
      })
      .from(purchases)
      .innerJoin(records, eq(purchases.recordId, records.id))
      .where(eq(purchases.id, purchaseId))
      .limit(1);

    const p = rows[0];
    if (!p) return;

    // Idempotent: already listed → nothing to do.
    if (p.status === 'listed' && p.listingId) return;

    // No Discogs release to list against → permanent failure.
    if (p.discogsId == null) {
      await tx
        .update(purchases)
        .set({ discogsListingStatus: 'failed' })
        .where(eq(purchases.id, purchaseId));
      return;
    }

    // See "Tx note" above — getConnection opens its own withTenant.
    const conn = await getConnection(ctx);
    if (!conn) {
      await tx
        .update(purchases)
        .set({ discogsListingStatus: 'failed' })
        .where(eq(purchases.id, purchaseId));
      return;
    }

    try {
      const { listingId } = await getDiscogsAdapter().createListing(conn.auth, {
        releaseId: p.discogsId,
        conditionRecord: p.conditionRecord ?? 4,
        conditionCover: p.conditionCover ?? 4,
        price: Number(p.targetPrice ?? 0),
      });
      await tx
        .update(purchases)
        .set({ discogsListingId: listingId, discogsListingStatus: 'listed' })
        .where(eq(purchases.id, purchaseId));
    } catch (e) {
      if (e instanceof DiscogsRateLimitError) throw e; // transient → pg-boss retry
      // DiscogsAuthError / DiscogsError / unknown → permanent failure for this copy.
      await tx
        .update(purchases)
        .set({ discogsListingStatus: 'failed' })
        .where(eq(purchases.id, purchaseId));
    }
  });
}
