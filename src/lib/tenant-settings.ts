import 'server-only';
import { eq } from 'drizzle-orm';
import { withOwner } from '@/db/tenant';
import { tenants } from '@/db/schema';

/**
 * Registry-Write (qr_owner): Shop-Name + Branding-Farbe. config wird gemerged —
 * logo bleibt erhalten. WCAG-Validierung (assertAccessibleAccent) macht der Aufrufer
 * VOR diesem Call (identisch zu provisionTenant).
 */
export async function updateTenantInfo(
  tenantId: number,
  input: { name: string; primaryColor: string },
): Promise<void> {
  await withOwner(async (tx) => {
    const [t] = await tx
      .select({ config: tenants.config })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!t) throw new Error(`updateTenantInfo: Tenant ${tenantId} nicht gefunden`);
    const config = (t.config ?? {}) as {
      branding?: { primaryColor?: string; logo?: string | null };
    };
    const nextConfig = {
      ...config,
      branding: { primaryColor: input.primaryColor, logo: config.branding?.logo ?? null },
    };
    await tx
      .update(tenants)
      .set({ name: input.name, config: nextConfig, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  });
}

/** Setzt den Wizard-Abschluss (auch „Überspringen" — der Wizard erscheint nie zweimal, Spec §11). */
export async function completeOnboarding(tenantId: number): Promise<void> {
  await withOwner((tx) =>
    tx
      .update(tenants)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId)),
  );
}
