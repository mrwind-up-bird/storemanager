import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({
  appPool: { connect: vi.fn() },
  ownerPool: {},
}));

import { appPool } from '@/db/client';
import { assertDatabaseSafety } from '@/db/assertions';

/** The tenant_id-bearing tables a sound DB reports — matches TENANT_SCOPED_TABLES. */
const SOUND_TENANT_ID_TABLES = [
  'users',
  'user_detail',
  'sessions',
  'records',
  'purchases',
  'permalinks',
  'discogs_connections',
  'quick_items',
  'transactions',
  'transaction_items',
  'wishlists',
  'wishlist_matches',
  'collections',
  'subscriptions',
];

type FakeOpts = {
  rolsuper?: boolean;
  rolbypassrls?: boolean;
  rls?: boolean;
  force?: boolean;
  policy?: boolean;
  recordsCount?: string;
  /** Override the set of public base tables reported to have a tenant_id column (drift guard). */
  tenantIdTables?: string[];
};

function fakeClient(opts: FakeOpts = {}) {
  return {
    query: async (text: string) => {
      if (text.includes('pg_roles')) {
        return {
          rows: [{ rolsuper: opts.rolsuper ?? false, rolbypassrls: opts.rolbypassrls ?? false }],
        };
      }
      if (text.includes('information_schema')) {
        return {
          rows: (opts.tenantIdTables ?? SOUND_TENANT_ID_TABLES).map((table_name) => ({
            table_name,
          })),
        };
      }
      if (text.includes('relrowsecurity')) {
        return { rows: [{ relrowsecurity: opts.rls ?? true, relforcerowsecurity: opts.force ?? true }] };
      }
      if (text.includes('pg_policies')) {
        return { rows: [{ count: (opts.policy ?? true) ? '1' : '0' }] };
      }
      if (text.includes('FROM records')) {
        return { rows: [{ count: opts.recordsCount ?? '0' }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
}

const connect = appPool.connect as unknown as Mock;

function arm(opts: FakeOpts = {}) {
  connect.mockResolvedValue(fakeClient(opts));
}

describe('assertDatabaseSafety', () => {
  beforeEach(() => connect.mockReset());

  it('resolves on a correctly locked-down database', async () => {
    arm();
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });

  it('throws if the app role is a SUPERUSER', async () => {
    arm({ rolsuper: true });
    await expect(assertDatabaseSafety()).rejects.toThrow(/SUPERUSER/);
  });

  it('throws if the app role has BYPASSRLS', async () => {
    arm({ rolbypassrls: true });
    await expect(assertDatabaseSafety()).rejects.toThrow(/BYPASSRLS/);
  });

  it('throws if a tenant-scoped table lacks ROW LEVEL SECURITY', async () => {
    arm({ rls: false });
    await expect(assertDatabaseSafety()).rejects.toThrow(/ROW LEVEL SECURITY/);
  });

  it('throws if a tenant-scoped table lacks FORCE ROW LEVEL SECURITY', async () => {
    arm({ force: false });
    await expect(assertDatabaseSafety()).rejects.toThrow(/FORCE ROW LEVEL SECURITY/);
  });

  it("throws if the 'tenant_isolation' policy is missing", async () => {
    arm({ policy: false });
    await expect(assertDatabaseSafety()).rejects.toThrow(/tenant_isolation/);
  });

  it('throws if records returns rows without tenant context (RLS not fail-closed)', async () => {
    arm({ recordsCount: '3' });
    await expect(assertDatabaseSafety()).rejects.toThrow(/without tenant context/);
  });

  // ── Fix 5: TENANT_SCOPED_TABLES drift guard ───────────────────────────────
  it('throws when a tenant_id-bearing table is ABSENT from TENANT_SCOPED_TABLES (drift)', async () => {
    // A future slice added `invoices` (with a tenant_id) but forgot to extend the list.
    arm({ tenantIdTables: [...SOUND_TENANT_ID_TABLES, 'invoices'] });
    await expect(assertDatabaseSafety()).rejects.toThrow(/TENANT_SCOPED_TABLES/);
    await expect(assertDatabaseSafety()).rejects.toThrow(/invoices/);
  });

  it('throws when a listed table has no tenant_id column in public (reverse drift)', async () => {
    // The DB no longer reports `permalinks` as tenant-scoped, but it is still listed.
    arm({ tenantIdTables: SOUND_TENANT_ID_TABLES.filter((t) => t !== 'permalinks') });
    await expect(assertDatabaseSafety()).rejects.toThrow(/TENANT_SCOPED_TABLES/);
    await expect(assertDatabaseSafety()).rejects.toThrow(/permalinks/);
  });
});
