import 'server-only';
import { sql } from 'drizzle-orm';
import { withTenant, type TenantCtx, type Tx } from '@/db/tenant';
import { recordHash } from '@/db/hash';
import { records, purchases } from '@/db/schema';

export type AnkaufRelease = {
  discogsId: number | null; // null for manually-entered (off-Discogs) items — never a synthetic id.
  title: string;
  artist: string;
  country: string | null;
  year: number | null;
  format: string | null;
  genre: string[];
  label: string[];
  coverImage: string | null;
};

export type AnkaufInput = {
  release: AnkaufRelease;
  purchasePrice: string; // EK decimal string, e.g. '3.00'
  targetPrice: string; // VK decimal string
  conditionRecord: number; // 0–7
  conditionCover: number; // 0–7
  listOnDiscogs: boolean;
};

/**
 * Runs INSIDE an existing tx (no `withTenant` of its own) — the unit of work shared by
 * `performAnkauf` (single Ankauf) and `createCollection` (batch Ankauf):
 *   1. dedup-upsert the `record` by hash (onConflictDoUpdate on [hash, tenantId]),
 *   2. ALWAYS insert a NEW `purchase` (a physical copy) — never deduped — carrying
 *      `collectionId` (null for a standalone Ankauf, set for a batch item).
 *
 * A second identical Ankauf therefore yields 2 purchases but 1 record.
 */
export async function acquireOne(
  tx: Tx,
  ctx: TenantCtx,
  input: AnkaufInput,
  collectionId: number | null,
): Promise<{ recordId: number; purchaseId: number }> {
  const { release } = input;
  const hash = recordHash({
    title: release.title,
    artist: release.artist,
    country: release.country,
    year: release.year ?? undefined,
    label: release.label,
  });

  const [rec] = await tx
    .insert(records)
    .values({
      tenantId: ctx.tenantId,
      title: release.title,
      artist: release.artist,
      label: release.label,
      country: release.country,
      releaseYear: release.year,
      format: release.format,
      genre: release.genre,
      coverImage: release.coverImage,
      discogsId: release.discogsId,
      hash,
    })
    .onConflictDoUpdate({
      target: [records.hash, records.tenantId],
      // Preserve-on-null: a manual entry (discogsId/coverImage null) must never clobber a real
      // value already on the matched record. EXCLUDED is Postgres's proposed-row alias for the
      // conflicting insert — COALESCE keeps the existing column when the new value is null, and
      // still refreshes it when a real (non-null) value comes in (Discogs re-acquisition).
      set: {
        coverImage: sql`COALESCE(EXCLUDED.cover_image, ${records.coverImage})`,
        discogsId: sql`COALESCE(EXCLUDED.discogs_id, ${records.discogsId})`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: records.id });

  const recordId = rec!.id;

  const [pur] = await tx
    .insert(purchases)
    .values({
      tenantId: ctx.tenantId,
      recordId,
      purchasePrice: input.purchasePrice,
      targetPrice: input.targetPrice,
      conditionRecord: input.conditionRecord,
      conditionCover: input.conditionCover,
      status: 'verfuegbar',
      discogsListingStatus: input.listOnDiscogs ? 'pending' : 'not_listed',
      collectionId,
    })
    .returning({ id: purchases.id });

  return { recordId, purchaseId: pur!.id };
}

/** ONE withTenant transaction wrapping a single `acquireOne` (collectionId always null). */
export async function performAnkauf(
  ctx: TenantCtx,
  input: AnkaufInput,
): Promise<{ recordId: number; purchaseId: number }> {
  return withTenant(ctx, (tx) => acquireOne(tx, ctx, input, null));
}
