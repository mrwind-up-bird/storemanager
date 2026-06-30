import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  ({ withTenant, withOwner } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  tenantA = (await seedTenant({ slug: 'a', name: 'A' })).tenantId;
  tenantB = (await seedTenant({ slug: 'b', name: 'B' })).tenantId;
});
afterAll(async () => { if (teardown) await teardown(); });

describe('discogs_connections migration', () => {
  it('has the purchases listing columns', async () => {
    await withTenant({ tenantId: tenantA, userId: null }, async (tx) => {
      const rows = await tx.execute(
        // information_schema is not RLS-guarded; just proves the columns exist
        // eslint-disable-next-line
        (await import('drizzle-orm')).sql`select column_name from information_schema.columns where table_name='purchases' and column_name in ('discogs_listing_id','discogs_listing_status')`,
      );
      expect(rows.rows.length).toBe(2);
    });
  });

  it('isolates connections per tenant under RLS', async () => {
    await withTenant({ tenantId: tenantA, userId: null }, async (tx) => {
      await tx.insert(schema.discogsConnections).values({
        tenantId: tenantA, discogsUsername: 'a-shop', oauthToken: 'x', oauthTokenSecret: 'y',
        connectedByUserId: null,
      });
    });
    const seenByB = await withTenant({ tenantId: tenantB, userId: null }, async (tx) =>
      tx.select().from(schema.discogsConnections),
    );
    expect(seenByB).toHaveLength(0); // RLS hides tenant A's row from tenant B
    const seenByA = await withTenant({ tenantId: tenantA, userId: null }, async (tx) =>
      tx.select().from(schema.discogsConnections),
    );
    expect(seenByA).toHaveLength(1);
  });

  it('enforces one connection per tenant (unique tenant_id)', async () => {
    await expect(
      withTenant({ tenantId: tenantA, userId: null }, async (tx) => {
        await tx.insert(schema.discogsConnections).values({
          tenantId: tenantA, discogsUsername: 'dup', oauthToken: 'x', oauthTokenSecret: 'y',
          connectedByUserId: null,
        });
      }),
    ).rejects.toThrow(); // duplicate violates discogs_connections_tenant
  });
});
