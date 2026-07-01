import 'server-only';
import { eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { purchases } from '@/db/schema';

/** Thrown when a copy is not in the required source status for the requested transition. Aborts the tx. */
export class ReservationConflictError extends Error {
  constructor(
    public readonly purchaseId: number,
    public readonly status: string | null,
  ) {
    super(`purchase ${purchaseId} not in required status (status=${status ?? 'missing'})`);
    this.name = 'ReservationConflictError';
  }
}

/** verfuegbar → reserviert. ONE withTenant tx, SELECT … FOR UPDATE, fail-closed if status !== 'verfuegbar'. */
export async function reserveCopy(ctx: TenantCtx, purchaseId: number): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ status: purchases.status })
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .for('update');
    if (!row || row.status !== 'verfuegbar') {
      throw new ReservationConflictError(purchaseId, row?.status ?? null);
    }
    await tx
      .update(purchases)
      .set({ status: 'reserviert', updatedAt: new Date() })
      .where(eq(purchases.id, purchaseId));
  });
}

/** reserviert → verfuegbar. ONE withTenant tx, SELECT … FOR UPDATE, fail-closed if status !== 'reserviert'. */
export async function cancelReservation(ctx: TenantCtx, purchaseId: number): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ status: purchases.status })
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .for('update');
    if (!row || row.status !== 'reserviert') {
      throw new ReservationConflictError(purchaseId, row?.status ?? null);
    }
    await tx
      .update(purchases)
      .set({ status: 'verfuegbar', updatedAt: new Date() })
      .where(eq(purchases.id, purchaseId));
  });
}
