import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

// The guard lives in tests/__setup__/pg-idle-error-guard.ts and is wired via vitest.config
// `setupFiles`, so it is active for every test file. It patches the shared pg prototypes so any
// pool/client that opens a connection carries an 'error' listener — otherwise a FATAL 57P01
// ("terminating connection due to administrator command") at testcontainer `.stop()` escalates
// to an uncaughtException that fails the whole run even when every test passed.
describe('pg idle-error guard (global test setup)', () => {
  it('a pool that opened a connection carries an error listener, so an idle-connection drop cannot crash the run', async () => {
    const pool = new Pool({
      connectionString: 'postgresql://nobody:nope@127.0.0.1:59999/none',
      connectionTimeoutMillis: 500,
    });
    // Lazy by design: a freshly-constructed pool has no listener yet.
    expect(pool.listenerCount('error')).toBe(0);
    // Opening a connection (even one that fails) must leave a guarding 'error' listener behind.
    await pool.connect().catch(() => undefined);
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    await pool.end().catch(() => undefined);
  });
});
