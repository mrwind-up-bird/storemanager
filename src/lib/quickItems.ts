import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { quickItems } from '@/db/schema';

export type QuickItemRow = { id: number; name: string; price: string; active: boolean };

/** active quick_items for the tenant, ordered by name asc. */
export async function listActiveQuickItems(ctx: TenantCtx): Promise<QuickItemRow[]> {
  return withTenant(ctx, async (tx) =>
    tx
      .select({
        id: quickItems.id,
        name: quickItems.name,
        price: quickItems.price,
        active: quickItems.active,
      })
      .from(quickItems)
      .where(eq(quickItems.active, true))
      .orderBy(asc(quickItems.name)),
  );
}

export async function createQuickItem(
  ctx: TenantCtx,
  input: { name: string; price: string },
): Promise<{ id: number }> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(quickItems)
      .values({ tenantId: ctx.tenantId, name: input.name, price: input.price })
      .returning({ id: quickItems.id });
    return { id: row.id };
  });
}

export async function updateQuickItem(
  ctx: TenantCtx,
  id: number,
  input: { name?: string; price?: string; active?: boolean },
): Promise<void> {
  const patch: { name?: string; price?: string; active?: boolean } = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.price !== undefined) patch.price = input.price;
  if (input.active !== undefined) patch.active = input.active;
  if (Object.keys(patch).length === 0) return;
  await withTenant(ctx, async (tx) => {
    await tx.update(quickItems).set(patch).where(eq(quickItems.id, id));
  });
}

/** Soft-delete: sets active=false (never hard-deletes — transaction_items reference quick_items). */
export async function deactivateQuickItem(ctx: TenantCtx, id: number): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx.update(quickItems).set({ active: false }).where(eq(quickItems.id, id));
  });
}
