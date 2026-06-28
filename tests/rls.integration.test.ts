import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedTenant, setupTestDatabase } from './helpers/db';

/**
 * THE security gate for Slice 0 multi-tenant isolation, proven against a real PostgreSQL 17.
 *
 *   §9.1  no tenant context  → 0 rows (and no integer-cast error) + context-less INSERT rejected
 *   §9.2  two tenants under concurrent interleaved reads → never leak across the boundary
 *   §9.5  assertDatabaseSafety() passes on a sound DB and FAILS CLOSED when RLS is broken
 *   §9.6  is_superadmin set by withSuperadmin does NOT bleed onto a reused pooled connection
 *   plus: withSuperadmin sees across tenants, and withTenant rejects non-integer tenantId.
 *
 * Every assertion checks REAL behaviour: row sets are compared per tenant, the superadmin-leak
 * test proves the negative (no B rows visible under withTenant(A)), and the boot-assertion test
 * mutates the live schema to confirm the guard can actually fail. If isolation regresses, these
 * tests go red.
 */

// Bound AFTER setupTestDatabase publishes env (see the harness ordering contract).
let db: Awaited<ReturnType<typeof setupTestDatabase>>;
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let withSuperadmin: (typeof import('@/db/tenant'))['withSuperadmin'];
let appPool: Pool;
let assertDatabaseSafety: (typeof import('@/db/assertions'))['assertDatabaseSafety'];

beforeAll(async () => {
  // setupTestDatabase sets process.env.{DATABASE_URL,DATABASE_OWNER_URL,...} BEFORE we import
  // the db modules, so env.ts/client.ts read the live testcontainer ports. Reset the module
  // graph first so the singleton pools bind to THIS run's env, then import.
  db = await setupTestDatabase();
  vi.resetModules();
  ({ withTenant, withSuperadmin } = await import('@/db/tenant'));
  ({ appPool } = await import('@/db/client'));
  ({ assertDatabaseSafety } = await import('@/db/assertions'));
}, 120_000);

afterAll(async () => {
  await db.teardown();
});

// Globally-unique record hash (records_hash_tenant is UNIQUE on (hash, tenant_id)).
let hashSeq = 0;

/** Seeds `titles` as records for `tenantId` THROUGH withTenant — exercises the real insert path
 *  (RLS WITH CHECK + the GUC-derived tenant_id). Returns the titles sorted for set comparison. */
async function seedRecords(tenantId: number, titles: readonly string[]): Promise<string[]> {
  for (const title of titles) {
    const hash = `h-${(hashSeq += 1)}`;
    await withTenant({ tenantId, userId: null }, (tx) =>
      tx.execute(
        sql`insert into records (tenant_id, title, artist, hash)
            values (${tenantId}, ${title}, 'artist', ${hash})`,
      ),
    );
  }
  return [...titles].sort();
}

/** Reads the visible record titles for a tenant via withTenant, sorted. */
async function readTitles(tenantId: number): Promise<string[]> {
  return withTenant({ tenantId, userId: null }, async (tx) => {
    const r = await tx.execute<{ title: string }>(sql`select title from records`);
    return r.rows.map((row) => row.title).sort();
  });
}

describe('RLS fail-closed (the security gate)', () => {
  // ── §9.1 — read side ──────────────────────────────────────────────────────
  it('returns 0 rows for a raw appPool query with NO tenant context (and does not throw)', async () => {
    const { tenantId } = await seedTenant({ slug: 'alpha', name: 'Alpha' });
    await seedRecords(tenantId, ['alpha-only']);

    // Raw query on appPool: no transaction, no GUC. current_setting('app.current_tenant', true)
    // is NULL → NULLIF(NULL,'') is NULL → tenant_id = NULL is UNKNOWN → no rows, and crucially
    // NO "invalid input syntax for integer" error. Fail-closed without a throw.
    const res = await appPool.query('select * from records');
    expect(res.rowCount).toBe(0);
  });

  // ── §9.1 — write side ─────────────────────────────────────────────────────
  it('rejects an INSERT without tenant context', async () => {
    // No GUC → tenant_id default resolves to NULL → NOT NULL / RLS WITH CHECK violation.
    await expect(
      appPool.query(`insert into records (title, artist, hash) values ('x','y','no-ctx-insert')`),
    ).rejects.toThrow();

    // And nothing was written.
    const after = await appPool.query(`select * from records where hash = 'no-ctx-insert'`);
    expect(after.rowCount).toBe(0);
  });

  // ── §9.2 — interleaved concurrent reads, x50 per tenant, never leak ────────
  it('isolates two tenants under concurrent interleaved reads (x50 each)', async () => {
    const a = await seedTenant({ slug: 'beta', name: 'Beta' });
    const b = await seedTenant({ slug: 'gamma', name: 'Gamma' });
    const aTitles = await seedRecords(a.tenantId, ['A-rec-0', 'A-rec-1', 'A-rec-2']);
    const bTitles = await seedRecords(b.tenantId, ['B-rec-0', 'B-rec-1', 'B-rec-2']);

    // Interleave A,B,A,B,... so reads for both tenants are in flight on the shared appPool
    // simultaneously. ops[evenIdx] reads A, ops[oddIdx] reads B.
    const ITER = 50;
    const ops = Array.from({ length: ITER }).flatMap(() => [
      readTitles(a.tenantId),
      readTitles(b.tenantId),
    ]);
    const results = await Promise.all(ops);

    expect(results).toHaveLength(ITER * 2);
    results.forEach((titles, idx) => {
      const isA = idx % 2 === 0;
      // Sees EXACTLY its own tenant's rows...
      expect(titles).toEqual(isA ? aTitles : bTitles);
      // ...and NONE of the other tenant's rows (the anti-leak invariant).
      const foreign = isA ? bTitles : aTitles;
      expect(titles.some((t) => foreign.includes(t))).toBe(false);
    });
  });

  // ── §9.6 — is_superadmin must NOT leak onto a reused pooled connection ──────
  it('does not leak is_superadmin across pooled connections', async () => {
    const a = await seedTenant({ slug: 'delta', name: 'Delta' });
    const b = await seedTenant({ slug: 'epsilon', name: 'Epsilon' });
    const aTitles = await seedRecords(a.tenantId, ['visible-A']);
    await seedRecords(b.tenantId, ['secret-B']);

    // Run many rounds of: superadmin op (is_superadmin='true') IMMEDIATELY followed by a
    // withTenant(A) op. With a pooled connection this forces reuse of the very connection the
    // superadmin tx ran on. The withTenant tx sets is_superadmin='false' as a per-call literal,
    // so it must NEVER inherit the superadmin view — it can see ONLY tenant A, never 'secret-B'.
    for (let i = 0; i < 30; i += 1) {
      const superadminSaw = await withSuperadmin(async (tx) => {
        const r = await tx.execute<{ title: string }>(sql`select title from records`);
        return r.rows.map((row) => row.title);
      });
      // Sanity: the superadmin op really does see B's secret (so the negative below is meaningful).
      expect(superadminSaw).toContain('secret-B');

      const seenByA = await readTitles(a.tenantId);
      expect(seenByA).not.toContain('secret-B');
      expect(seenByA).toEqual(aTitles);
    }

    // Also under genuine concurrency: superadmin + tenant-A ops contending for the pool at once.
    const mixed = Array.from({ length: 40 }).map((_, i) =>
      i % 2 === 0
        ? withSuperadmin(async (tx) => {
            await tx.execute(sql`select count(*) from records`);
            return null as string[] | null;
          })
        : readTitles(a.tenantId),
    );
    const mixedResults = await Promise.all(mixed);
    mixedResults.forEach((titles) => {
      if (titles !== null) {
        expect(titles).not.toContain('secret-B');
        expect(titles).toEqual(aTitles);
      }
    });
  });

  // ── withSuperadmin sees across tenants (proves the bypass policy + empty-string GUC) ──
  it('lets withSuperadmin read rows from BOTH tenants', async () => {
    const a = await seedTenant({ slug: 'zeta', name: 'Zeta' });
    const b = await seedTenant({ slug: 'eta', name: 'Eta' });
    await seedRecords(a.tenantId, ['zeta-only']);
    await seedRecords(b.tenantId, ['eta-only']);

    // withSuperadmin sets app.current_tenant='' (empty string). NULLIF('', '')→NULL means the
    // tenant_isolation policy matches nothing, but superadmin_bypass (is_superadmin='true') opens
    // every row — and the empty-string GUC must NOT raise an integer-cast error.
    const titles = await withSuperadmin(async (tx) => {
      const r = await tx.execute<{ title: string }>(sql`select title from records`);
      return r.rows.map((row) => row.title);
    });

    expect(titles).toContain('zeta-only');
    expect(titles).toContain('eta-only');
  });

  // ── withTenant input guard: non-integer tenantId rejects BEFORE any DB work ──
  it('rejects withTenant for a non-integer tenantId without invoking the callback', async () => {
    const fnNaN = vi.fn(async (): Promise<void> => undefined);
    await expect(withTenant({ tenantId: Number.NaN, userId: null }, fnNaN)).rejects.toThrow(
      /integer/i,
    );
    expect(fnNaN).not.toHaveBeenCalled();

    const fnFloat = vi.fn(async (): Promise<void> => undefined);
    await expect(withTenant({ tenantId: 1.5, userId: null }, fnFloat)).rejects.toThrow(/integer/i);
    expect(fnFloat).not.toHaveBeenCalled();

    // Same guard on a non-integer userId.
    const fnUser = vi.fn(async (): Promise<void> => undefined);
    await expect(withTenant({ tenantId: 1, userId: 2.5 }, fnUser)).rejects.toThrow(/integer/i);
    expect(fnUser).not.toHaveBeenCalled();
  });

  // ── §9.5 — boot assertion passes on a correct DB ──────────────────────────
  it('assertDatabaseSafety passes on the migrated database', async () => {
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });

  // ── §9.5 — ...and FAILS CLOSED when FORCE row security is removed. ─────────
  // These two mutate-and-restore the shared schema, so they run LAST.
  it('assertDatabaseSafety throws when FORCE row security is dropped on records', async () => {
    const { ownerPool } = await import('@/db/client');
    await ownerPool.query('ALTER TABLE records NO FORCE ROW LEVEL SECURITY');
    try {
      await expect(assertDatabaseSafety()).rejects.toThrow(/FORCE ROW LEVEL SECURITY/);
    } finally {
      await ownerPool.query('ALTER TABLE records FORCE ROW LEVEL SECURITY');
    }
    // Restored → green again.
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });

  it('assertDatabaseSafety throws when the tenant_isolation policy is dropped on records', async () => {
    const { ownerPool } = await import('@/db/client');
    await ownerPool.query('DROP POLICY tenant_isolation ON records');
    try {
      await expect(assertDatabaseSafety()).rejects.toThrow(/tenant_isolation/);
    } finally {
      await ownerPool.query(
        `CREATE POLICY tenant_isolation ON records
           USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int)
           WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int)`,
      );
    }
    // Restored → green again.
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });
});
