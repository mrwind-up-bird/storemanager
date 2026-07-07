import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, type TestDatabase } from '../helpers/db';

describe('pgvector extension', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await setupTestDatabase();
  }, 120_000);
  afterAll(async () => {
    await db.teardown();
  });

  it('ist in der Test-DB installiert (Voraussetzung für record_embeddings)', async () => {
    const pool = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query(`SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector'`);
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});
