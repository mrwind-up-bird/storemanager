// Slice 6 T5 — mapStripeEvent (Spec §14): aufgezeichnete Test-Payload-Formen → BillingEvent,
// fehlende Metadata → ignored, unbekannte Typen → ignored, Basil-Item-PeriodEnd.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type Stripe from 'stripe';

const BASE_ENV: Record<string, string> = {
  ROOT_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://qr_app:x@localhost:5432/db',
  DATABASE_OWNER_URL: 'postgresql://qr_owner:x@localhost:5432/db',
  PGBOSS_DATABASE_URL: 'postgresql://qr_owner:x@localhost:5432/db',
  AUTH_SECRET: 's',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ENCRYPTION_KEY_ID: 'v1',
  MAIL_DRIVER: 'console',
  MAIL_HOST: 'localhost',
  MAIL_PORT: '1025',
  MAIL_FROM: 'noreply@localhost',
  DISCOGS_CONSUMER_KEY: 'k',
  DISCOGS_CONSUMER_SECRET: 's',
  BILLING_DRIVER: 'fake',
};

let mapStripeEvent: typeof import('@/lib/billing/stripe')['mapStripeEvent'];

beforeAll(async () => {
  for (const [k, v] of Object.entries(BASE_ENV)) {
    vi.stubEnv(k, v);
  }
  const module = await import('@/lib/billing/stripe');
  mapStripeEvent = module.mapStripeEvent;
});

function ev(type: string, object: unknown, id = 'evt_test_1'): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

describe('mapStripeEvent', () => {
  it('checkout.session.completed mit Metadata → checkout_completed', () => {
    const e = mapStripeEvent(
      ev('checkout.session.completed', {
        customer: 'cus_123',
        subscription: 'sub_123',
        client_reference_id: '7',
        metadata: { tenantId: '7', planSlug: 'small' },
      }),
    );
    expect(e).toEqual({
      kind: 'checkout_completed',
      eventId: 'evt_test_1',
      type: 'checkout.session.completed',
      tenantId: 7,
      planSlug: 'small',
      customerId: 'cus_123',
      subscriptionId: 'sub_123',
    });
  });

  it('checkout ohne Metadata → ignored (kein Throw)', () => {
    const e = mapStripeEvent(
      ev('checkout.session.completed', { customer: 'cus_x', subscription: 'sub_x', metadata: {} }),
    );
    expect(e.kind).toBe('ignored');
  });

  it('customer.subscription.updated → priceId + Item-PeriodEnd (Basil) + cancelAtPeriodEnd', () => {
    const e = mapStripeEvent(
      ev('customer.subscription.updated', {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        cancel_at_period_end: true,
        items: { data: [{ price: { id: 'price_small' }, current_period_end: 1_790_000_000 }] },
      }),
    );
    expect(e).toMatchObject({
      kind: 'subscription_updated',
      subscriptionId: 'sub_123',
      customerId: 'cus_123',
      status: 'active',
      priceId: 'price_small',
      cancelAtPeriodEnd: true,
    });
    expect((e as { currentPeriodEnd: Date }).currentPeriodEnd.getTime()).toBe(1_790_000_000_000);
  });

  it('updated ohne Item-PeriodEnd fällt auf Subscription-Level zurück; ohne Price → priceId null', () => {
    const e = mapStripeEvent(
      ev('customer.subscription.updated', {
        id: 'sub_9',
        customer: { id: 'cus_9' },
        status: 'past_due',
        cancel_at_period_end: false,
        current_period_end: 1_790_000_000,
        items: { data: [] },
      }),
    );
    expect(e).toMatchObject({ priceId: null, customerId: 'cus_9', status: 'past_due' });
    expect((e as { currentPeriodEnd: Date }).currentPeriodEnd.getTime()).toBe(1_790_000_000_000);
  });

  it('customer.subscription.deleted → subscription_deleted', () => {
    const e = mapStripeEvent(
      ev('customer.subscription.deleted', { id: 'sub_del', customer: 'cus_del' }),
    );
    expect(e).toEqual({
      kind: 'subscription_deleted',
      eventId: 'evt_test_1',
      type: 'customer.subscription.deleted',
      customerId: 'cus_del',
      subscriptionId: 'sub_del',
    });
  });

  it('unbekannter Event-Typ → ignored', () => {
    expect(mapStripeEvent(ev('invoice.paid', {})).kind).toBe('ignored');
  });
});
