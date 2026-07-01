import 'server-only';
import { eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import {
  purchases,
  records,
  quickItems,
  transactions,
  transactionItems,
} from '@/db/schema';
import type { CartInput } from '@/lib/sales';
import { computeCartTotals, type ResolvedCartLine } from '@/lib/sales';

/** performSale receives the SAME shape as the client cart (C4) — one name per concept, cannot diverge. */
export type PerformSaleInput = CartInput;

export type PerformSaleResult = { transactionId: number; total: string };

/** Thrown when an inventory copy cannot be sold (missing or status ∉ {verfuegbar,reserviert}). Aborts the tx. */
export class SaleConflictError extends Error {
  constructor(
    public readonly purchaseId: number,
    public readonly status: string | null,
  ) {
    super(`purchase ${purchaseId} not sellable (status=${status ?? 'missing'})`);
    this.name = 'SaleConflictError';
  }
}

/** Thrown when an inventory copy has no resolvable price (targetPrice null/empty). Aborts the tx —
 *  NEVER record a €0.00 inventory sale (fail-closed; §0a delta 3). */
export class SalePriceMissingError extends Error {
  constructor(public readonly purchaseId: number) {
    super(`purchase ${purchaseId} has no target price (cannot resolve inventory unit price)`);
    this.name = 'SalePriceMissingError';
  }
}

type ResolvedLine = ResolvedCartLine & {
  purchaseId: number | null;
  quickItemId: number | null;
};

export async function performSale(
  ctx: TenantCtx,
  input: PerformSaleInput,
): Promise<PerformSaleResult> {
  // 1. soldByUserId is NOT NULL — require a real user.
  if (ctx.userId === null) {
    throw new Error('performSale: ctx.userId is required (soldByUserId is NOT NULL)');
  }
  const soldByUserId = ctx.userId;

  // 2. Inventory uniqueness guard (defence-in-depth) BEFORE opening the tx. The cart UI key
  //    `inv-<purchaseId>` must not be trusted; the action's createSaleSchema also refines this.
  const inventoryIds = input.lines.flatMap((l) =>
    l.kind === 'inventory' ? [l.purchaseId] : [],
  );
  if (new Set(inventoryIds).size !== inventoryIds.length) {
    throw new Error('duplicate inventory purchaseId in cart');
  }

  // 7. Voucher resolution + fail-closed gate (satisfies transactions_voucher_iff_gutschein).
  const voucherCode =
    input.payment === 'gutschein' ? (input.voucherCode?.trim() || null) : null;
  if (input.payment === 'gutschein' && voucherCode === null) {
    throw new Error('voucherCode required for gutschein');
  }

  // 3. ONE withTenant transaction (no nested withTenant).
  return withTenant(ctx, async (tx) => {
    // 4. Lock the DISTINCT inventory copies ascending (deadlock-free ordering); fail-closed on
    //    missing row or status ∉ {verfuegbar,reserviert} — the whole tx rolls back (no double-sell).
    const distinctIds = [...new Set(inventoryIds)].sort((a, b) => a - b);
    const lockedById = new Map<number, { status: string; targetPrice: string | null; recordId: number }>();
    for (const purchaseId of distinctIds) {
      const [row] = await tx
        .select({
          status: purchases.status,
          targetPrice: purchases.targetPrice,
          recordId: purchases.recordId,
        })
        .from(purchases)
        .where(eq(purchases.id, purchaseId))
        .for('update');
      if (!row || (row.status !== 'verfuegbar' && row.status !== 'reserviert')) {
        throw new SaleConflictError(purchaseId, row?.status ?? null);
      }
      lockedById.set(purchaseId, row);
    }

    // 5. Resolve unitPrice server-side. Client price is authority ONLY for ad-hoc lines.
    const resolved: ResolvedLine[] = [];
    for (const line of input.lines) {
      if (line.kind === 'inventory') {
        const locked = lockedById.get(line.purchaseId)!;
        if (locked.targetPrice === null || locked.targetPrice.trim() === '') {
          throw new SalePriceMissingError(line.purchaseId); // fail-closed: no '?? 0.00' default
        }
        const [rec] = await tx
          .select({ title: records.title })
          .from(records)
          .where(eq(records.id, locked.recordId));
        resolved.push({
          label: rec!.title,
          unitPrice: locked.targetPrice,
          quantity: 1,
          purchaseId: line.purchaseId,
          quickItemId: null,
        });
      } else if (line.kind === 'quick') {
        const [item] = await tx
          .select({ name: quickItems.name, price: quickItems.price, active: quickItems.active })
          .from(quickItems)
          .where(eq(quickItems.id, line.quickItemId));
        if (!item || !item.active) {
          throw new Error(`quick item ${line.quickItemId} missing or inactive`);
        }
        resolved.push({
          label: item.name,
          unitPrice: item.price,
          quantity: line.quantity,
          purchaseId: null,
          quickItemId: line.quickItemId,
        });
      } else {
        resolved.push({
          label: line.label,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          purchaseId: null,
          quickItemId: null,
        });
      }
    }

    // 6. Server-side totals (C4): subtotal − clamped discount = total.
    const totals = computeCartTotals(
      resolved.map((r) => ({ label: r.label, unitPrice: r.unitPrice, quantity: r.quantity })),
      input.discount,
    );

    // 8. Insert the transaction head.
    const [head] = await tx
      .insert(transactions)
      .values({
        tenantId: ctx.tenantId,
        soldByUserId,
        paymentMethod: input.payment,
        subtotal: totals.subtotal,
        discount: totals.discount,
        total: totals.total,
        voucherCode,
      })
      .returning({ id: transactions.id });
    const transactionId = head!.id;

    // 9. Insert all positions.
    await tx.insert(transactionItems).values(
      resolved.map((r) => ({
        tenantId: ctx.tenantId,
        transactionId,
        purchaseId: r.purchaseId,
        quickItemId: r.quickItemId,
        label: r.label,
        unitPrice: r.unitPrice,
        quantity: r.quantity,
      })),
    );

    // 10. Flip each sold copy → verkauft (ascending order, already locked) + stamp snapshot columns.
    for (const purchaseId of distinctIds) {
      const line = resolved.find((r) => r.purchaseId === purchaseId)!;
      await tx
        .update(purchases)
        .set({
          status: 'verkauft',
          soldPrice: line.unitPrice,
          soldDate: new Date(),
          paymentMethod: input.payment, // stored as string in the existing text column (no type migration)
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, purchaseId));
    }

    // 11. Return.
    return { transactionId, total: totals.total };
  });
}
