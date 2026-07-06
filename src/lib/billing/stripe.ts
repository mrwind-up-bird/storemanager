import 'server-only';
import Stripe from 'stripe';
import { env } from '@/env';
import { getStripePriceId } from './store';
import {
  BillingConfigError,
  BillingSignatureError,
  type BillingAdapter,
  type BillingEvent,
} from './types';

let client: Stripe | null = null;
function stripeClient(): Stripe {
  if (!client) {
    if (!env.STRIPE_SECRET_KEY) throw new BillingConfigError('STRIPE_SECRET_KEY fehlt');
    // Ohne apiVersion-Pin: SDK nutzt die Account-Default-Version (Test-Mode, Spec §7).
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}

/**
 * Liest current_period_end versionstolerant: neuere Stripe-API-Versionen (Basil, 2025+)
 * tragen es auf dem Subscription-Item, ältere auf der Subscription selbst.
 */
function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const unix =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof unix === 'number' ? new Date(unix * 1000) : null;
}

function customerIdOf(customer: string | { id: string } | null): string {
  if (typeof customer === 'string') return customer;
  return customer?.id ?? '';
}

/** Pure Mapping Stripe.Event → BillingEvent (Spec §7) — exportiert für Unit-Tests. */
export function mapStripeEvent(event: Stripe.Event): BillingEvent {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      const tenantId = Number(s.metadata?.tenantId ?? s.client_reference_id);
      const planSlug = s.metadata?.planSlug ?? '';
      const subscriptionId =
        typeof s.subscription === 'string' ? s.subscription : (s.subscription?.id ?? '');
      if (!Number.isInteger(tenantId) || tenantId <= 0 || !planSlug || !subscriptionId) {
        // Checkout ohne unsere Metadata (fremd/handgeklickt) → nicht verarbeitbar, kein Fehler.
        console.warn(`[billing] checkout.session.completed ohne verwertbare Metadata — ignoriert (${event.id})`);
        return { kind: 'ignored', eventId: event.id, type: event.type };
      }
      return {
        kind: 'checkout_completed',
        eventId: event.id,
        type: event.type,
        tenantId,
        planSlug,
        customerId: customerIdOf(s.customer as string | { id: string } | null),
        subscriptionId,
      };
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      return {
        kind: 'subscription_updated',
        eventId: event.id,
        type: event.type,
        customerId: customerIdOf(sub.customer as string | { id: string }),
        subscriptionId: sub.id,
        status: sub.status,
        priceId: sub.items?.data?.[0]?.price?.id ?? null,
        currentPeriodEnd: subscriptionPeriodEnd(sub),
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      return {
        kind: 'subscription_deleted',
        eventId: event.id,
        type: event.type,
        customerId: customerIdOf(sub.customer as string | { id: string }),
        subscriptionId: sub.id,
      };
    }
    default:
      return { kind: 'ignored', eventId: event.id, type: event.type };
  }
}

export function createStripeBillingAdapter(): BillingAdapter {
  return {
    async createCheckoutSession({ tenantId, planSlug, successUrl, cancelUrl }) {
      const priceId = await getStripePriceId(planSlug);
      if (!priceId) throw new BillingConfigError(`Plan "${planSlug}" hat keine stripePriceId`);
      const session = await stripeClient().checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: String(tenantId),
        metadata: { tenantId: String(tenantId), planSlug },
        subscription_data: { metadata: { tenantId: String(tenantId) } },
      });
      if (!session.url) throw new BillingConfigError('Stripe Checkout-Session ohne URL');
      return { url: session.url };
    },

    async createPortalSession({ customerId, returnUrl }) {
      const session = await stripeClient().billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },

    parseWebhookEvent(rawBody, signature) {
      if (!env.STRIPE_WEBHOOK_SECRET) throw new BillingConfigError('STRIPE_WEBHOOK_SECRET fehlt');
      let event: Stripe.Event;
      try {
        event = stripeClient().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        throw new BillingSignatureError(err instanceof Error ? err.message : 'invalid signature');
      }
      return mapStripeEvent(event);
    },
  };
}
