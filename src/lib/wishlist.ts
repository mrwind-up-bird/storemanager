import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { wishlists, wishlistMatches, records, type WishlistStatus } from '@/db/schema';

// ── PURE matching (no DB; unit-tested with vi.mock('server-only')) ───────────

export type MatchableRecord = {
  artist: string;
  title: string;
  country: string | null;
  label: string[];
};

export type OpenWishlist = {
  id: number;
  artist: string;
  label: string | null;
  title: string | null;
  country: string | null;
};

/**
 * Returns the ids of wishlists that match the record. All comparisons are case-insensitive
 * substring with haystack = record, needle = wishlist; every field is `.trim()`ed first.
 *   - artist:  REQUIRED. record.artist (ci) CONTAINS wishlist.artist (ci). A wishlist whose artist
 *              is BLANK after trim matches NOTHING (prevents a whitespace needle matching every record).
 *   - title:   optional. if present, record.title (ci) CONTAINS wishlist.title (ci).
 *   - country: optional. if present, (record.country ?? '') (ci) CONTAINS wishlist.country (ci).
 *   - label:   optional. if present, record.label.join(' ') (ci) CONTAINS wishlist.label (ci).
 * A wishlist matches only if artist matches AND every PRESENT optional field matches; empty/whitespace
 * optional fields are treated as absent.
 */
export function matchWishlists(record: MatchableRecord, openWishlists: OpenWishlist[]): number[] {
  const hay = {
    artist: record.artist.trim().toLowerCase(),
    title: record.title.trim().toLowerCase(),
    country: (record.country ?? '').trim().toLowerCase(),
    label: record.label.join(' ').trim().toLowerCase(),
  };
  // REQUIRED needle: a blank needle never matches (defensive over-match guard).
  const required = (haystack: string, needle: string): boolean => {
    const n = needle.trim().toLowerCase();
    return n !== '' && haystack.includes(n);
  };
  // OPTIONAL needle: a blank needle is treated as absent → no constraint (passes).
  const optional = (haystack: string, needle: string | null): boolean => {
    const n = (needle ?? '').trim().toLowerCase();
    return n === '' || haystack.includes(n);
  };
  return openWishlists
    .filter(
      (w) =>
        required(hay.artist, w.artist) &&
        optional(hay.title, w.title) &&
        optional(hay.country, w.country) &&
        optional(hay.label, w.label),
    )
    .map((w) => w.id);
}

// ── DB layer (server-only; runs on the withTenant Tx) ────────────────────────

export type CreateWishlistInput = {
  customerName: string;
  customerEmail: string;
  artist: string;
  label?: string | null;
  title?: string | null;
  country?: string | null;
};

/** Trim a free-text optional field; an empty/whitespace value persists as NULL (matches C11 note). */
function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export async function createWishlist(
  ctx: TenantCtx,
  input: CreateWishlistInput,
): Promise<{ id: number }> {
  if (ctx.userId === null) {
    throw new Error('createWishlist: ctx.userId is required (created_by_user_id is NOT NULL)');
  }
  const userId = ctx.userId;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(wishlists)
      .values({
        tenantId: ctx.tenantId,
        createdByUserId: userId,
        customerName: input.customerName.trim(),
        customerEmail: input.customerEmail.trim(),
        artist: input.artist.trim(),
        label: nullableTrim(input.label),
        title: nullableTrim(input.title),
        country: nullableTrim(input.country),
      })
      .returning({ id: wishlists.id });
    return { id: row!.id };
  });
}

export type WishlistRow = {
  id: number;
  customerName: string;
  customerEmail: string;
  artist: string;
  label: string | null;
  title: string | null;
  country: string | null;
  status: WishlistStatus;
  createdAt: Date | null;
};

/** All wishlists for the tenant, newest first (UI groups by status). */
export async function listWishlists(ctx: TenantCtx): Promise<WishlistRow[]> {
  return withTenant(ctx, async (tx) =>
    tx
      .select({
        id: wishlists.id,
        customerName: wishlists.customerName,
        customerEmail: wishlists.customerEmail,
        artist: wishlists.artist,
        label: wishlists.label,
        title: wishlists.title,
        country: wishlists.country,
        status: wishlists.status,
        createdAt: wishlists.createdAt,
      })
      .from(wishlists)
      .orderBy(desc(wishlists.createdAt)),
  );
}

/** One pending wishlist match joined to its wishlist (customer) + the arrived copy's record (display). */
export type PendingMatchRow = {
  matchId: number;
  wishlistId: number;
  customerName: string;
  customerEmail: string;
  artist: string;
  title: string;
  coverImage: string | null;
  createdAt: Date | null;
};

/**
 * Pending matches for the tenant — single source for the wunschlisten "Offene Treffer" section and the
 * Benachrichtigen-Modal preview. Joins wishlist_matches → wishlists → records and returns ONLY rows where
 * wishlist_matches.status = 'pending' AND wishlists.status = 'open' (a notified wishlist is terminal for
 * matching — its leftover pending matches are hidden; C9.4). Newest match first. ONE withTenant tx.
 */
export async function listPendingMatches(ctx: TenantCtx): Promise<PendingMatchRow[]> {
  return withTenant(ctx, async (tx) =>
    tx
      .select({
        matchId: wishlistMatches.id,
        wishlistId: wishlistMatches.wishlistId,
        customerName: wishlists.customerName,
        customerEmail: wishlists.customerEmail,
        artist: records.artist,
        title: records.title,
        coverImage: records.coverImage,
        createdAt: wishlistMatches.createdAt,
      })
      .from(wishlistMatches)
      .innerJoin(wishlists, eq(wishlistMatches.wishlistId, wishlists.id))
      .innerJoin(records, eq(wishlistMatches.recordId, records.id))
      .where(and(eq(wishlistMatches.status, 'pending'), eq(wishlists.status, 'open')))
      .orderBy(desc(wishlistMatches.createdAt)),
  );
}

/**
 * Loads the record (artist/title/country/label) + this tenant's OPEN wishlists, runs matchWishlists,
 * and inserts one wishlist_matches (status 'pending') per matched wishlist using onConflictDoNothing on
 * the unique (wishlistId, purchaseId) — idempotent on match-job re-runs. Returns the number of NEWLY
 * inserted matches (use .returning() length; drives non-vacuous idempotency assertions). ONE withTenant tx.
 */
export async function findAndPersistWishlistMatches(
  ctx: TenantCtx,
  args: { purchaseId: number; recordId: number },
): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const [rec] = await tx
      .select({
        artist: records.artist,
        title: records.title,
        country: records.country,
        label: records.label,
      })
      .from(records)
      .where(eq(records.id, args.recordId));
    if (!rec) return 0;

    const open = await tx
      .select({
        id: wishlists.id,
        artist: wishlists.artist,
        label: wishlists.label,
        title: wishlists.title,
        country: wishlists.country,
      })
      .from(wishlists)
      .where(eq(wishlists.status, 'open'));

    const matchedIds = matchWishlists(
      { artist: rec.artist, title: rec.title, country: rec.country, label: rec.label },
      open,
    );
    if (matchedIds.length === 0) return 0;

    const inserted = await tx
      .insert(wishlistMatches)
      .values(
        matchedIds.map((wishlistId) => ({
          tenantId: ctx.tenantId,
          wishlistId,
          purchaseId: args.purchaseId,
          recordId: args.recordId,
        })),
      )
      .onConflictDoNothing({
        target: [wishlistMatches.wishlistId, wishlistMatches.purchaseId],
      })
      .returning({ id: wishlistMatches.id });

    return inserted.length;
  });
}
