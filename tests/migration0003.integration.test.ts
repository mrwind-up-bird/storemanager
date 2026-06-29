import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

// Migration 0003 — copy-as-inventory. Boots a real PG17 via the Slice-0 harness, runs ALL
// migrations (0000..0003) AS qr_owner, then asserts the schema move + the CHECK + a live
// withTenant insert + the boot drift-guard. Env is published by setupTestDatabase BEFORE any
// @/db import, so @/db/client/@/db/tenant/@/db/assertions/@/db/schema are pulled in via dynamic
// import() strictly afterwards.

let dbh: TestDatabase;
let tenantId: number;
let recordId: number;

beforeAll(async () => {
  dbh = await setupTestDatabase();
  const seeded = await seedTenant({ slug: 'demo', name: 'Demo' });
  tenantId = seeded.tenantId;

  const { ownerPool } = await import('@/db/client');
  const rec = await ownerPool.query<{ id: number }>(
    `INSERT INTO records (tenant_id, title, artist, hash)
       VALUES ($1, 'Kind of Blue', 'Miles Davis', 'm0003-hash') RETURNING id`,
    [tenantId],
  );
  recordId = Number(rec.rows[0].id);
}, 180_000);

afterAll(async () => {
  await dbh.teardown();
});

describe('migration 0003 — records.record_status removed', () => {
  it('records no longer has a record_status column (status moved to the copy)', async () => {
    const pool = new Pool({ connectionString: dbh.ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'records'`,
      );
      const names = rows.map((r) => r.column_name);
      expect(names).not.toContain('record_status');
      // sanity: the catalog columns we keep are still present
      expect(names).toEqual(expect.arrayContaining(['title', 'artist', 'label', 'genre', 'hash']));
    } finally {
      await pool.end();
    }
  });
});

describe('migration 0003 — purchases is the inventory copy', () => {
  it('purchases has status (default verfuegbar) + condition_record/condition_cover smallints', async () => {
    const pool = new Pool({ connectionString: dbh.ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query<{ column_name: string; data_type: string; column_default: string | null }>(
        `SELECT column_name, data_type, column_default
           FROM information_schema.columns WHERE table_name = 'purchases'`,
      );
      const byName = new Map(rows.map((r) => [r.column_name, r]));

      const status = byName.get('status');
      expect(status, 'purchases.status exists').toBeDefined();
      expect(status?.column_default ?? '').toContain('verfuegbar');

      const condR = byName.get('condition_record');
      expect(condR, 'purchases.condition_record exists').toBeDefined();
      expect(condR?.data_type).toBe('smallint');

      const condC = byName.get('condition_cover');
      expect(condC, 'purchases.condition_cover exists').toBeDefined();
      expect(condC?.data_type).toBe('smallint');
    } finally {
      await pool.end();
    }
  });

  it('rejects a condition outside 0..7 via the CHECK constraint', async () => {
    const { ownerPool } = await import('@/db/client');
    await expect(
      ownerPool.query(
        `INSERT INTO purchases (tenant_id, record_id, status, condition_record)
           VALUES ($1, $2, 'verfuegbar', 8)`,
        [tenantId, recordId],
      ),
    ).rejects.toThrow(/purchases_condition_record_range/);
  });

  it('a withTenant insert of a copy with status + conditions succeeds and defaults status to verfuegbar', async () => {
    const { withTenant } = await import('@/db/tenant');
    const { purchases } = await import('@/db/schema');

    // explicit status + both conditions
    const explicit = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .insert(purchases)
        .values({ tenantId, recordId, status: 'verliehen', conditionRecord: 6, conditionCover: 5 })
        .returning({ id: purchases.id, status: purchases.status }),
    );
    expect(explicit).toHaveLength(1);
    expect(explicit[0]?.status).toBe('verliehen');

    // omitted status → DB default 'verfuegbar'
    const defaulted = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .insert(purchases)
        .values({ tenantId, recordId })
        .returning({ status: purchases.status }),
    );
    expect(defaulted[0]?.status).toBe('verfuegbar');
  });
});

describe('migration 0003 — boot safety holds (no new tenant table)', () => {
  it('assertDatabaseSafety still passes (RLS + tenant-table drift guard)', async () => {
    const { assertDatabaseSafety } = await import('@/db/assertions');
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });
});
