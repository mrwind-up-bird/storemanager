import 'server-only';
import { eq } from 'drizzle-orm';
import { withOwner } from '@/db/tenant';
import { plans, subscriptions, tenants, webhookEvents } from '@/db/schema';
import { upsertSubscriptionAndPlanTx } from './store';
import type { BillingEvent } from './types';

export type ApplyResult = 'applied' | 'duplicate' | 'ignored' | 'unknown_target';

/**
 * Webhook-Verarbeitung (Spec §9): Dedup-Insert + Effekt in EINER Owner-Transaktion.
 * Wirft die Tx (z. B. DB down) NACH dem Dedup-Insert, rollt der Insert mit zurück —
 * der Stripe-Retry läuft dann sauber erneut durch. Unbekannte Ziele (Customer/Subscription/
 * Tenant/Plan) sind KEIN Fehler: warn + 'unknown_target' → Route antwortet 200
 * (kein Retry-Sturm für verwaiste Test-Events, Spec §9.4).
 */
export async function processBillingEvent(event: BillingEvent): Promise<ApplyResult> {
  return withOwner(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ id: event.eventId, type: event.type })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return 'duplicate';

    switch (event.kind) {
      case 'checkout_completed': {
        const [tenant] = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.id, event.tenantId))
          .limit(1);
        if (!tenant) {
          console.warn(`[billing] checkout für unbekannten Tenant ${event.tenantId} — übersprungen (${event.eventId})`);
          return 'unknown_target';
        }
        const [plan] = await tx
          .select({ slug: plans.slug })
          .from(plans)
          .where(eq(plans.slug, event.planSlug))
          .limit(1);
        if (!plan) {
          console.warn(`[billing] checkout mit unbekanntem Plan "${event.planSlug}" — übersprungen (${event.eventId})`);
          return 'unknown_target';
        }
        await upsertSubscriptionAndPlanTx(tx, {
          tenantId: event.tenantId,
          planSlug: event.planSlug,
          customerId: event.customerId,
          subscriptionId: event.subscriptionId,
          status: 'active',
          currentPeriodEnd: null, // folgt mit dem ersten subscription_updated
          cancelAtPeriodEnd: false,
        });
        return 'applied';
      }

      case 'subscription_updated': {
        const [sub] = await tx
          .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, event.subscriptionId))
          .limit(1);
        if (!sub) {
          console.warn(`[billing] update für unbekannte Subscription ${event.subscriptionId} — übersprungen (${event.eventId})`);
          return 'unknown_target';
        }
        // priceId → plans.slug (Spec §7-Amendment: Auflösung HIER, nicht im Driver).
        let planSlug: string | null = null;
        if (event.priceId) {
          const [p] = await tx
            .select({ slug: plans.slug })
            .from(plans)
            .where(eq(plans.stripePriceId, event.priceId))
            .limit(1);
          planSlug = p?.slug ?? null;
          if (!planSlug) {
            console.warn(`[billing] unbekannte priceId ${event.priceId} — Zeile wird ohne Plan-Wechsel aktualisiert (${event.eventId})`);
          }
        }
        await tx
          .update(subscriptions)
          .set({
            status: event.status,
            currentPeriodEnd: event.currentPeriodEnd,
            cancelAtPeriodEnd: event.cancelAtPeriodEnd,
            ...(planSlug ? { planSlug } : {}),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));
        if (planSlug) {
          await tx
            .update(tenants)
            .set({ plan: planSlug, updatedAt: new Date() })
            .where(eq(tenants.id, sub.tenantId));
        }
        return 'applied';
      }

      case 'subscription_deleted': {
        const [sub] = await tx
          .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, event.subscriptionId))
          .limit(1);
        if (!sub) {
          console.warn(`[billing] delete für unbekannte Subscription ${event.subscriptionId} — übersprungen (${event.eventId})`);
          return 'unknown_target';
        }
        await tx.delete(subscriptions).where(eq(subscriptions.id, sub.id));
        await tx
          .update(tenants)
          .set({ plan: 'free', updatedAt: new Date() })
          .where(eq(tenants.id, sub.tenantId));
        return 'applied';
      }

      case 'ignored':
        return 'ignored';
    }
  });
}
