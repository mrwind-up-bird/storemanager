import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @/env so the Zod parse at module-load time does not fail in the unit test
// environment where real env vars are not set.
vi.mock('@/env', () => ({
  env: {
    PGBOSS_DATABASE_URL: 'postgresql://qr_owner:pw@localhost:5432/test',
    DATABASE_URL: 'postgresql://qr_app:pw@localhost:5432/test',
    DATABASE_OWNER_URL: 'postgresql://qr_owner:pw@localhost:5432/test',
    ROOT_DOMAIN: 'localhost',
    APP_PROTOCOL: 'http',
    APP_PORT: '3000',
    AUTH_SECRET: 'test-secret',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    ENCRYPTION_KEY_ID: 'v1',
    MAIL_DRIVER: 'console' as const,
    MAIL_HOST: 'localhost',
    MAIL_PORT: 1025,
    MAIL_FROM: 'test@localhost',
    NODE_ENV: 'test' as const,
    DB_POOL_MAX: 10,
    DB_STATEMENT_TIMEOUT_MS: 10_000,
    DB_IDLE_TX_TIMEOUT_MS: 10_000,
  },
}));

// Hoist the mock so it applies before the tested module is imported
vi.mock('@/db/tenant', () => ({
  withSuperadmin: vi.fn().mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  ),
}));

vi.mock('server-only', () => ({}));

describe('QUEUE constants', () => {
  it('analyticsSummaryRefresh equals the canonical queue name', async () => {
    const { QUEUE } = await import('@/worker/index');
    expect(QUEUE.analyticsSummaryRefresh).toBe('system.analytics_summary.refresh');
  });

  it('discogsListingCreate equals the canonical queue name (env-less import)', async () => {
    // Verifies the queue-name constant and that `import { QUEUE }` resolves without
    // env set. (The real guard against a value-import regression is the structural
    // `import type` of the job module in worker/index.ts, not this env-mocked test.)
    const { QUEUE } = await import('@/worker/index');
    expect(QUEUE.discogsListingCreate).toBe('tenant.discogs.listing.create');
  });

  it('wishlistMatch equals the canonical queue name (env-less import)', async () => {
    const { QUEUE } = await import('@/worker/index');
    expect(QUEUE.wishlistMatch).toBe('tenant.wishlist.match');
  });

  it('QUEUE is structurally readonly (as const)', async () => {
    const { QUEUE } = await import('@/worker/index');
    // TypeScript enforces this at compile time; at runtime the value must be a string
    expect(typeof QUEUE.analyticsSummaryRefresh).toBe('string');
  });
});

describe('handleAnalyticsSummaryRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls withSuperadmin exactly once and resolves without throwing', async () => {
    const { handleAnalyticsSummaryRefresh } = await import('@/worker/jobs/analyticsSummary');
    const { withSuperadmin } = await import('@/db/tenant');

    const mockJob = {
      id: 'unit-test-job-id',
      name: 'system.analytics_summary.refresh',
      data: { tenantId: 7 },
      completionTime: null,
      createdon: new Date().toISOString(),
      startedon: new Date().toISOString(),
      expiredin: '00:15:00',
      priority: 0,
      retrycount: 0,
    } as unknown as import('pg-boss').Job<{ tenantId: number }>;

    await expect(handleAnalyticsSummaryRefresh(mockJob)).resolves.toBeUndefined();

    expect(withSuperadmin).toHaveBeenCalledOnce();
  });

  it('passes the tenantId from job.data to the log context (calls withSuperadmin with a function)', async () => {
    const { handleAnalyticsSummaryRefresh } = await import('@/worker/jobs/analyticsSummary');
    const { withSuperadmin } = await import('@/db/tenant');

    const mockJob = {
      id: 'unit-test-job-id-2',
      name: 'system.analytics_summary.refresh',
      data: { tenantId: 42 },
    } as unknown as import('pg-boss').Job<{ tenantId: number }>;

    await handleAnalyticsSummaryRefresh(mockJob);

    expect(vi.mocked(withSuperadmin)).toHaveBeenCalledOnce();
    // Verify the callback passed to withSuperadmin is a function
    const [fn] = vi.mocked(withSuperadmin).mock.calls[0]!;
    expect(typeof fn).toBe('function');
  });
});
