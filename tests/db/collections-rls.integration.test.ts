import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedTenant, setupTestDatabase } from '../helpers/db';

/**
 * RLS isolation proof for the Slice 4 `collections` table (batch-Ankauf), against a real
 * PostgreSQL 17 — same harness + ordering contract as tests/rls.integration.test.ts:
 * `setupTestDatabase()` publishes DATABASE_URL/DATABASE_OWNER_URL BEFORE any `@/db/*` module is
 * imported, so those modules are pulled in via dynamic `import()` only after env is live.
 *
 *   (a) tenant B cannot read tenant A's collection (and A CAN read its own — positive control,
 *       so the 0-rows-for-B assertion isn't vacuous).
 *   (b) an INSERT with tenant_id omitted defaults from the GUC to the acting tenant, and no row
 *       becomes visible to a different tenant.
 */

// Bound AFTER setupTestDatabase publishes env (see the harness ordering contract).
let db: Awaited<ReturnType<typeof setupTestDatabase>>;
let withTenant: (typeof import('@/db/tenant'))['withTenant'];

beforeAll(async () => {
  // setupTestDatabase sets process.env.{DATABASE_URL,DATABASE_OWNER_URL,...} BEFORE we import
  // the db modules, so env.ts/client.ts read the live testcontainer ports. Reset the module
  // graph first so the singleton pools bind to THIS run's env, then import.
  db = await setupTestDatabase();
  vi.resetModules();
  ({ withTenant } = await import('@/db/tenant'));
}, 120_000);

afterAll(async () => {
  await db.teardown();
});

/** Inserts one `collections` row for `tenantId` THROUGH withTenant — exercises the real insert
 *  path (RLS WITH CHECK + the GUC-derived tenant_id default). Returns the new row's id. */
async function seedCollection(tenantId: number, sellerName: string): Promise<number> {
  return withTenant({ tenantId, userId: null }, async (tx) => {
    const r = await tx.execute<{ id: number }>(
      sql`insert into collections (tenant_id, seller_name) values (${tenantId}, ${sellerName}) returning id`,
    );
    return r.rows[0]!.id;
  });
}

/** Reads all `collections` rows visible to a tenant via withTenant. */
async function readCollections(
  tenantId: number,
): Promise<{ id: number; tenant_id: number; seller_name: string }[]> {
  return withTenant({ tenantId, userId: null }, async (tx) => {
    const r = await tx.execute<{ id: number; tenant_id: number; seller_name: string }>(
      sql`select id, tenant_id, seller_name from collections`,
    );
    return r.rows;
  });
}

describe('collections RLS isolation', () => {
  it("a tenant cannot read another tenant's collection (positive control: A sees its own)", async () => {
    const a = await seedTenant({ slug: 'coll-a', name: 'Collection Tenant A' });
    const b = await seedTenant({ slug: 'coll-b', name: 'Collection Tenant B' });

    const collectionId = await seedCollection(a.tenantId, 'Seller A');

    // Positive control: tenant A can read its own collection (so the length-0 assertion below
    // for tenant B isn't vacuous — it proves RLS actually filters, not that nothing exists).
    const rowsFromA = await withTenant({ tenantId: a.tenantId, userId: null }, (tx) =>
      tx.execute(sql`select id from collections where id = ${collectionId}`),
    );
    expect(rowsFromA.rows).toHaveLength(1);

    const rowsFromB = await withTenant({ tenantId: b.tenantId, userId: null }, (tx) =>
      tx.execute(sql`select id from collections where id = ${collectionId}`),
    );
    expect(rowsFromB.rows).toHaveLength(0); // RLS hides it
  });

  it('an insert with tenant_id omitted defaults from the GUC, and no other tenant sees it', async () => {
    const a = await seedTenant({ slug: 'coll-c', name: 'Collection Tenant C' });
    const b = await seedTenant({ slug: 'coll-d', name: 'Collection Tenant D' });

    // tenant_id deliberately omitted from the column list → the ALTER COLUMN ... SET DEFAULT
    // NULLIF-GUC default resolves it from app.current_tenant, set by withTenant.
    const rows = await withTenant({ tenantId: a.tenantId, userId: null }, async (tx) => {
      await tx.execute(
        sql`insert into collections (seller_name) values (${'GUC default'})`,
      );
      const r = await tx.execute<{ id: number; tenant_id: number }>(
        sql`select id, tenant_id from collections where seller_name = ${'GUC default'}`,
      );
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenant_id).toBe(a.tenantId);

    // Cross-tenant write is impossible: tenant B never sees tenant A's GUC-defaulted row.
    const seenByB = await readCollections(b.tenantId);
    expect(seenByB.some((r) => r.seller_name === 'GUC default')).toBe(false);
  });
});
