import 'server-only';
import { eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { users, type Role } from '@/db/schema';
import { generateTempPassword } from '@/lib/provisioning';
import { hashPassword } from '@/lib/password';
import { checkUserCapacity, type Entitlements } from '@/lib/gating';

export type TeamUser = {
  id: number;
  email: string;
  role: Role;
  createdAt: Date | null;
  mustChangePassword: boolean;
};

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`E-Mail ${email} ist in diesem Shop bereits vergeben.`);
    this.name = 'DuplicateEmailError';
  }
}

export async function listTeamUsers(ctx: TenantCtx): Promise<TeamUser[]> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .orderBy(users.id);
    return rows;
  });
}

function pgErrorCode(err: unknown): string | undefined {
  return (
    (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code
  );
}

/**
 * User-Anlage (Wizard Schritt 3 + Team-Tab, Spec §11.3/§12): maxUsers-Gate NUR für
 * Staff-Rollen (kunde zählt nicht, Spec §10), Kapazitätsprüfung in DERSELBEN Tx wie der
 * Insert. Passwort generiert + mustChangePassword=true; Mail ist Sache des Aufrufers.
 */
export async function createTeamUser(
  ctx: TenantCtx,
  ent: Entitlements,
  input: { email: string; role: 'mitarbeiter' | 'kunde' },
): Promise<{ userId: number; temporaryPassword: string }> {
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const userId = await withTenant(ctx, async (tx) => {
    if (input.role !== 'kunde') {
      await checkUserCapacity(tx, ent, 1); // wirft LimitExceededError (CONTRACTS C8)
    }
    try {
      const [u] = await tx
        .insert(users)
        .values({
          tenantId: ctx.tenantId,
          email: input.email,
          password: passwordHash,
          role: input.role,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
      return u!.id;
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw new DuplicateEmailError(input.email);
      throw err;
    }
  });

  return { userId, temporaryPassword };
}

/** Neues temp. Passwort + mustChangePassword=true. null, wenn der User nicht (im Tenant) existiert. */
export async function resetTeamUserPassword(
  ctx: TenantCtx,
  userId: number,
): Promise<{ email: string; temporaryPassword: string } | null> {
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return withTenant(ctx, async (tx) => {
    const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return null;
    await tx
      .update(users)
      .set({ password: passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return { email: u.email, temporaryPassword };
  });
}
