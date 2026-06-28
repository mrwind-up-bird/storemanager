import 'server-only';
import { Pool } from 'pg';
import { env } from '@/env';

const connectionOptions = {
  // Both are transaction/connection guards passed straight through to the pg client.
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: env.DB_IDLE_TX_TIMEOUT_MS,
} as const;

/** Runtime pool — connects as `qr_app` (NON-superuser, NO BYPASSRLS). RLS-enforced. */
export const appPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  ...connectionOptions,
});

/** Privileged pool — connects as `qr_owner`. Registry writes + migrations ONLY. */
export const ownerPool = new Pool({
  connectionString: env.DATABASE_OWNER_URL,
  max: env.DB_POOL_MAX,
  ...connectionOptions,
});
