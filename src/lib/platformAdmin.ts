import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '@/db/schema';
import { hashPassword } from '@/lib/password';

const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Fail-closed guard for the production platform-admin password. Throws (does not return)
 * when the password is absent or too weak, so the bootstrap one-shot never creates a
 * guessable superadmin.
 */
export function assertStrongAdminPassword(password: string | undefined): asserts password is string {
  if (!password || password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `PLATFORM_ADMIN_PASSWORD must be set and at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long.`,
    );
  }
}

/**
 * Idempotent, NON-destructive platform superadmin bootstrap. Inserts one `platform_users`
 * row (bcrypt-hashed password) when the email is absent; if a row already exists it is left
 * untouched (a re-run never resets a password the operator may have changed via the UI).
 * Reuses the exact table + hashing contract of scripts/seed.ts::ensurePlatformUser, minus any
 * fixture/tenant data.
 */
export async function ensurePlatformAdmin(
  ownerPool: Pool,
  args: { email: string; password: string },
): Promise<{ created: boolean }> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.platformUsers.id })
    .from(schema.platformUsers)
    .where(eq(schema.platformUsers.email, args.email))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    return { created: false };
  }

  await db
    .insert(schema.platformUsers)
    .values({ email: args.email, password: await hashPassword(args.password) });

  return { created: true };
}
