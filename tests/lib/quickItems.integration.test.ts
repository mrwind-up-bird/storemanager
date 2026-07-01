import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from '../helpers/db';

let lib: typeof import('@/lib/quickItems');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  lib = await import('@/lib/quickItems');
  tenantA = (await seedTenant({ slug: 'qi-a', name: 'QI A' })).tenantId;
  tenantB = (await seedTenant({ slug: 'qi-b', name: 'QI B' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});

const ctxA = () => ({ tenantId: tenantA, userId: null });
const ctxB = () => ({ tenantId: tenantB, userId: null });

describe('quick_items catalog (C7)', () => {
  it('createQuickItem inserts and listActiveQuickItems round-trips the row', async () => {
    const { id } = await lib.createQuickItem(ctxA(), { name: 'Kaffee', price: '2.50' });
    expect(id).toBeTypeOf('number');
    const rows = await lib.listActiveQuickItems(ctxA());
    expect(rows.find((r) => r.id === id)).toEqual({
      id,
      name: 'Kaffee',
      price: '2.50',
      active: true,
    });
  });

  it('listActiveQuickItems orders by name ascending', async () => {
    await lib.createQuickItem(ctxA(), { name: 'Zzz-Sticker', price: '1.00' });
    await lib.createQuickItem(ctxA(), { name: 'Aaa-Beutel', price: '1.00' });
    const names = (await lib.listActiveQuickItems(ctxA())).map((r) => r.name);
    expect(names.indexOf('Aaa-Beutel')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Zzz-Sticker')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Aaa-Beutel')).toBeLessThan(names.indexOf('Zzz-Sticker'));
  });

  it('updateQuickItem applies a partial patch (name + price)', async () => {
    const { id } = await lib.createQuickItem(ctxA(), { name: 'Tee', price: '2.00' });
    await lib.updateQuickItem(ctxA(), id, { name: 'Bio-Tee', price: '2.80' });
    const rows = await lib.listActiveQuickItems(ctxA());
    expect(rows.find((r) => r.id === id)).toEqual({
      id,
      name: 'Bio-Tee',
      price: '2.80',
      active: true,
    });
  });

  it('deactivateQuickItem soft-deletes: hidden from list but row survives and can be re-activated', async () => {
    const { id } = await lib.createQuickItem(ctxA(), { name: 'Pin', price: '3.00' });
    await lib.deactivateQuickItem(ctxA(), id);
    const afterDeactivate = await lib.listActiveQuickItems(ctxA());
    expect(afterDeactivate.find((r) => r.id === id)).toBeUndefined();
    // Soft-delete (not hard-delete): re-activating proves the row still exists.
    await lib.updateQuickItem(ctxA(), id, { active: true });
    const afterReactivate = await lib.listActiveQuickItems(ctxA());
    expect(afterReactivate.find((r) => r.id === id)?.active).toBe(true);
  });

  it('RLS isolation: tenant B cannot see or mutate tenant A quick items', async () => {
    const { id } = await lib.createQuickItem(ctxA(), { name: 'GeheimA', price: '9.00' });
    // B cannot read A's row.
    const bRows = await lib.listActiveQuickItems(ctxB());
    expect(bRows.find((r) => r.id === id)).toBeUndefined();
    expect(bRows.find((r) => r.name === 'GeheimA')).toBeUndefined();
    // B's UPDATE/deactivate by A's id is a no-op under RLS — A's row is unchanged.
    await lib.updateQuickItem(ctxB(), id, { name: 'Hijacked', price: '0.01' });
    await lib.deactivateQuickItem(ctxB(), id);
    const aRows = await lib.listActiveQuickItems(ctxA());
    expect(aRows.find((r) => r.id === id)).toEqual({
      id,
      name: 'GeheimA',
      price: '9.00',
      active: true,
    });
  });
});
