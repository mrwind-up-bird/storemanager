import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';
import { periodRange, berlinLocalYMD } from '@/lib/analytics-period';

let GET: (typeof import('@/app/(app)/analytik/export/route'))['GET'];
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let transactions: (typeof import('@/db/schema'))['transactions'];

let teardown: (() => Promise<void>) | undefined;
let tenantA = 0;
let tenantB = 0;
let adminUserId = 0;
let sessionRole: 'admin' | 'kunde' = 'admin';
let sessionTenantId = 0;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;

  vi.doMock('@/auth/session', () => ({
    requireSession: async () => ({
      id: adminUserId,
      email: 'staff@demo',
      tenantId: sessionTenantId,
      role: sessionRole,
      isSuperadmin: false,
    }),
  }));
  vi.doMock('next/navigation', () => ({
    forbidden: () => {
      throw new Error('FORBIDDEN');
    },
    redirect: (url: string) => {
      throw new Error(`REDIRECT:${url}`);
    },
  }));
  vi.resetModules();

  // Seed AFTER resetModules so seedTenant's ownerPool binds to the same @/db/client the teardown closes.
  const seedA = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantA = seedA.tenantId;
  adminUserId = seedA.adminUserId;
  sessionTenantId = tenantA;
  const seedB = await seedTenant({ slug: 'other', name: 'Other' });
  tenantB = seedB.tenantId;

  // Slice 6 T12: the export route now gates on entitlements (features.analytik). The seeded
  // tenant defaults to plan='free' (no analytik) — bump to 'big' so this file's CSV assertions
  // keep exercising the export path, not the feature gate.
  const { ownerPool } = await import('@/db/client');
  await ownerPool.query('UPDATE tenants SET plan = $1 WHERE id = $2', ['big', tenantA]);

  ({ withOwner } = await import('@/db/tenant'));
  ({ transactions } = await import('@/db/schema'));
  ({ GET } = await import('@/app/(app)/analytik/export/route'));

  // Seed one in-range (this week) transaction per tenant — tenantB's must NOT leak into tenantA's export.
  const now = new Date();
  await withOwner(async (tx) => {
    await tx.insert(transactions).values({
      tenantId: tenantA,
      soldByUserId: adminUserId,
      paymentMethod: 'bar',
      subtotal: '20.00',
      discount: '0',
      total: '20.00',
      createdAt: now,
    });
    await tx.insert(transactions).values({
      tenantId: tenantB,
      soldByUserId: seedB.adminUserId,
      paymentMethod: 'karte',
      subtotal: '999.00',
      discount: '0',
      total: '999.00',
      createdAt: now,
    });
  });
}, 120_000);

afterAll(async () => {
  if (teardown) await teardown();
});

afterEach(() => {
  sessionRole = 'admin';
  sessionTenantId = tenantA;
});

describe('GET /analytik/export', () => {
  it('kunde role is forbidden', async () => {
    sessionRole = 'kunde';
    await expect(
      GET(new Request('http://localhost/analytik/export?period=week')),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('FREE-plan tenant (no analytik feature) is blocked -> forbidden(), no CSV ever produced', async () => {
    // tenantB was seeded above and never bumped to 'big' — it stays on the default plan='free'
    // (features.analytik=false), so this exercises the feature gate itself, distinct from the
    // role gate above. Route must throw via forbidden() BEFORE touching withTenant/transactions.
    sessionTenantId = tenantB;
    await expect(
      GET(new Request('http://localhost/analytik/export?period=week')),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('staff: text/csv, attachment filename (Berlin-local date), header + tenant-scoped row (no other-tenant leak)', async () => {
    // Filename date must be `start`'s Berlin-LOCAL calendar date (not its UTC ISO date, which is
    // always the previous day since Berlin is never behind UTC) — compute the same way the route does.
    const { start } = periodRange('week', new Date());
    const { year, month, day } = berlinLocalYMD(start);
    const expectedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const res = await GET(new Request('http://localhost/analytik/export?period=week'));
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="analytik-week-${expectedDate}.csv"`,
    );

    const body = await res.text();
    const lines = body.trim().split('\n');
    expect(lines[0]).toBe('Datum;Bon-Nr;Zahlart;Zwischensumme;Rabatt;Summe');
    expect(body).toContain(';bar;20.00;0.00;20.00');
    expect(body).not.toContain('999.00');
  });
});
