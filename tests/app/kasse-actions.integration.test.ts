import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let actions: typeof import('@/app/(app)/kasse/actions');
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let records: (typeof import('@/db/schema'))['records'];
let purchases: (typeof import('@/db/schema'))['purchases'];

let teardown: (() => Promise<void>) | undefined;
let tenantA = 0;
let adminUserId = 0;
let sessionRole: 'admin' | 'kunde' = 'admin';
let badOrigin = false;

async function insertCopy(
  opts: { status?: 'verfuegbar' | 'reserviert' | 'verkauft'; vk?: string } = {},
): Promise<number> {
  return withOwner(async (tx) => {
    const [rec] = await tx
      .insert(records)
      .values({
        tenantId: tenantA,
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        label: ['Columbia'],
        format: 'Vinyl',
        genre: ['Jazz'],
        releaseYear: 1959,
        country: 'US',
        hash: `h-${Math.random().toString(36).slice(2)}`,
      })
      .returning({ id: records.id });
    const [pur] = await tx
      .insert(purchases)
      .values({
        tenantId: tenantA,
        recordId: rec.id,
        status: opts.status ?? 'verfuegbar',
        conditionRecord: 7,
        conditionCover: 7,
        purchasePrice: '10.00',
        targetPrice: opts.vk ?? '20.00',
      })
      .returning({ id: purchases.id });
    return pur.id;
  });
}

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;

  vi.doMock('@/auth/session', () => ({
    requireSession: async () => ({
      id: adminUserId,
      email: 'staff@demo',
      tenantId: tenantA,
      role: sessionRole,
      isSuperadmin: false,
    }),
  }));
  vi.doMock('next/headers', () => ({
    headers: async () =>
      new Headers(badOrigin ? { origin: 'http://evil.example', host: 'localhost:3000' } : {}),
    cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  }));
  vi.doMock('next/navigation', () => ({
    forbidden: () => {
      throw new Error('FORBIDDEN');
    },
    redirect: (url: string) => {
      throw new Error(`REDIRECT:${url}`);
    },
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.resetModules();

  // Seed AFTER resetModules so seedTenant's ownerPool binds to the same @/db/client the teardown closes.
  const seed = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantA = seed.tenantId;
  adminUserId = seed.adminUserId;
  ({ withOwner } = await import('@/db/tenant'));
  ({ records, purchases } = await import('@/db/schema'));
  actions = await import('@/app/(app)/kasse/actions');
});

afterAll(async () => {
  if (teardown) await teardown();
});

afterEach(() => {
  sessionRole = 'admin';
  badOrigin = false;
});

describe('kasse actions', () => {
  it('createSale: kunde role is forbidden', async () => {
    sessionRole = 'kunde';
    const pid = await insertCopy();
    await expect(
      actions.createSale({
        lines: [{ kind: 'inventory', purchaseId: pid }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('createSale: invalid origin → reason error', async () => {
    badOrigin = true;
    const pid = await insertCopy();
    const r = await actions.createSale({
      lines: [{ kind: 'inventory', purchaseId: pid }],
      payment: 'bar',
      discount: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'error' });
  });

  it('createSale: empty cart → reason validation', async () => {
    const r = await actions.createSale({ lines: [], payment: 'bar', discount: null });
    expect(r).toMatchObject({ ok: false, reason: 'validation' });
  });

  it('createSale: inventory copy → ok, status verkauft, transaction + item rows written', async () => {
    const pid = await insertCopy({ vk: '20.00' });
    const r = await actions.createSale({
      lines: [{ kind: 'inventory', purchaseId: pid }],
      payment: 'bar',
      discount: null,
    });
    expect(r).toMatchObject({ ok: true, total: '20.00' });
    if (!r.ok) throw new Error('expected ok');
    const { ownerPool } = await import('@/db/client');
    const status = await ownerPool.query('SELECT status FROM purchases WHERE id = $1', [pid]);
    expect(status.rows[0].status).toBe('verkauft');
    const items = await ownerPool.query(
      'SELECT purchase_id, unit_price FROM transaction_items WHERE transaction_id = $1',
      [r.transactionId],
    );
    expect(items.rows).toHaveLength(1);
    expect(items.rows[0].purchase_id).toBe(pid);
    expect(items.rows[0].unit_price).toBe('20.00');
  });

  it('createSale: already-sold copy → reason conflict (no double-sell)', async () => {
    const pid = await insertCopy({ status: 'verkauft' });
    const r = await actions.createSale({
      lines: [{ kind: 'inventory', purchaseId: pid }],
      payment: 'bar',
      discount: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('reserve then cancelReservation flips status verfuegbar↔reserviert', async () => {
    const pid = await insertCopy();
    const { ownerPool } = await import('@/db/client');
    const r1 = await actions.reserve({ purchaseId: pid });
    expect(r1).toEqual({ ok: true });
    let s = await ownerPool.query('SELECT status FROM purchases WHERE id = $1', [pid]);
    expect(s.rows[0].status).toBe('reserviert');
    const r2 = await actions.cancelReservation({ purchaseId: pid });
    expect(r2).toEqual({ ok: true });
    s = await ownerPool.query('SELECT status FROM purchases WHERE id = $1', [pid]);
    expect(s.rows[0].status).toBe('verfuegbar');
  });

  it('quick-item CRUD: create → update → deactivate', async () => {
    const { ownerPool } = await import('@/db/client');
    const created = await actions.createQuickItem({ name: 'Kaffee', price: '2.50' });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('expected ok');
    let q = await ownerPool.query('SELECT name, price, active FROM quick_items WHERE id = $1', [created.id]);
    expect(q.rows[0]).toMatchObject({ name: 'Kaffee', price: '2.50', active: true });
    const upd = await actions.updateQuickItem({ id: created.id, price: '3.00' });
    expect(upd).toEqual({ ok: true });
    q = await ownerPool.query('SELECT price FROM quick_items WHERE id = $1', [created.id]);
    expect(q.rows[0].price).toBe('3.00');
    const deact = await actions.deactivateQuickItem({ id: created.id });
    expect(deact).toEqual({ ok: true });
    q = await ownerPool.query('SELECT active FROM quick_items WHERE id = $1', [created.id]);
    expect(q.rows[0].active).toBe(false);
  });
});
