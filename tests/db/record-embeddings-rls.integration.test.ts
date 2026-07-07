import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from '../helpers/db';

const FAKE_VEC = `[${Array.from({ length: 1536 }, () => 0).map((_, i) => (i === 0 ? 1 : 0)).join(',')}]`;

describe('record_embeddings RLS-Isolation', () => {
  let db: TestDatabase;
  let withTenant: typeof import('@/db/tenant')['withTenant'];
  let tenantA: number;
  let tenantB: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    vi.resetModules();
    ({ withTenant } = await import('@/db/tenant'));
    ({ tenantId: tenantA } = await seedTenant({ slug: 'a-rls', name: 'A' }));
    ({ tenantId: tenantB } = await seedTenant({ slug: 'b-rls', name: 'B' }));

    // Records + Embeddings je Tenant über den Owner-Pool (BYPASSRLS, explizite tenant_id).
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      for (const [t, tag] of [[tenantA, 'a'], [tenantB, 'b']] as const) {
        const { rows } = await owner.query(
          `INSERT INTO records (tenant_id, title, artist, hash) VALUES ($1, $2, 'X', $3) RETURNING id`,
          [t, `Rec ${tag}`, `hash_${tag}`],
        );
        const recordId = rows[0].id as number;
        await owner.query(
          `INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
           VALUES ($1, $2, $3::vector(1536), $4, 'fake-v1')`,
          [t, recordId, FAKE_VEC, `ch_${tag}`],
        );
      }
    } finally {
      await owner.end();
    }
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  it('A sieht exakt seine Zeile, B nicht (positive + negative Kontrolle)', async () => {
    const seenByA = await withTenant({ tenantId: tenantA, userId: null }, (tx) =>
      tx.execute(sql`SELECT content_hash FROM record_embeddings`),
    );
    expect(seenByA.rows).toHaveLength(1);
    expect(seenByA.rows[0]!.content_hash).toBe('ch_a');

    const seenByB = await withTenant({ tenantId: tenantB, userId: null }, (tx) =>
      tx.execute(sql`SELECT content_hash FROM record_embeddings`),
    );
    expect(seenByB.rows).toHaveLength(1);
    expect(seenByB.rows[0]!.content_hash).toBe('ch_b');
  });

  it('Boot-Assertion bleibt grün (Drift-Guard kennt record_embeddings)', async () => {
    const { assertDatabaseSafety } = await import('@/db/assertions');
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });
});
