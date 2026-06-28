import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({
  appPool: { connect: vi.fn() },
  ownerPool: {},
}));

import { appPool } from '@/db/client';
import { assertDatabaseSafety } from '@/db/assertions';

type FakeOpts = {
  rolsuper?: boolean;
  rolbypassrls?: boolean;
  rls?: boolean;
  force?: boolean;
  policy?: boolean;
  recordsCount?: string;
};

function fakeClient(opts: FakeOpts = {}) {
  return {
    query: async (text: string) => {
      if (text.includes('pg_roles')) {
        return {
          rows: [{ rolsuper: opts.rolsuper ?? false, rolbypassrls: opts.rolbypassrls ?? false }],
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
});
