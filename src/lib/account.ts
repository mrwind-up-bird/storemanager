import 'server-only';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { users } from '@/db/schema';
import { DUMMY_BCRYPT_HASH, hashPassword } from '@/lib/password';

/**
 * Passwortwechsel (Spec §11): altes Passwort verifizieren (Dummy-Hash-Fallback gegen
 * Timing-Orakel), neues hashen, mustChangePassword=false — alles in einer Tenant-Tx.
 * false = aktuelles Passwort falsch (oder User-Zeile weg).
 */
export async function verifyAndChangePassword(
  ctx: TenantCtx,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const newHash = await hashPassword(newPassword);
  return withTenant(ctx, async (tx) => {
    if (ctx.userId === null) return false;
    const [u] = await tx.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
    const ok = await bcrypt.compare(currentPassword, u?.password ?? DUMMY_BCRYPT_HASH);
    if (!u || !ok) return false;
    await tx
      .update(users)
      .set({ password: newHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, u.id));
    return true;
  });
}
