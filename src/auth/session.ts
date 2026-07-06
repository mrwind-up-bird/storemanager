import 'server-only';
import { redirect, forbidden } from 'next/navigation';
import { auth } from './index';
import { getCurrentTenant } from '@/lib/tenant';
import type { Role, SessionUser } from './schema-types';

export class TenantMismatchError extends Error {
  constructor(
    public readonly userId: number,
    public readonly sessionTenantId: number,
    public readonly resolvedTenantId: number,
  ) {
    super(`session tenant ${sessionTenantId} does not match resolved tenant ${resolvedTenantId}`);
    this.name = 'TenantMismatchError';
  }
}

// LOCKED invariant: superadmin is the only exemption and is audit-logged.
export function assertSessionTenant(user: SessionUser, resolvedTenantId: number): void {
  if (user.isSuperadmin) {
    console.warn(`[audit] superadmin user=${user.id} accessed tenant=${resolvedTenantId}`);
    return;
  }
  if (user.tenantId !== resolvedTenantId) {
    throw new TenantMismatchError(user.id, user.tenantId, resolvedTenantId);
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user as Record<string, unknown> | undefined;
  if (!u || u.email == null || u.tenantId == null) return null;
  return {
    id: Number(u.id),
    email: String(u.email),
    tenantId: Number(u.tenantId),
    role: u.role as Role,
    isSuperadmin: Boolean(u.isSuperadmin),
    mustChangePassword: Boolean(u.mustChangePassword),
  };
}

export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const tenant = await getCurrentTenant();
  try {
    assertSessionTenant(user, tenant.id);
  } catch (err) {
    console.error(
      `[security] session↔tenant invariant violated: ${err instanceof Error ? err.message : String(err)}`,
    );
    forbidden(); // → HTTP 403 (requires experimental.authInterrupts)
  }
  return user;
}
