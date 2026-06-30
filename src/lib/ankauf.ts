import 'server-only';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { recordHash } from '@/db/hash';
import { records, purchases } from '@/db/schema';

export type AnkaufRelease = {
  discogsId: number;
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
 * ONE withTenant transaction:
 *   1. dedup-upsert the `record` by hash (onConflictDoUpdate on [hash, tenantId]),
 *   2. ALWAYS insert a NEW `purchase` (a physical copy) — never deduped.
 *
 * A second identical Ankauf therefore yields 2 purchases but 1 record.
 */
export async function performAnkauf(
  ctx: TenantCtx,
  input: AnkaufInput,
): Promise<{ recordId: number; purchaseId: number }> {
  const { release } = input;
  const hash = recordHash({
    title: release.title,
    artist: release.artist,
    country: release.country,
    year: release.year ?? undefined,
    label: release.label,
  });

  return withTenant(ctx, async (tx) => {
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
        set: {
          coverImage: release.coverImage,
          discogsId: release.discogsId,
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
      })
      .returning({ id: purchases.id });

    return { recordId, purchaseId: pur!.id };
  });
}
