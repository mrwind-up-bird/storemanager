// Slice 6 T5 — Fake-Driver-Parse (DB-Effekte des Fake-Checkouts testet tests/billing.integration.test.ts).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { BillingSignatureError } from '@/lib/billing/types';

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

let createFakeBillingAdapter: typeof import('@/lib/billing/fake')['createFakeBillingAdapter'];
let fakeCustomerId: typeof import('@/lib/billing/fake')['fakeCustomerId'];
let fakeSubscriptionId: typeof import('@/lib/billing/fake')['fakeSubscriptionId'];
let FAKE_SIGNATURE: typeof import('@/lib/billing/fake')['FAKE_SIGNATURE'];

beforeAll(async () => {
  for (const [k, v] of Object.entries(BASE_ENV)) {
    vi.stubEnv(k, v);
  }
  const module = await import('@/lib/billing/fake');
  createFakeBillingAdapter = module.createFakeBillingAdapter;
  fakeCustomerId = module.fakeCustomerId;
  fakeSubscriptionId = module.fakeSubscriptionId;
  FAKE_SIGNATURE = module.FAKE_SIGNATURE;
});

describe('fake billing adapter — parse/ids', () => {
  it('deterministische IDs', () => {
    expect(fakeCustomerId(42)).toBe('fake_cus_42');
    expect(fakeSubscriptionId(42)).toBe('fake_sub_42');
  });

  it('parseWebhookEvent akzeptiert nur Signatur "fake" und valide BillingEvent-JSON', () => {
    const adapter = createFakeBillingAdapter();
    const body = JSON.stringify({
      kind: 'subscription_updated', eventId: 'fake_evt_1', customerId: 'fake_cus_1',
      subscriptionId: 'fake_sub_1', status: 'active', priceId: null,
      currentPeriodEnd: '2026-08-01T00:00:00.000Z', cancelAtPeriodEnd: false,
    });
    expect(() => adapter.parseWebhookEvent(body, 'wrong')).toThrow(BillingSignatureError);
    expect(() => adapter.parseWebhookEvent('not json', FAKE_SIGNATURE)).toThrow(BillingSignatureError);
    expect(() => adapter.parseWebhookEvent('{"kind":"nope","eventId":"x"}', FAKE_SIGNATURE)).toThrow(BillingSignatureError);
    const parsed = adapter.parseWebhookEvent(body, FAKE_SIGNATURE);
    expect(parsed.kind).toBe('subscription_updated');
    expect(parsed.type).toBe('subscription_updated'); // type fällt auf kind zurück
    expect((parsed as { currentPeriodEnd: Date }).currentPeriodEnd).toBeInstanceOf(Date);
  });
});
