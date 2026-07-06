// Slice 6 T5/T6 — Fake-Checkout (Sofort-Upsert, deterministische IDs), processBillingEvent
// (Dedup-Idempotenz, Statusübergänge completed→updated→deleted→free, unknown_target),
// Route (400 bei Signaturfehler, 200 sonst). Spec §14 Integration.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

let db: TestDatabase;
let owner: Pool;
let tenantId: number;

beforeAll(async () => {
  db = await setupTestDatabase();
  process.env.BILLING_DRIVER = 'fake';
  owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
  const t = await seedTenant({ slug: 'billing', name: 'Billing Shop' });
  tenantId = t.tenantId;
  await owner.query(`UPDATE plans SET stripe_price_id = 'price_small' WHERE slug = 'small'`);
  await owner.query(`UPDATE plans SET stripe_price_id = 'price_big' WHERE slug = 'big'`);
}, 180_000);

afterAll(async () => {
  await owner.end();
  await db.teardown();
});

async function tenantPlan(): Promise<string> {
  const r = await owner.query(`SELECT plan FROM tenants WHERE id = $1`, [tenantId]);
  return r.rows[0].plan as string;
}

describe('fake checkout', () => {
  it('createCheckoutSession upsertet Abo + flippt Plan sofort und liefert successUrl', async () => {
    const { createFakeBillingAdapter } = await import('@/lib/billing/fake');
    const adapter = createFakeBillingAdapter();
    const { url } = await adapter.createCheckoutSession({
      tenantId,
      planSlug: 'small',
      successUrl: 'http://x.localhost/einstellungen?tab=abo&checkout=success',
      cancelUrl: 'http://x.localhost/einstellungen?tab=abo',
    });
    expect(url).toBe('http://x.localhost/einstellungen?tab=abo&checkout=success');
    expect(await tenantPlan()).toBe('small');
    const sub = await owner.query(`SELECT * FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(sub.rows[0]).toMatchObject({
      stripe_customer_id: `fake_cus_${tenantId}`,
      stripe_subscription_id: `fake_sub_${tenantId}`,
      plan_slug: 'small',
      status: 'active',
    });
    // Zweiter Checkout (big) UPSERTET dieselbe Zeile (UNIQUE tenant_id):
    await adapter.createCheckoutSession({
      tenantId, planSlug: 'big', successUrl: 'http://x/s', cancelUrl: 'http://x/c',
    });
    const again = await owner.query(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(again.rows[0].n).toBe(1);
    expect(await tenantPlan()).toBe('big');
  });
});

describe('processBillingEvent', () => {
  it('Lebenszyklus completed → updated (Price-Auflösung) → deleted → plan free', async () => {
    const { processBillingEvent } = await import('@/lib/billing/apply');

    expect(
      await processBillingEvent({
        kind: 'checkout_completed', eventId: 'evt_1', type: 'checkout.session.completed',
        tenantId, planSlug: 'small', customerId: 'cus_w', subscriptionId: 'sub_w',
      }),
    ).toBe('applied');
    expect(await tenantPlan()).toBe('small');

    // Self-heal-Regression (Fix 2): eine kaputte/leere stripeCustomerId (z. B. aus einer
    // früheren Race) muss subscription_updated aus dem Event reparieren — sonst bleibt
    // openPortalAction dauerhaft mit customer: '' hängen.
    await owner.query(`UPDATE subscriptions SET stripe_customer_id = '' WHERE tenant_id = $1`, [tenantId]);

    expect(
      await processBillingEvent({
        kind: 'subscription_updated', eventId: 'evt_2', type: 'customer.subscription.updated',
        customerId: 'cus_w', subscriptionId: 'sub_w', status: 'active',
        priceId: 'price_big', currentPeriodEnd: new Date('2026-08-01T00:00:00Z'), cancelAtPeriodEnd: false,
      }),
    ).toBe('applied');
    expect(await tenantPlan()).toBe('big');
    const row = await owner.query(`SELECT plan_slug, current_period_end, stripe_customer_id FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(row.rows[0].plan_slug).toBe('big');
    expect(new Date(row.rows[0].current_period_end).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(row.rows[0].stripe_customer_id).toBe('cus_w');

    // Unbekannte priceId → Zeile aktualisiert, Plan bleibt:
    expect(
      await processBillingEvent({
        kind: 'subscription_updated', eventId: 'evt_3', type: 'customer.subscription.updated',
        customerId: 'cus_w', subscriptionId: 'sub_w', status: 'past_due',
        priceId: 'price_unknown', currentPeriodEnd: null, cancelAtPeriodEnd: true,
      }),
    ).toBe('applied');
    expect(await tenantPlan()).toBe('big');
    const st = await owner.query(`SELECT status, cancel_at_period_end FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(st.rows[0]).toMatchObject({ status: 'past_due', cancel_at_period_end: true });

    expect(
      await processBillingEvent({
        kind: 'subscription_deleted', eventId: 'evt_4', type: 'customer.subscription.deleted',
        customerId: 'cus_w', subscriptionId: 'sub_w',
      }),
    ).toBe('applied');
    expect(await tenantPlan()).toBe('free');
    const gone = await owner.query(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(gone.rows[0].n).toBe(0);
  });

  it('idempotent: gleiches Event zweimal → ein Effekt, zweiter Aufruf duplicate', async () => {
    const { processBillingEvent } = await import('@/lib/billing/apply');
    const event = {
      kind: 'checkout_completed' as const, eventId: 'evt_dup', type: 'checkout.session.completed',
      tenantId, planSlug: 'small', customerId: 'cus_d', subscriptionId: 'sub_d',
    };
    expect(await processBillingEvent(event)).toBe('applied');
    expect(await processBillingEvent(event)).toBe('duplicate');
    const n = await owner.query(`SELECT count(*)::int AS n FROM webhook_events WHERE id = 'evt_dup'`);
    expect(n.rows[0].n).toBe(1);
    // Aufräumen für Folge-Tests:
    await processBillingEvent({
      kind: 'subscription_deleted', eventId: 'evt_dup_del', type: 'customer.subscription.deleted',
      customerId: 'cus_d', subscriptionId: 'sub_d',
    });
  });

  it('unknown_target: unbekannte Subscription/Tenant → warn, kein Throw, Event bleibt dedupt', async () => {
    const { processBillingEvent } = await import('@/lib/billing/apply');
    expect(
      await processBillingEvent({
        kind: 'subscription_updated', eventId: 'evt_unknown', type: 'customer.subscription.updated',
        customerId: 'cus_x', subscriptionId: 'sub_niemals', status: 'active',
        priceId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      }),
    ).toBe('unknown_target');
    expect(
      await processBillingEvent({
        kind: 'checkout_completed', eventId: 'evt_ghost', type: 'checkout.session.completed',
        tenantId: 999_999, planSlug: 'small', customerId: 'cus_g', subscriptionId: 'sub_g',
      }),
    ).toBe('unknown_target');
  });

  it('ignored wird dedupt, hat aber keinen Effekt', async () => {
    const { processBillingEvent } = await import('@/lib/billing/apply');
    expect(
      await processBillingEvent({ kind: 'ignored', eventId: 'evt_ign', type: 'invoice.paid' }),
    ).toBe('ignored');
    const n = await owner.query(`SELECT type FROM webhook_events WHERE id = 'evt_ign'`);
    expect(n.rows[0].type).toBe('invoice.paid');
  });
});

describe('webhook route', () => {
  it('400 bei falscher Signatur, 200 {received:true} bei validem Fake-Event', async () => {
    const { POST } = await import('@/app/api/billing/webhook/route');
    const { NextRequest } = await import('next/server');

    const bad = await POST(
      new NextRequest('http://demo.localhost/api/billing/webhook', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'wrong' },
      }),
    );
    expect(bad.status).toBe(400);

    const ok = await POST(
      new NextRequest('http://demo.localhost/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ kind: 'ignored', eventId: 'evt_route_1', type: 'invoice.paid' }),
        headers: { 'stripe-signature': 'fake' },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: true });
  });
});
