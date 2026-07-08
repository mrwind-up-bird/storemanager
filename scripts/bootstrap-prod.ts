// Must be first: loads .env into process.env before any src/* imports.
import 'dotenv/config';

import { Pool } from 'pg';
import { env } from '../src/env';
import { assertStrongAdminPassword, ensurePlatformAdmin } from '../src/lib/platformAdmin';

async function main(): Promise<void> {
  const email = process.env['PLATFORM_ADMIN_EMAIL'];
  const password = process.env['PLATFORM_ADMIN_PASSWORD'];

  if (!email) throw new Error('PLATFORM_ADMIN_EMAIL must be set.');
  assertStrongAdminPassword(password);

  const pool = new Pool({ connectionString: env.DATABASE_OWNER_URL, max: 1 });
  try {
    const { created } = await ensurePlatformAdmin(pool, { email, password });
    const loginUrl = `${env.APP_PROTOCOL}://admin.${env.ROOT_DOMAIN}`;
    console.log(
      created
        ? `[bootstrap] Platform superadmin "${email}" created. Login at ${loginUrl}`
        : `[bootstrap] Platform superadmin "${email}" already exists — no change. Login at ${loginUrl}`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[bootstrap] FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
