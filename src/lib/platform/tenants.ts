import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { withSuperadmin } from '@/db/tenant';
import { subscriptions, tenants, users } from '@/db/schema';
import { DEFAULT_PRIMARY_COLOR } from '@/lib/branding';

export type TenantListRow = {
  id: number;
  slug: string;
  name: string;
  plan: string;
  recordCount: number;
  userCount: number;
  createdAt: Date | null;
};

/** Aggregatzahlen only — kein Kunden-PII in der Platform-Zone (Global Constraint 8). */
export async function listTenantsWithStats(): Promise<TenantListRow[]> {
  return withSuperadmin((tx) =>
    tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        plan: tenants.plan,
        createdAt: tenants.createdAt,
        recordCount: sql<number>`(SELECT count(*) FROM records r WHERE r.tenant_id = tenants.id)::int`,
        userCount: sql<number>`(SELECT count(*) FROM users u WHERE u.tenant_id = tenants.id)::int`,
      })
      .from(tenants)
      .orderBy(tenants.slug),
  );
}

export type TenantDetail = {
  id: number;
  slug: string;
  name: string;
  plan: string;
  createdAt: Date | null;
  primaryColor: string;
  onboardingCompletedAt: Date | null;
  adminEmail: string | null;
  subscription: {
    planSlug: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  } | null;
};

export async function getTenantDetail(id: number): Promise<TenantDetail | null> {
  return withSuperadmin(async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!t) return null;
    const [admin] = await tx
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, id), eq(users.role, 'admin')))
      .orderBy(users.id)
      .limit(1);
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, id)).limit(1);
    const config = (t.config ?? {}) as { branding?: { primaryColor?: string } };
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      plan: t.plan,
      createdAt: t.createdAt,
      primaryColor: config.branding?.primaryColor ?? DEFAULT_PRIMARY_COLOR,
      onboardingCompletedAt: t.onboardingCompletedAt ?? null,
      adminEmail: admin?.email ?? null,
      subscription: sub
        ? {
            planSlug: sub.planSlug,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            stripeCustomerId: sub.stripeCustomerId,
            stripeSubscriptionId: sub.stripeSubscriptionId,
          }
        : null,
    };
  });
}
