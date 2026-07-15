import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase } from '../helpers/db';

let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let sqlTag: (typeof import('drizzle-orm'))['sql'];
let teardown: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const testDb = await setupTestDatabase();
  teardown = testDb.teardown;
  process.env.DATABASE_URL = testDb.appUrl;
  process.env.DATABASE_OWNER_URL = testDb.ownerUrl;

  vi.resetModules();
  ({ withOwner } = await import('@/db/tenant'));
  ({ sql: sqlTag } = await import('drizzle-orm'));
}, 180_000);

afterAll(async () => {
  await teardown?.();
});

describe('records indexes', () => {
  it('has the tenant/artist/title/id and tenant/format btree indexes', async () => {
    const res = await withOwner((tx) =>
      tx.execute(sqlTag`SELECT indexname FROM pg_indexes WHERE tablename = 'records'`),
    );
    const names = (res.rows as { indexname: string }[]).map((r) => r.indexname);
    expect(names).toContain('records_tenant_artist_title_idx');
    expect(names).toContain('records_tenant_format_idx');
  });
});
