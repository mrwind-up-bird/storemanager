// tests/seed.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant } from './helpers/db';
import type { TestDatabase } from './helpers/db';

let testDb: TestDatabase;
let ownerPool: Pool;

async function getInventoryCounts(pool: Pool, tenantId: number) {
  const r = await pool.query<{
    records: string;
    copies: string;
    available: string;
    permalinks: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM records   WHERE tenant_id = $1)                              AS records,
       (SELECT COUNT(*) FROM purchases WHERE tenant_id = $1)                              AS copies,
       (SELECT COUNT(*) FROM purchases WHERE tenant_id = $1 AND status = 'verfuegbar')   AS available,
       (SELECT COUNT(*) FROM permalinks WHERE tenant_id = $1)                             AS permalinks`,
    [tenantId],
  );
  const row = r.rows[0]!;
  return {
    records:   Number(row.records),
    copies:    Number(row.copies),
    available: Number(row.available),
    permalinks: Number(row.permalinks),
  };
}

describe('Seed enrichment', () => {
  beforeAll(async () => {
    testDb   = await setupTestDatabase();
    ownerPool = new Pool({ connectionString: testDb.ownerUrl });
  }, 60_000);

  afterAll(async () => {
    await ownerPool.end();
    await testDb.teardown();
  });

  it('exports ensurePurchase, ensurePermalink, seedTenantInventory and all dataset constants', async () => {
    const m = await import('../scripts/seed');
    expect(typeof m.ensurePurchase).toBe('function');
    expect(typeof m.ensurePermalink).toBe('function');
    expect(typeof m.seedTenantInventory).toBe('function');
    expect(Array.isArray(m.DEMO_RECORDS)).toBe(true);
    expect(Array.isArray(m.DEMO_PURCHASES)).toBe(true);
    expect(Array.isArray(m.DEMO_PERMALINKS)).toBe(true);
    expect(Array.isArray(m.VINYLCAVE_RECORDS)).toBe(true);
    expect(Array.isArray(m.VINYLCAVE_PURCHASES)).toBe(true);
    expect(Array.isArray(m.VINYLCAVE_PERMALINKS)).toBe(true);
  });

  it('seed is idempotent: two runs produce identical row counts', async () => {
    const { seedTenantInventory, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS } =
      await import('../scripts/seed');

    const { tenantId } = await seedTenant({ slug: 'idempotency-test', name: 'Idempotency Test' });

    await seedTenantInventory(ownerPool, tenantId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);
    const counts1 = await getInventoryCounts(ownerPool, tenantId);

    await seedTenantInventory(ownerPool, tenantId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);
    const counts2 = await getInventoryCounts(ownerPool, tenantId);

    expect(counts2).toEqual(counts1);
    expect(counts1.records).toBeGreaterThan(0);
    expect(counts1.copies).toBeGreaterThan(0);
  }, 60_000);

  it('demo dataset shape: 15 records, 16 copies, 11 available, 2 permalinks', async () => {
    const { seedTenantInventory, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS } =
      await import('../scripts/seed');

    const { tenantId } = await seedTenant({ slug: 'demo-shape-test', name: 'Demo Shape Test' });
    await seedTenantInventory(ownerPool, tenantId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);

    const counts = await getInventoryCounts(ownerPool, tenantId);

    expect(counts.records).toBe(15);
    expect(counts.copies).toBe(16);
    expect(counts.available).toBe(11);
    expect(counts.permalinks).toBe(2);
  }, 60_000);

  it('vinylcave dataset shape: 15 records, 16 copies, 11 available, 2 permalinks', async () => {
    const { seedTenantInventory, VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS } =
      await import('../scripts/seed');

    const { tenantId } = await seedTenant({ slug: 'vinyl-shape-test', name: 'Vinyl Shape Test' });
    await seedTenantInventory(ownerPool, tenantId, VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS);

    const counts = await getInventoryCounts(ownerPool, tenantId);

    expect(counts.records).toBe(15);
    expect(counts.copies).toBe(16);
    expect(counts.available).toBe(11);
    expect(counts.permalinks).toBe(2);
  }, 60_000);

  it('two tenants seeded from different datasets share no rows', async () => {
    const {
      seedTenantInventory,
      DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS,
      VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS,
    } = await import('../scripts/seed');

    const { tenantId: demoId }  = await seedTenant({ slug: 'iso-demo',  name: 'ISO Demo' });
    const { tenantId: vinylId } = await seedTenant({ slug: 'iso-vinyl', name: 'ISO Vinyl' });

    await seedTenantInventory(ownerPool, demoId,  DEMO_RECORDS,      DEMO_PURCHASES,      DEMO_PERMALINKS);
    await seedTenantInventory(ownerPool, vinylId, VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS);

    const demoCounts  = await getInventoryCounts(ownerPool, demoId);
    const vinylCounts = await getInventoryCounts(ownerPool, vinylId);

    expect(demoCounts.records).toBe(15);
    expect(vinylCounts.records).toBe(15);

    // Total records across both tenants = 30 (no shared rows)
    const total = await ownerPool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM records WHERE tenant_id = ANY($1)',
      [[demoId, vinylId]],
    );
    expect(Number(total.rows[0]!.n)).toBe(30);
  }, 60_000);

  it('resetFreeshopGatingState purgt record_embeddings vor dem records-Delete (FK)', async () => {
    // KI-Suche (Slice 7): record_embeddings ist ein Kind von records (FK ohne ON DELETE
    // CASCADE). Ein Re-Seed über einen persistenten Volume-Stand, bei dem ein freeshop-Record
    // per Worker-Hook ein Embedding angesammelt hat, darf resetFreeshopGatingState nicht mit
    // FK-Verletzung 23503 abstürzen lassen (gleiche FK-Klasse wie purgeBlueLines in
    // e2e/discogs.spec.ts).
    const { resetFreeshopGatingState } = await import('../scripts/seed');
    const { recordHash } = await import('../src/db/hash');

    const { tenantId } = await seedTenant({ slug: 'freeshop-fk-test', name: 'Freeshop FK Test' });

    // Stale Record: Hash matcht keinen FREESHOP_RECORDS-Eintrag → resetFreeshopGatingState
    // markiert ihn als stale und löscht ihn.
    const staleHash = recordHash({
      title: 'Stale Ghost Pressing', artist: 'Nobody', country: 'US', year: 1999, label: ['none'],
    });
    const { rows: recRows } = await ownerPool.query<{ id: number }>(
      `INSERT INTO records (tenant_id, title, artist, label, country, release_year, format, genre, hash)
       VALUES ($1, 'Stale Ghost Pressing', 'Nobody', ARRAY['none'], 'US', 1999, 'Vinyl', ARRAY[]::text[], $2)
       RETURNING id`,
      [tenantId, staleHash],
    );
    const staleRecordId = recRows[0]!.id;

    const fakeVector = `[${Array(1536).fill(0).join(',')}]`;
    await ownerPool.query(
      `INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
       VALUES ($1, $2, $3::vector(1536), 'test-hash', 'fake-v1')`,
      [tenantId, staleRecordId, fakeVector],
    );
    await ownerPool.query(
      `INSERT INTO purchases (tenant_id, record_id, status) VALUES ($1, $2, 'verfuegbar')`,
      [tenantId, staleRecordId],
    );

    await expect(resetFreeshopGatingState(ownerPool, tenantId)).resolves.toBeUndefined();

    const remainingRecords = await ownerPool.query('SELECT id FROM records WHERE id = $1', [staleRecordId]);
    const remainingEmbeddings = await ownerPool.query('SELECT id FROM record_embeddings WHERE record_id = $1', [staleRecordId]);
    const remainingPurchases = await ownerPool.query('SELECT id FROM purchases WHERE record_id = $1', [staleRecordId]);
    expect(remainingRecords.rows).toHaveLength(0);
    expect(remainingEmbeddings.rows).toHaveLength(0);
    expect(remainingPurchases.rows).toHaveLength(0);
  }, 60_000);
});
