import 'server-only';
import { eq } from 'drizzle-orm';
import { withOwner, withTenant, type TenantCtx, type Tx } from '@/db/tenant';
import { plans, subscriptions, tenants } from '@/db/schema';

export type SubscriptionInfo = {
  planSlug: string;
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/** RLS-gebundene Leseansicht für den Abo-Tab (max. 1 Zeile pro Tenant — UNIQUE tenant_id). */
export async function getSubscriptionForTenant(ctx: TenantCtx): Promise<SubscriptionInfo | null> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select().from(subscriptions).limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      planSlug: r.planSlug,
      status: r.status,
      stripeCustomerId: r.stripeCustomerId,
      stripeSubscriptionId: r.stripeSubscriptionId,
      currentPeriodEnd: r.currentPeriodEnd,
      cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    };
  });
}

/** Server ist Preisautorität (Global Constraint 4): Price-Id kommt aus plans, nie vom Client. */
export async function getStripePriceId(planSlug: string): Promise<string | null> {
  return withOwner(async (tx) => {
    const rows = await tx
      .select({ stripePriceId: plans.stripePriceId })
      .from(plans)
      .where(eq(plans.slug, planSlug))
      .limit(1);
    return rows[0]?.stripePriceId ?? null;
  });
}

/** Für den Abo-Tab: Anzeigematrix aller Pläne (Integer-Cents). */
export async function listPlans(): Promise<{ slug: string; name: string; priceMonthlyCents: number }[]> {
  return withOwner((tx) =>
    tx
      .select({ slug: plans.slug, name: plans.name, priceMonthlyCents: plans.priceMonthlyCents })
      .from(plans)
      .orderBy(plans.priceMonthlyCents),
  );
}

export type UpsertSubscriptionArgs = {
  tenantId: number;
  planSlug: string;
  customerId: string;
  subscriptionId: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/**
 * Upsert der Abo-Zeile (Konfliktziel tenantId) + tenants.plan-Flip — INNERHALB der übergebenen
 * Owner-Tx (der Webhook-Handler teilt sich die Tx mit dem Dedup-Insert, T6).
 */
export async function upsertSubscriptionAndPlanTx(tx: Tx, args: UpsertSubscriptionArgs): Promise<void> {
  await tx
    .insert(subscriptions)
    .values({
      tenantId: args.tenantId,
      stripeCustomerId: args.customerId,
      stripeSubscriptionId: args.subscriptionId,
      planSlug: args.planSlug,
      status: args.status,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    })
    .onConflictDoUpdate({
      target: subscriptions.tenantId,
      set: {
        stripeCustomerId: args.customerId,
        stripeSubscriptionId: args.subscriptionId,
        planSlug: args.planSlug,
        status: args.status,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
        updatedAt: new Date(),
      },
    });
  await tx
    .update(tenants)
    .set({ plan: args.planSlug, updatedAt: new Date() })
    .where(eq(tenants.id, args.tenantId));
}

/** Eigenständige Owner-Tx-Variante — vom Fake-Checkout benutzt (Spec §7 Fake-Driver). */
export async function upsertSubscriptionAndPlan(args: UpsertSubscriptionArgs): Promise<void> {
  await withOwner((tx) => upsertSubscriptionAndPlanTx(tx, args));
}
