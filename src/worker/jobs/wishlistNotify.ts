import type PgBoss from 'pg-boss';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';
import { wishlistMatches, wishlists, records, tenants } from '@/db/schema';
import { getEmailAdapter, sendWishlistNotificationEmail } from '@/lib/email/index';

export type WishlistNotifyPayload = { tenantId: number; matchId: number };

/**
 * Worker handler for queue `tenant.wishlist.notify`.
 *
 * Staff-confirmed wishlist notification: sends the customer e-mail for a matched copy and marks the match +
 * wishlist `notified`. Idempotent — only a `pending` match is processed; a second run observes `notified` and
 * is a no-op (no duplicate mail).
 *
 * Race + error policy (C9.4):
 *   - The match row is SELECT … FOR UPDATE-locked BEFORE the status read, so concurrent/retried jobs serialize
 *     and the pending-gate is race-free.
 *   - A thrown send (SMTP/transient) RETHROWS → pg-boss retries; the status flip is AFTER a successful send, so
 *     a retry re-sends until success then is a no-op. Accepted residual: a crash after send but before the DB
 *     commit re-sends once on retry (at-least-once delivery).
 */
export async function handleWishlistNotify(job: PgBoss.Job<WishlistNotifyPayload>): Promise<void> {
  const { tenantId, matchId } = job.data;
  const ctx = { tenantId, userId: null };

  await withTenant(ctx, async (tx) => {
    // 1. Lock the match row first — serializes concurrent/retried jobs (race-free pending gate).
    const [match] = await tx
      .select({
        id: wishlistMatches.id,
        status: wishlistMatches.status,
        wishlistId: wishlistMatches.wishlistId,
        recordId: wishlistMatches.recordId,
      })
      .from(wishlistMatches)
      .where(eq(wishlistMatches.id, matchId))
      .for('update')
      .limit(1);

    // 2. Idempotent gate: missing or already-processed → no-op.
    if (!match || match.status !== 'pending') return;

    // 3. Load wishlist (customer) + record (display) + tenant name.
    const [wl] = await tx
      .select({
        customerName: wishlists.customerName,
        customerEmail: wishlists.customerEmail,
      })
      .from(wishlists)
      .where(eq(wishlists.id, match.wishlistId))
      .limit(1);
    if (!wl) return;

    const [rec] = await tx
      .select({ artist: records.artist, title: records.title })
      .from(records)
      .where(eq(records.id, match.recordId))
      .limit(1);
    if (!rec) return;

    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const tenantName = tenant?.name ?? '';

    // 4. Send — transient failures rethrow → pg-boss retry (status NOT yet flipped).
    await sendWishlistNotificationEmail(getEmailAdapter(), {
      to: wl.customerEmail,
      customerName: wl.customerName,
      artist: rec.artist,
      title: rec.title,
      tenantName,
    });

    // 5. Only AFTER a successful send: flip match + wishlist to notified.
    await tx
      .update(wishlistMatches)
      .set({ status: 'notified', notifiedAt: new Date() })
      .where(eq(wishlistMatches.id, matchId));
    await tx
      .update(wishlists)
      .set({ status: 'notified' })
      .where(eq(wishlists.id, match.wishlistId));
  });
}
