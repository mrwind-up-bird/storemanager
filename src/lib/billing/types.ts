// Billing-Adapter-Schnittstelle (Spec §7, Spiegel des Discogs-Musters).
// Bewusst OHNE DB-Zugriff in den Typen: subscription_updated trägt die rohe priceId —
// die Rückauflösung priceId → plans.slug macht der Apply-Handler (src/lib/billing/apply.ts),
// damit die Driver rein bleiben (Spec-Amendment zu §7).

export interface BillingAdapter {
  createCheckoutSession(args: {
    tenantId: number;
    planSlug: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(args: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Wirft BillingSignatureError bei ungültiger Signatur (Spec §9.1). */
  parseWebhookEvent(rawBody: string, signature: string): BillingEvent;
}

/** `type` = roher Provider-Event-Typ (Stripe event.type; Fake: identisch zu kind) → webhook_events.type. */
export type BillingEvent =
  | {
      kind: 'checkout_completed';
      eventId: string;
      type: string;
      tenantId: number;
      planSlug: string;
      customerId: string;
      subscriptionId: string;
    }
  | {
      kind: 'subscription_updated';
      eventId: string;
      type: string;
      customerId: string;
      subscriptionId: string;
      status: string;
      priceId: string | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | {
      kind: 'subscription_deleted';
      eventId: string;
      type: string;
      customerId: string;
      subscriptionId: string;
    }
  | { kind: 'ignored'; eventId: string; type: string };

export class BillingSignatureError extends Error {}
/** Konfigurationsfehler (fehlender Key / fehlende stripePriceId) — 500er-Klasse, kein User-Fehler. */
export class BillingConfigError extends Error {}

/** Deutsche Labels für den rohen Stripe-Status (UI darf den Enum-Wert nicht roh anzeigen, Constraint 10). */
export const SUB_STATUS_DE: Record<string, string> = {
  active: 'aktiv',
  past_due: 'überfällig',
  canceled: 'gekündigt',
  incomplete: 'unvollständig',
  incomplete_expired: 'abgelaufen',
  trialing: 'Testphase',
  unpaid: 'unbezahlt',
  paused: 'pausiert',
};
