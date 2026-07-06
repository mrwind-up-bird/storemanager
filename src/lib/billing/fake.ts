import 'server-only';
import { upsertSubscriptionAndPlan } from './store';
import { BillingSignatureError, type BillingAdapter, type BillingEvent } from './types';

export const FAKE_SIGNATURE = 'fake';
export function fakeCustomerId(tenantId: number): string {
  return `fake_cus_${tenantId}`;
}
export function fakeSubscriptionId(tenantId: number): string {
  return `fake_sub_${tenantId}`;
}

const VALID_KINDS = new Set(['checkout_completed', 'subscription_updated', 'subscription_deleted', 'ignored']);

export function createFakeBillingAdapter(): BillingAdapter {
  return {
    async createCheckoutSession({ tenantId, planSlug, successUrl }) {
      // Fake-Checkout schließt SOFORT ab (Spec §7): Upsert + Plan-Flip im Owner-Kontext mit
      // deterministischen IDs, dann direkt zurück zur successUrl — der komplette
      // Upgrade-Flow ist ohne Stripe-Keys E2E-testbar.
      await upsertSubscriptionAndPlan({
        tenantId,
        planSlug,
        customerId: fakeCustomerId(tenantId),
        subscriptionId: fakeSubscriptionId(tenantId),
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
      });
      return { url: successUrl };
    },

    async createPortalSession({ returnUrl }) {
      return { url: returnUrl };
    },

    parseWebhookEvent(rawBody, signature) {
      // Für Integrationstests des Webhook-Handlers (Spec §7): Body = BillingEvent-JSON,
      // Signatur muss exakt 'fake' sein; currentPeriodEnd wird aus ISO-String revived.
      if (signature !== FAKE_SIGNATURE) throw new BillingSignatureError('invalid fake signature');
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        throw new BillingSignatureError('fake webhook body is not JSON');
      }
      if (typeof raw.kind !== 'string' || !VALID_KINDS.has(raw.kind) || typeof raw.eventId !== 'string') {
        throw new BillingSignatureError('fake webhook body is not a BillingEvent');
      }
      if (typeof raw.type !== 'string') raw.type = raw.kind;
      if (typeof raw.currentPeriodEnd === 'string') raw.currentPeriodEnd = new Date(raw.currentPeriodEnd);
      return raw as unknown as BillingEvent;
    },
  };
}
