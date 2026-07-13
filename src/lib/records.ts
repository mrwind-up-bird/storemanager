import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { records, purchases, type RecordStatus, type DiscogsListingStatus } from '@/db/schema';
import { recordHash } from '@/db/hash';
import { toCents } from '@/lib/money';

/** Thrown when a metadata edit recomputes a `hash` that collides with another record of the
 *  tenant (unique(hash, tenantId)) — i.e. the edit would make this release a duplicate of an
 *  existing one. Surfaced to staff as a friendly validation message by the action layer. */
export class RecordHashConflictError extends Error {
  constructor() {
    super('Ein Release mit identischem Künstler/Titel/Land/Jahr/Label existiert bereits.');
    this.name = 'RecordHashConflictError';
  }
}

/** One physical copy (purchases row) of a record, money in integer cents. */
export interface RecordCopy {
  purchaseId: number;
  status: RecordStatus;
  conditionRecord: number | null;
  conditionCover: number | null;
  purchasePriceCents: number | null; // EK
  targetPriceCents: number | null; // VK-Ziel
  soldPriceCents: number | null;
  soldDate: Date | null;
  acquiredAt: Date | null; // createdAt — "Eingang"
  notes: string | null;
  discogsListingStatus: DiscogsListingStatus;
}

export interface RecordStats {
  total: number;
  available: number; // verfuegbar
  reserved: number; // reserviert
  sold: number; // verkauft
  loaned: number; // verliehen
  stockValueCents: number; // Σ VK-Ziel der verfügbaren Exemplare
  marginCents: number; // Σ (VK − EK) über verkaufte Exemplare
  marginPct: number | null; // marginCents / Σ soldPrice · null wenn kein Umsatz
}

export interface RecordDetail {
  id: number;
  title: string;
  artist: string;
  label: string[];
  country: string | null;
  releaseYear: number | null;
  format: string | null;
  genre: string[];
  styles: string[];
  tags: string[];
  notes: string | null;
  coverImage: string | null;
  discogsId: number | null;
  copies: RecordCopy[];
  stats: RecordStats;
}

/** Full record view = catalog row + all its physical copies + rolled-up stats. null if the
 *  record does not exist for this tenant. Powers the Lagerbestand-Kachel and the Edit-Modal. */
export async function getRecordDetail(ctx: TenantCtx, recordId: number): Promise<RecordDetail | null> {
  return withTenant(ctx, async (tx) => {
    const [rec] = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, recordId), eq(records.tenantId, ctx.tenantId)));
    if (!rec) return null;

    const copyRows = await tx
      .select({
        purchaseId: purchases.id,
        status: purchases.status,
        conditionRecord: purchases.conditionRecord,
        conditionCover: purchases.conditionCover,
        purchasePrice: purchases.purchasePrice,
        targetPrice: purchases.targetPrice,
        soldPrice: purchases.soldPrice,
        soldDate: purchases.soldDate,
        acquiredAt: purchases.createdAt,
        notes: purchases.notes,
        discogsListingStatus: purchases.discogsListingStatus,
      })
      .from(purchases)
      .where(and(eq(purchases.recordId, recordId), eq(purchases.tenantId, ctx.tenantId)))
      .orderBy(asc(purchases.id));

    const copies: RecordCopy[] = copyRows.map((r) => ({
      purchaseId: r.purchaseId,
      status: r.status,
      conditionRecord: r.conditionRecord,
      conditionCover: r.conditionCover,
      purchasePriceCents: r.purchasePrice != null ? toCents(r.purchasePrice) : null,
      targetPriceCents: r.targetPrice != null ? toCents(r.targetPrice) : null,
      soldPriceCents: r.soldPrice != null ? toCents(r.soldPrice) : null,
      soldDate: r.soldDate,
      acquiredAt: r.acquiredAt,
      notes: r.notes,
      discogsListingStatus: r.discogsListingStatus,
    }));

    const stats = computeStats(copies);

    return {
      id: rec.id,
      title: rec.title,
      artist: rec.artist,
      label: rec.label,
      country: rec.country,
      releaseYear: rec.releaseYear,
      format: rec.format,
      genre: rec.genre,
      styles: rec.styles,
      tags: rec.tags,
      notes: rec.notes,
      coverImage: rec.coverImage,
      discogsId: rec.discogsId,
      copies,
      stats,
    };
  });
}

function computeStats(copies: RecordCopy[]): RecordStats {
  let available = 0;
  let reserved = 0;
  let sold = 0;
  let loaned = 0;
  let stockValueCents = 0;
  let marginCents = 0;
  let revenueCents = 0;

  for (const c of copies) {
    switch (c.status) {
      case 'verfuegbar':
        available += 1;
        stockValueCents += c.targetPriceCents ?? 0;
        break;
      case 'reserviert':
        reserved += 1;
        stockValueCents += c.targetPriceCents ?? 0;
        break;
      case 'verkauft':
        sold += 1;
        if (c.soldPriceCents != null) {
          revenueCents += c.soldPriceCents;
          marginCents += c.soldPriceCents - (c.purchasePriceCents ?? 0);
        }
        break;
      case 'verliehen':
        loaned += 1;
        break;
    }
  }

  return {
    total: copies.length,
    available,
    reserved,
    sold,
    loaned,
    stockValueCents,
    marginCents,
    marginPct: revenueCents > 0 ? (marginCents / revenueCents) * 100 : null,
  };
}

export interface UpdateRecordPatch {
  title: string;
  artist: string;
  label: string[];
  country: string | null;
  releaseYear: number | null;
  format: string | null;
  genre: string[];
  styles: string[];
  tags: string[];
  notes: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * Full-replace of a record's editable metadata (Edit-Modal is authoritative). The dedup `hash`
 * is recomputed from the identity fields (artist/title/country/year/label) so the catalog stays
 * correctly deduplicated after a rename — a collision with an existing release surfaces as
 * RecordHashConflictError rather than a raw 23505.
 */
export async function updateRecord(
  ctx: TenantCtx,
  recordId: number,
  patch: UpdateRecordPatch,
): Promise<void> {
  const hash = recordHash({
    title: patch.title,
    artist: patch.artist,
    country: patch.country,
    year: patch.releaseYear ?? undefined,
    label: patch.label,
  });

  await withTenant(ctx, async (tx) => {
    try {
      await tx
        .update(records)
        .set({
          title: patch.title,
          artist: patch.artist,
          label: patch.label,
          country: patch.country,
          releaseYear: patch.releaseYear,
          format: patch.format,
          genre: patch.genre,
          styles: patch.styles,
          tags: patch.tags,
          notes: patch.notes,
          hash,
          updatedAt: new Date(),
        })
        .where(and(eq(records.id, recordId), eq(records.tenantId, ctx.tenantId)));
    } catch (err) {
      if (isUniqueViolation(err)) throw new RecordHashConflictError();
      throw err;
    }
  });
}
