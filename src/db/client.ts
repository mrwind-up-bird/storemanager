import 'server-only';
import { Pool } from 'pg';
import { env } from '@/env';

const connectionOptions = {
  // Both are transaction/connection guards passed straight through to the pg client.
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: env.DB_IDLE_TX_TIMEOUT_MS,
} as const;

/**
 * node-postgres emits `'error'` on the pool when an *idle* pooled connection is dropped by the
 * backend (DB restart, failover, or admin shutdown). With NO listener, pg escalates that to an
 * uncaughtException that crashes the process. Log and swallow — the pool reconnects on the next
 * checkout, and in-flight queries still reject through their own promises, so nothing real is
 * masked. (This also fixes an integration-suite flake: a dropped `qr_owner` connection at
 * testcontainer `.stop()` no longer fails the vitest run with an unhandled 57P01.)
 */
function guardIdleErrors(pool: Pool, label: string): Pool {
  pool.on('error', (err) => {
    console.error(`[db] ${label}: idle connection dropped, pool will reconnect —`, err);
  });
  return pool;
}

/** Runtime pool — connects as `qr_app` (NON-superuser, NO BYPASSRLS). RLS-enforced. */
export const appPool = guardIdleErrors(
  new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    ...connectionOptions,
  }),
  'appPool',
);

/** Privileged pool — connects as `qr_owner`. Registry writes + migrations ONLY. */
export const ownerPool = guardIdleErrors(
  new Pool({
    connectionString: env.DATABASE_OWNER_URL,
    max: env.DB_POOL_MAX,
    ...connectionOptions,
  }),
  'ownerPool',
);
