import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedTenant, setupTestDatabase } from './helpers/db';

/**
 * T1 deliverable gate: the Slice 3 DDL (0006) + hand-authored RLS (0007) applied to a real
 * PostgreSQL 17, proving for ALL five new tenant-scoped tables:
 *   - ENABLE + FORCE row security and BOTH named policies (tenant_isolation, superadmin_bypass);
 *   - the per-table SEQUENCE grant is LOAD-BEARING (Slice-0..2 lesson #7): revoke it → a qr_app
 *     INSERT fails closed; re-grant exactly as 0007 does → the INSERT succeeds (non-vacuous —
 *     the success is a real returned id, the failure a real "permission denied for sequence");
 *   - cross-tenant isolation (tenant A's quick_items row is invisible under withTenant(B));
 *   - the C2-hardened CHECK + UNIQUE constraints reached the DB (drizzle-kit generated them);
 *   - assertDatabaseSafety() passes against the migrated DB (TENANT_SCOPED_TABLES now 12).
 *
 * Deliberately reuses setupTestDatabase (which blanket-grants all sequences) and proves the
 * sequence grant's necessity via revoke→fail→regrant→succeed — the repo's established
 * mutate-and-restore idiom (see rls.integration.test.ts) — rather than a bespoke no-grant harness.
 */

let db: Awaited<ReturnType<typeof setupTestDatabase>>;
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let ownerPool: Pool;
let assertDatabaseSafety: (typeof import('@/db/assertions'))['assertDatabaseSafety'];

const NEW_TABLES = [
  'quick_items',
  'transactions',
  'transaction_items',
  'wishlists',
  'wishlist_matches',
] as const;

beforeAll(async () => {
  // setupTestDatabase publishes DATABASE_URL/DATABASE_OWNER_URL BEFORE we import @/db/*, so the
  // singleton pools bind to THIS container. Reset the module graph, then import dynamically.
  db = await setupTestDatabase();
  vi.resetModules();
  ({ withTenant } = await import('@/db/tenant'));
  ({ ownerPool } = await import('@/db/client'));
  ({ assertDatabaseSafety } = await import('@/db/assertions'));
}, 180_000);

afterAll(async () => {
  await db.teardown();
});

describe('Slice 3 migrations (0006 DDL + 0007 RLS)', () => {
  it('ENABLEs + FORCEs RLS and creates both named policies on every new table', async () => {
    for (const table of NEW_TABLES) {
      const flags = await ownerPool.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [table],
      );
      expect(flags.rows[0]?.relrowsecurity, `${table}.relrowsecurity`).toBe(true);
      expect(flags.rows[0]?.relforcerowsecurity, `${table}.relforcerowsecurity`).toBe(true);

      const policies = await ownerPool.query(
        `SELECT polname FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname`,
        [table],
      );
      expect(policies.rows.map((r) => r.polname)).toEqual(['superadmin_bypass', 'tenant_isolation']);
    }
  });

  it('carries the C2-hardened CHECK + UNIQUE constraints (drizzle-kit generated them)', async () => {
    const names = [
      'quick_items_price_nonneg',
      'transactions_discount_nonneg',
      'transactions_discount_le_subtotal',
      'transactions_total_consistent',
      'transactions_voucher_iff_gutschein',
      'transaction_items_quantity_positive',
      'transaction_items_kind_exclusive',
      'transaction_items_inventory_qty_one',
      'wishlist_matches_wishlist_purchase',
    ];
    const res = await ownerPool.query(`SELECT conname FROM pg_constraint WHERE conname = ANY($1)`, [
      names,
    ]);
    expect(res.rows.map((r) => r.conname as string).sort()).toEqual([...names].sort());
  });

  it('quick_items_id_seq GRANT is load-bearing (revoke → INSERT fails closed → regrant → succeeds)', async () => {
    const { tenantId } = await seedTenant({ slug: 'seqgrant', name: 'SeqGrant' });

    await ownerPool.query('REVOKE USAGE, SELECT ON SEQUENCE quick_items_id_seq FROM qr_app');
    try {
      await expect(
        withTenant({ tenantId, userId: null }, (tx) =>
          tx.execute(
            sql`insert into quick_items (tenant_id, name, price) values (${tenantId}, 'NoGrant', '1.00')`,
          ),
        ),
      ).rejects.toThrow(/sequence|permission/i);
    } finally {
      // Restore EXACTLY as 0007 grants it.
      await ownerPool.query('GRANT USAGE, SELECT ON SEQUENCE quick_items_id_seq TO qr_app');
    }

    const ok = await withTenant({ tenantId, userId: null }, (tx) =>
      tx.execute<{ id: number }>(
        sql`insert into quick_items (tenant_id, name, price) values (${tenantId}, 'Granted', '1.00') returning id`,
      ),
    );
    expect(Number(ok.rows[0]?.id)).toBeGreaterThan(0);
  });

  it('isolates quick_items across tenants (RLS tenant_isolation)', async () => {
    const a = await seedTenant({ slug: 'iso-a', name: 'Iso A' });
    const b = await seedTenant({ slug: 'iso-b', name: 'Iso B' });

    await withTenant({ tenantId: a.tenantId, userId: null }, (tx) =>
      tx.execute(
        sql`insert into quick_items (tenant_id, name, price) values (${a.tenantId}, 'A-coffee', '2.50')`,
      ),
    );

    const seenByB = await withTenant({ tenantId: b.tenantId, userId: null }, async (tx) => {
      const r = await tx.execute<{ name: string }>(sql`select name from quick_items`);
      return r.rows.map((row) => row.name);
    });
    expect(seenByB).not.toContain('A-coffee');

    const seenByA = await withTenant({ tenantId: a.tenantId, userId: null }, async (tx) => {
      const r = await tx.execute<{ name: string }>(sql`select name from quick_items`);
      return r.rows.map((row) => row.name);
    });
    expect(seenByA).toContain('A-coffee');
  });

  it('assertDatabaseSafety passes on the migrated database (12 tenant-scoped tables)', async () => {
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });
});
