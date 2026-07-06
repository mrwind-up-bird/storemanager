import 'server-only';
import { desc, eq, sql } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { collections, purchases, records } from '@/db/schema';
import { toCents } from '@/lib/money';
import { acquireOne, type AnkaufInput } from '@/lib/ankauf';
import { checkRecordCapacity, type Entitlements } from '@/lib/gating';

export interface CreateCollectionInput {
  sellerName: string;
  sellerContact?: string;
  note?: string;
  acquiredAt?: Date;
  items: AnkaufInput[]; // reuse AnkaufInput per item
}

export interface CollectionSummary {
  id: number;
  sellerName: string;
  acquiredAt: Date;
  itemCount: number;
  totalEkCents: number;
}

export interface CollectionDetailItem {
  purchaseId: number;
  recordId: number;
  artist: string;
  title: string;
  format: string | null;
  conditionRecord: number;
  purchasePriceCents: number;
  targetPriceCents: number | null;
  discogsId: number | null;
}

export interface CollectionDetail extends CollectionSummary {
  sellerContact: string | null;
  note: string | null;
  items: CollectionDetailItem[];
}

/**
 * ONE withTenant transaction: insert the `collection`, then `acquireOne` per item, carrying the
 * new collectionId. Fail-closed — any item throwing (e.g. a malformed purchasePrice hitting the
 * numeric(10,2) column) aborts the whole tx, so nothing commits. No post-commit enqueue here —
 * that's the caller action's job (C11), outside this tx.
 */
export async function createCollection(
  ctx: TenantCtx,
  input: CreateCollectionInput,
  ent: Entitlements,
): Promise<{ collectionId: number; purchaseIds: number[]; recordIds: number[] }> {
  return withTenant(ctx, async (tx) => {
    // Konservativ mit Batchgröße prüfen (aktuell + items.length ≤ max) — Dedupe auf
    // bestehende records wird bewusst nicht vorweggenommen (Spec §10 „aktuell + Batchgröße").
    await checkRecordCapacity(tx, ent, input.items.length);

    const [col] = await tx
      .insert(collections)
      .values({
        tenantId: ctx.tenantId,
        sellerName: input.sellerName,
        sellerContact: input.sellerContact,
        note: input.note,
        ...(input.acquiredAt ? { acquiredAt: input.acquiredAt } : {}),
        createdByUserId: ctx.userId,
      })
      .returning({ id: collections.id });

    const collectionId = col!.id;
    const purchaseIds: number[] = [];
    const recordIds: number[] = [];
    for (const item of input.items) {
      const { recordId, purchaseId } = await acquireOne(tx, ctx, item, collectionId);
      purchaseIds.push(purchaseId);
      recordIds.push(recordId);
    }
    return { collectionId, purchaseIds, recordIds };
  });
}

/** `collections` LEFT JOIN `purchases` GROUP BY collection, newest-first by acquiredAt. */
export async function listCollections(ctx: TenantCtx): Promise<CollectionSummary[]> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: collections.id,
        sellerName: collections.sellerName,
        acquiredAt: collections.acquiredAt,
        itemCount: sql<number>`count(${purchases.id})::int`,
        totalEk: sql<string>`coalesce(sum(${purchases.purchasePrice}), '0')`,
      })
      .from(collections)
      .leftJoin(purchases, eq(purchases.collectionId, collections.id))
      .groupBy(collections.id)
      .orderBy(desc(collections.acquiredAt));

    return rows.map((r) => ({
      id: r.id,
      sellerName: r.sellerName,
      acquiredAt: r.acquiredAt,
      itemCount: r.itemCount,
      totalEkCents: toCents(r.totalEk),
    }));
  });
}

/** The summary + sellerContact/note + the joined purchases→records line items. null if no such collection. */
export async function getCollection(ctx: TenantCtx, id: number): Promise<CollectionDetail | null> {
  return withTenant(ctx, async (tx) => {
    const [col] = await tx.select().from(collections).where(eq(collections.id, id));
    if (!col) return null;

    const itemRows = await tx
      .select({
        purchaseId: purchases.id,
        recordId: records.id,
        artist: records.artist,
        title: records.title,
        format: records.format,
        conditionRecord: purchases.conditionRecord,
        purchasePrice: purchases.purchasePrice,
        targetPrice: purchases.targetPrice,
        discogsId: records.discogsId,
      })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(eq(purchases.collectionId, id));

    const items: CollectionDetailItem[] = itemRows.map((r) => ({
      purchaseId: r.purchaseId,
      recordId: r.recordId,
      artist: r.artist,
      title: r.title,
      format: r.format,
      conditionRecord: r.conditionRecord!,
      purchasePriceCents: toCents(r.purchasePrice!),
      targetPriceCents: r.targetPrice != null ? toCents(r.targetPrice) : null,
      discogsId: r.discogsId,
    }));

    const totalEkCents = items.reduce((acc, it) => acc + it.purchasePriceCents, 0);

    return {
      id: col.id,
      sellerName: col.sellerName,
      acquiredAt: col.acquiredAt,
      itemCount: items.length,
      totalEkCents,
      sellerContact: col.sellerContact,
      note: col.note,
      items,
    };
  });
}
