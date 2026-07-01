import type PgBoss from 'pg-boss';
import { findAndPersistWishlistMatches } from '@/lib/wishlist';

/** Payload for queue `tenant.wishlist.match`. Shared with the queue registration via a type-only import. */
export type WishlistMatchPayload = { tenantId: number; purchaseId: number; recordId: number };

/**
 * Worker handler for queue `tenant.wishlist.match`.
 *
 * Loads this tenant's OPEN wishlists, matches them against the arrived copy's record, and inserts one
 * `wishlist_matches` (status 'pending') per matched wishlist. Idempotent: persistence uses
 * `onConflictDoNothing` on the unique `(wishlistId, purchaseId)`, so a pg-boss retry / duplicate send
 * re-runs the match harmlessly (re-insert affects zero rows).
 *
 * No email is sent here — notification is the staff-confirmed flow (T8, queue `tenant.wishlist.notify`).
 */
export async function handleWishlistMatch(job: PgBoss.Job<WishlistMatchPayload>): Promise<void> {
  const { tenantId, purchaseId, recordId } = job.data;
  const ctx = { tenantId, userId: null };
  await findAndPersistWishlistMatches(ctx, { purchaseId, recordId });
}
