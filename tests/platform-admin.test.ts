import { Pool } from 'pg';
import bcryptjs from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDatabase, type TestDatabase } from './helpers/db';
import { assertStrongAdminPassword, ensurePlatformAdmin } from '@/lib/platformAdmin';

describe('assertStrongAdminPassword', () => {
  it('throws when password is missing', () => {
    expect(() => assertStrongAdminPassword(undefined)).toThrow(/PLATFORM_ADMIN_PASSWORD/);
  });
  it('throws when password is shorter than 12 chars', () => {
    expect(() => assertStrongAdminPassword('short')).toThrow(/12/);
  });
  it('passes for a strong password', () => {
    expect(() => assertStrongAdminPassword('a-strong-password-123')).not.toThrow();
  });
});

describe('ensurePlatformAdmin (integration)', () => {
  let tdb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    tdb = await setupTestDatabase();
    pool = new Pool({ connectionString: tdb.ownerUrl, max: 1 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await tdb?.teardown();
  });

  it('creates the superadmin with a bcrypt-hashed password, idempotently', async () => {
    const email = 'super@qrsm.store';
    const password = 'a-strong-password-123';

    const first = await ensurePlatformAdmin(pool, { email, password });
    expect(first.created).toBe(true);

    const rows = await pool.query('SELECT email, password FROM platform_users WHERE email = $1', [email]);
    expect(rows.rowCount).toBe(1);
    expect(await bcryptjs.compare(password, rows.rows[0].password)).toBe(true);

    // Second run must NOT create a duplicate and must leave the existing row untouched.
    const second = await ensurePlatformAdmin(pool, { email, password: 'different-but-ignored-pw' });
    expect(second.created).toBe(false);
    const after = await pool.query('SELECT password FROM platform_users WHERE email = $1', [email]);
    expect(after.rowCount).toBe(1);
    expect(await bcryptjs.compare(password, after.rows[0].password)).toBe(true);
  });
});
