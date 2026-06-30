import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let performSale: (typeof import('@/lib/performSale'))['performSale'];
let SaleConflictError: (typeof import('@/lib/performSale'))['SaleConflictError'];
let SalePriceMissingError: (typeof import('@/lib/performSale'))['SalePriceMissingError'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let adminId: number;

const ctx = () => ({ tenantId: tenantA, userId: adminId });

let counter = 0;

/** Seed a record + a physical copy for tenantA via withTenant. Returns ids + the record title. */
async function seedCopy(opts: {
  targetPrice: string | null;
  status?: 'verfuegbar' | 'reserviert' | 'verkauft' | 'verliehen';
  title?: string;
}): Promise<{ purchaseId: number; recordId: number; title: string }> {
  const n = ++counter;
  const title = opts.title ?? `Album ${n}`;
  return withTenant(ctx(), async (tx) => {
    const [rec] = await tx
      .insert(schema.records)
      .values({
        tenantId: tenantA,
        title,
        artist: `Artist ${n}`,
        label: ['Label'],
        country: 'US',
        releaseYear: 2000,
        hash: `seed-hash-${n}`,
      })
      .returning({ id: schema.records.id });
    const [pur] = await tx
      .insert(schema.purchases)
      .values({
        tenantId: tenantA,
        recordId: rec!.id,
        purchasePrice: '5.00',
        targetPrice: opts.targetPrice,
        conditionRecord: 5,
        conditionCover: 4,
        status: opts.status ?? 'verfuegbar',
      })
      .returning({ id: schema.purchases.id });
    return { purchaseId: pur!.id, recordId: rec!.id, title };
  });
}

async function seedQuickItem(opts: { name: string; price: string; active?: boolean }): Promise<number> {
  return withTenant(ctx(), async (tx) => {
    const [row] = await tx
      .insert(schema.quickItems)
      .values({ tenantId: tenantA, name: opts.name, price: opts.price, active: opts.active ?? true })
      .returning({ id: schema.quickItems.id });
    return row!.id;
  });
}

const getPurchase = (purchaseId: number) =>
  withTenant(ctx(), (tx) =>
    tx.select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId)),
  ).then((r) => r[0]);

const getTransaction = (transactionId: number) =>
  withTenant(ctx(), (tx) =>
    tx.select().from(schema.transactions).where(eq(schema.transactions.id, transactionId)),
  ).then((r) => r[0]);

const itemsForTransaction = (transactionId: number) =>
  withTenant(ctx(), (tx) =>
    tx
      .select()
      .from(schema.transactionItems)
      .where(eq(schema.transactionItems.transactionId, transactionId)),
  );

/** Stable, test-isolated side-effect probe: how many transaction_items reference this copy. */
const itemsForPurchase = (purchaseId: number) =>
  withTenant(ctx(), (tx) =>
    tx
      .select()
      .from(schema.transactionItems)
      .where(eq(schema.transactionItems.purchaseId, purchaseId)),
  );

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  ({ performSale, SaleConflictError, SalePriceMissingError } = await import('@/lib/performSale'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  const seeded = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantA = seeded.tenantId;
  adminId = seeded.adminUserId;
}, 180_000);

afterAll(async () => {
  if (teardown) await teardown();
});

describe('performSale — happy paths', () => {
  it('sells one inventory copy: flips status, writes head + item, stamps copy snapshot, total from DB price', async () => {
    const copy = await seedCopy({ targetPrice: '22.50' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'bar',
      discount: null,
    });
    expect(res.transactionId).toBeTypeOf('number');
    expect(res.total).toBe('22.50');

    const head = await getTransaction(res.transactionId);
    expect(head.paymentMethod).toBe('bar');
    expect(head.subtotal).toBe('22.50');
    expect(head.discount).toBe('0.00');
    expect(head.total).toBe('22.50');
    expect(head.voucherCode).toBeNull();
    expect(head.soldByUserId).toBe(adminId);

    const items = await itemsForTransaction(res.transactionId);
    expect(items).toHaveLength(1);
    expect(items[0].purchaseId).toBe(copy.purchaseId);
    expect(items[0].quickItemId).toBeNull();
    expect(items[0].label).toBe(copy.title); // server snapshot of the RECORD title, not a client value
    expect(items[0].unitPrice).toBe('22.50');
    expect(items[0].quantity).toBe(1);

    const pur = await getPurchase(copy.purchaseId);
    expect(pur.status).toBe('verkauft');
    expect(pur.soldPrice).toBe('22.50');
    expect(pur.soldDate).toBeInstanceOf(Date);
    expect(pur.paymentMethod).toBe('bar');
  });

  it('sells a reserviert copy (reserviert → verkauft)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00', status: 'reserviert' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'karte',
      discount: null,
    });
    expect(res.total).toBe('10.00');
    expect((await getPurchase(copy.purchaseId)).status).toBe('verkauft');
  });

  it('resolves quick-item price from the catalog (client sends only quantity)', async () => {
    const quickId = await seedQuickItem({ name: 'Kaffee', price: '2.50' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'quick', quickItemId: quickId, quantity: 2 }],
      payment: 'bar',
      discount: null,
    });
    expect(res.total).toBe('5.00');
    const items = await itemsForTransaction(res.transactionId);
    expect(items).toHaveLength(1);
    expect(items[0].quickItemId).toBe(quickId);
    expect(items[0].purchaseId).toBeNull();
    expect(items[0].label).toBe('Kaffee');
    expect(items[0].unitPrice).toBe('2.50'); // catalog price, NOT client-supplied
    expect(items[0].quantity).toBe(2);
  });

  it('records an ad-hoc line with the client price (ad-hoc only)', async () => {
    const res = await performSale(ctx(), {
      lines: [{ kind: 'adhoc', label: 'Poster', unitPrice: '3.50', quantity: 2 }],
      payment: 'bar',
      discount: null,
    });
    expect(res.total).toBe('7.00');
    const items = await itemsForTransaction(res.transactionId);
    expect(items[0].purchaseId).toBeNull();
    expect(items[0].quickItemId).toBeNull();
    expect(items[0].label).toBe('Poster');
    expect(items[0].unitPrice).toBe('3.50');
    expect(items[0].quantity).toBe(2);
  });

  it('server-recomputes a mixed cart total with an amount discount from DB/catalog prices', async () => {
    const copy = await seedCopy({ targetPrice: '20.00' });
    const quickId = await seedQuickItem({ name: 'Sticker', price: '2.50' });
    const res = await performSale(ctx(), {
      lines: [
        { kind: 'inventory', purchaseId: copy.purchaseId },
        { kind: 'quick', quickItemId: quickId, quantity: 2 }, // 5.00
        { kind: 'adhoc', label: 'Tüte', unitPrice: '3.50', quantity: 1 }, // 3.50
      ],
      payment: 'bar',
      discount: { kind: 'amount', value: '0.50' },
    });
    const head = await getTransaction(res.transactionId);
    expect(head.subtotal).toBe('28.50'); // 20.00 + 5.00 + 3.50 — inventory/quick from server, not client
    expect(head.discount).toBe('0.50');
    expect(head.total).toBe('28.00');
    expect(res.total).toBe('28.00');
    expect(await itemsForTransaction(res.transactionId)).toHaveLength(3);
  });

  it('server-recomputes a percent discount (10% of 20.00 = 2.00)', async () => {
    const copy = await seedCopy({ targetPrice: '20.00' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'bar',
      discount: { kind: 'percent', value: 10 },
    });
    const head = await getTransaction(res.transactionId);
    expect(head.subtotal).toBe('20.00');
    expect(head.discount).toBe('2.00');
    expect(head.total).toBe('18.00');
  });

  it('stores the voucher code for a gutschein payment', async () => {
    const copy = await seedCopy({ targetPrice: '12.00' });
    const res = await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'gutschein',
      discount: null,
      voucherCode: 'XMAS10',
    });
    const head = await getTransaction(res.transactionId);
    expect(head.paymentMethod).toBe('gutschein');
    expect(head.voucherCode).toBe('XMAS10');
    expect((await getPurchase(copy.purchaseId)).paymentMethod).toBe('gutschein');
  });
});

describe('performSale — fail-closed guards', () => {
  it('rejects a double-sell and writes NO second item row (FOR UPDATE + status guard)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00' });
    await performSale(ctx(), {
      lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
      payment: 'bar',
      discount: null,
    });
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(1);

    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toBeInstanceOf(SaleConflictError);

    // Non-vacuous: the second (failed) sale produced no new transaction_item for this copy.
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(1);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verkauft');
  });

  it('rejects selling a verliehen copy (status ∉ {verfuegbar,reserviert})', async () => {
    const copy = await seedCopy({ targetPrice: '10.00', status: 'verliehen' });
    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toBeInstanceOf(SaleConflictError);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verliehen');
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(0);
  });

  it('rejects a null-targetPrice inventory copy (no €0.00 sale; tx rolls back, status unchanged)', async () => {
    const copy = await seedCopy({ targetPrice: null });
    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toBeInstanceOf(SalePriceMissingError);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verfuegbar'); // rolled back
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(0);
  });

  it('rejects a duplicate inventory purchaseId in one cart (no side effects)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00' });
    await expect(
      performSale(ctx(), {
        lines: [
          { kind: 'inventory', purchaseId: copy.purchaseId },
          { kind: 'inventory', purchaseId: copy.purchaseId },
        ],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toThrow(/duplicate inventory purchaseId in cart/);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verfuegbar');
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(0);
  });

  it('rejects gutschein with no voucher code (no side effects)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00' });
    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
        payment: 'gutschein',
        discount: null,
      }),
    ).rejects.toThrow(/voucherCode required for gutschein/);
    expect((await getPurchase(copy.purchaseId)).status).toBe('verfuegbar');
    expect(await itemsForPurchase(copy.purchaseId)).toHaveLength(0);
  });

  it('rejects an inactive/missing quick item', async () => {
    const quickId = await seedQuickItem({ name: 'Alt', price: '1.00', active: false });
    await expect(
      performSale(ctx(), {
        lines: [{ kind: 'quick', quickItemId: quickId, quantity: 1 }],
        payment: 'bar',
        discount: null,
      }),
    ).rejects.toThrow(/missing or inactive/);
  });

  it('rejects when ctx.userId is null (soldByUserId is NOT NULL)', async () => {
    const copy = await seedCopy({ targetPrice: '10.00' });
    await expect(
      performSale(
        { tenantId: tenantA, userId: null },
        {
          lines: [{ kind: 'inventory', purchaseId: copy.purchaseId }],
          payment: 'bar',
          discount: null,
        },
      ),
    ).rejects.toThrow(/userId is required/);
  });
});
