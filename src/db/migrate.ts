import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');

/**
 * Applies drizzle/0000,0001,0002 (in journal order) as the owner role.
 * Used by docker/entrypoint-web.sh, `pnpm db:migrate`, and the test helpers.
 *
 * NOTE: no `import 'server-only'` here — this module runs directly via tsx
 * (CLI / entrypoint) and is imported by tests, so it must stay out of the RSC bundle.
 */
export async function runMigrations(connectionString?: string): Promise<void> {
  const url = connectionString ?? process.env.DATABASE_OWNER_URL;
  if (!url) {
    throw new Error('runMigrations requires a connection string or DATABASE_OWNER_URL');
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

// CLI entry: `tsx src/db/migrate.ts` (pnpm db:migrate).
// `require.main` is undefined under tsx ESM, so compare the resolved entry URL instead.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runMigrations()
    .then(() => {
      console.log('[migrate] migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
