import 'server-only';
import { and, count, eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { purchases, records, transactionItems, wishlistMatches, type RecordStatus } from '@/db/schema';

export type CopyEditReason = 'not_found' | 'sold_immutable' | 'referenced' | 'invalid_status';

/** Domain error for per-copy (purchase) mutations — the action layer maps `reason` to a German
 *  message. Keeps analytics/sale invariants intact (selling stays the POS's job, sold copies are
 *  immutable, copies with sale history cannot be hard-deleted). */
export class CopyEditError extends Error {
  constructor(public readonly reason: CopyEditReason) {
    super(`copy edit rejected: ${reason}`);
    this.name = 'CopyEditError';
  }
}

/** Statuses a copy may be moved to via the Edit-Modal. `verkauft` is intentionally excluded —
 *  a sale must run through the POS (`performSale`) so a transaction + revenue row is created. */
export type EditableStatus = Exclude<RecordStatus, 'verkauft'>;

export interface UpdatePurchasePatch {
  purchasePrice?: string | null; // EK decimal string ('3.00') or null to clear
  targetPrice?: string | null; // VK-Ziel decimal string or null
  conditionRecord?: number | null; // 0–7
  conditionCover?: number | null; // 0–7
  status?: EditableStatus;
  notes?: string | null;
}

/**
 * Patch an existing copy's editable fields. Fail-closed: a copy that is already `verkauft` is
 * immutable here (its sale is authoritative history), and `verkauft` can never be *set* through
 * this path. Runs under a row lock so a concurrent sale/reservation can't race the edit.
 */
export async function updatePurchase(
  ctx: TenantCtx,
  purchaseId: number,
  patch: UpdatePurchasePatch,
): Promise<{ recordId: number }> {
  if (patch.status === undefined ? false : (patch.status as RecordStatus) === 'verkauft') {
    throw new CopyEditError('invalid_status');
  }
  return withTenant(ctx, async (tx) => {
    const [cur] = await tx
      .select({ id: purchases.id, recordId: purchases.recordId, status: purchases.status })
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, ctx.tenantId)))
      .for('update');
    if (!cur) throw new CopyEditError('not_found');
    if (cur.status === 'verkauft') throw new CopyEditError('sold_immutable');

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if ('purchasePrice' in patch) set.purchasePrice = patch.purchasePrice ?? null;
    if ('targetPrice' in patch) set.targetPrice = patch.targetPrice ?? null;
    if ('conditionRecord' in patch) set.conditionRecord = patch.conditionRecord ?? null;
    if ('conditionCover' in patch) set.conditionCover = patch.conditionCover ?? null;
    if ('notes' in patch) set.notes = patch.notes ?? null;
    if (patch.status !== undefined) set.status = patch.status;

    await tx
      .update(purchases)
      .set(set)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, ctx.tenantId)));

    return { recordId: cur.recordId };
  });
}

export interface AddCopyInput {
  purchasePrice: string | null;
  targetPrice: string | null;
  conditionRecord: number;
  conditionCover: number;
  notes?: string | null;
  listOnDiscogs?: boolean;
}

/** Add a NEW physical copy to an existing record (no dedup — that's the point). No record-capacity
 *  gate: this adds a copy, not a catalog record. Returns the new purchaseId. */
export async function addCopy(
  ctx: TenantCtx,
  recordId: number,
  input: AddCopyInput,
): Promise<{ purchaseId: number }> {
  return withTenant(ctx, async (tx) => {
    const [rec] = await tx
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.id, recordId), eq(records.tenantId, ctx.tenantId)));
    if (!rec) throw new CopyEditError('not_found');

    const [pur] = await tx
      .insert(purchases)
      .values({
        tenantId: ctx.tenantId,
        recordId,
        purchasePrice: input.purchasePrice,
        targetPrice: input.targetPrice,
        conditionRecord: input.conditionRecord,
        conditionCover: input.conditionCover,
        notes: input.notes ?? null,
        status: 'verfuegbar',
        discogsListingStatus: input.listOnDiscogs ? 'pending' : 'not_listed',
      })
      .returning({ id: purchases.id });

    return { purchaseId: pur!.id };
  });
}

/** Clone a copy back into stock — same EK/VK/conditions/notes, status reset to verfuegbar, sale
 *  fields cleared, listing reset. Returns the new copy id + its record id. */
export async function duplicateCopy(
  ctx: TenantCtx,
  purchaseId: number,
): Promise<{ purchaseId: number; recordId: number }> {
  return withTenant(ctx, async (tx) => {
    const [src] = await tx
      .select({
        recordId: purchases.recordId,
        purchasePrice: purchases.purchasePrice,
        targetPrice: purchases.targetPrice,
        conditionRecord: purchases.conditionRecord,
        conditionCover: purchases.conditionCover,
        notes: purchases.notes,
      })
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, ctx.tenantId)));
    if (!src) throw new CopyEditError('not_found');

    const [pur] = await tx
      .insert(purchases)
      .values({
        tenantId: ctx.tenantId,
        recordId: src.recordId,
        purchasePrice: src.purchasePrice,
        targetPrice: src.targetPrice,
        conditionRecord: src.conditionRecord,
        conditionCover: src.conditionCover,
        notes: src.notes,
        status: 'verfuegbar',
        discogsListingStatus: 'not_listed',
      })
      .returning({ id: purchases.id });

    return { purchaseId: pur!.id, recordId: src.recordId };
  });
}

/** Hard-delete a copy. Refused for sold copies (they carry sale history) or any copy still
 *  referenced by a POS line item. Dependent wishlist-match notifications are removed first so the
 *  FK to purchases doesn't block the delete. Returns the affected record id. */
export async function deleteCopy(ctx: TenantCtx, purchaseId: number): Promise<{ recordId: number }> {
  return withTenant(ctx, async (tx) => {
    const [cur] = await tx
      .select({ id: purchases.id, recordId: purchases.recordId, status: purchases.status })
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, ctx.tenantId)))
      .for('update');
    if (!cur) throw new CopyEditError('not_found');
    if (cur.status === 'verkauft') throw new CopyEditError('sold_immutable');

    const [ref] = await tx
      .select({ n: count() })
      .from(transactionItems)
      .where(and(eq(transactionItems.purchaseId, purchaseId), eq(transactionItems.tenantId, ctx.tenantId)));
    if ((ref?.n ?? 0) > 0) throw new CopyEditError('referenced');

    await tx
      .delete(wishlistMatches)
      .where(and(eq(wishlistMatches.purchaseId, purchaseId), eq(wishlistMatches.tenantId, ctx.tenantId)));

    await tx
      .delete(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, ctx.tenantId)));

    return { recordId: cur.recordId };
  });
}
