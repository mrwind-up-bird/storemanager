import { afterAll, describe, expect, it, vi } from 'vitest';

// @/db/client builds its `appPool`/`ownerPool` singletons at module-eval time from `@/env`.
// Mock only the fields client.ts reads so we can import the REAL pools without a live database
// (pg Pools don't open a connection until first checkout, so import never touches Postgres).
vi.mock('@/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://qr_app:pw@localhost:5432/test',
    DATABASE_OWNER_URL: 'postgresql://qr_owner:pw@localhost:5432/test',
    DB_POOL_MAX: 10,
    DB_STATEMENT_TIMEOUT_MS: 10_000,
    DB_IDLE_TX_TIMEOUT_MS: 10_000,
  },
}));

import { appPool, ownerPool } from '@/db/client';

afterAll(async () => {
  await appPool.end().catch(() => undefined);
  await ownerPool.end().catch(() => undefined);
});

describe('@/db/client pools', () => {
  // node-postgres emits 'error' on the pool when an *idle* backend connection is dropped
  // (DB restart, failover, or admin shutdown at container teardown). With no listener, pg
  // escalates it to an uncaughtException that crashes the process — and in the integration
  // suite, fails the whole vitest run with an unhandled 57P01 even when every file passes.
  it('appPool registers an error listener so a dropped idle connection cannot crash the process', () => {
    expect(appPool.listenerCount('error')).toBeGreaterThan(0);
  });

  it('ownerPool registers an error listener so a dropped idle connection cannot crash the process', () => {
    expect(ownerPool.listenerCount('error')).toBeGreaterThan(0);
  });
});
