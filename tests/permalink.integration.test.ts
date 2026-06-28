import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';
import { eq, and } from 'drizzle-orm';

// Bound AFTER setupTestDatabase publishes env (see the harness ordering contract in tests/helpers/db.ts).
// Never import @/db/tenant or @/db/schema statically — those modules eval @/env at load time, which
// would read DATABASE_URL before testcontainers has written the actual connection string.
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let withOwner: (typeof import('@/db/tenant'))['withOwner'];
let permalinks: (typeof import('@/db/schema'))['permalinks'];

let teardown: (() => Promise<void>) | undefined;
let tenantId: number;

beforeAll(async () => {
  const testDb = await setupTestDatabase();
  teardown = testDb.teardown;
  process.env.DATABASE_URL = testDb.appUrl;
  process.env.DATABASE_OWNER_URL = testDb.ownerUrl;

  // Reset module graph so singletons bind to THIS run's env, then import.
  vi.resetModules();
  ({ withTenant, withOwner } = await import('@/db/tenant'));
  ({ permalinks } = await import('@/db/schema'));

  const seeded = await seedTenant({
    slug: 'demo',
    name: 'Demo Store',
    primaryColor: '#E8552E',
  });
  tenantId = seeded.tenantId;

  // Insert a known permalink so the lookup tests can query it
  await withOwner((tx) =>
    tx.insert(permalinks).values({
      tenantId,
      slug: 'lager',
      filter: { status: 'verfuegbar' },
    }),
  );
}, 90_000);

afterAll(async () => {
  await teardown?.();
});

describe('permalink lookup — guard for s/[permalink]/page.tsx', () => {
  it('finds an existing permalink scoped to the correct tenant', async () => {
    const row = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .select({ id: permalinks.id, slug: permalinks.slug })
        .from(permalinks)
        .where(
          and(
            eq(permalinks.slug, 'lager'),
            eq(permalinks.tenantId, tenantId),
          ),
        )
        .then((rows) => rows[0] ?? null),
    );

    expect(row).not.toBeNull();
    expect(row?.slug).toBe('lager');
  });

  it('returns null for an unknown permalink slug — page must call notFound()', async () => {
    const row = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .select({ id: permalinks.id })
        .from(permalinks)
        .where(
          and(
            eq(permalinks.slug, 'does-not-exist'),
            eq(permalinks.tenantId, tenantId),
          ),
        )
        .then((rows) => rows[0] ?? null),
    );

    expect(row).toBeNull();
    // When null, the page component calls notFound() → §9.4 acceptance criterion
  });

  it('does NOT return a permalink belonging to a different tenant', async () => {
    // Seed a second tenant with the same slug
    const other = await seedTenant({ slug: 'other', name: 'Other Store' });
    await withOwner((tx) =>
      tx.insert(permalinks).values({
        tenantId: other.tenantId,
        slug: 'lager',
        filter: {},
      }),
    );

    // Query scoped to FIRST tenant — must not see second tenant's row count
    const rows = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .select({ id: permalinks.id, tenantId: permalinks.tenantId })
        .from(permalinks)
        .where(eq(permalinks.slug, 'lager')),
    );

    // Every returned row must belong to tenantId (RLS guarantee)
    for (const row of rows) {
      expect(row.tenantId).toBe(tenantId);
    }
  });
});
