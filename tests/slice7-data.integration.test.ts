import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, type TestDatabase } from './helpers/db';

describe('0015 kiSuche-Feature-Matrix', () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await setupTestDatabase(); }, 120_000);
  afterAll(async () => { await db.teardown(); });

  it('setzt kiSuche false/true/true für free/small/big', async () => {
    const pool = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query(`SELECT slug, features->>'kiSuche' AS ki FROM plans ORDER BY slug`);
      const map = Object.fromEntries(rows.map((r) => [r.slug, r.ki]));
      expect(map).toMatchObject({ free: 'false', small: 'true', big: 'true' });
    } finally {
      await pool.end();
    }
  });
});
