import 'server-only';
import { eq } from 'drizzle-orm';
import type { Adapter, AdapterSession, AdapterUser } from 'next-auth/adapters';
import { withTenant } from '@/db/tenant';
import { sessions, users } from '@/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import type { SessionUser } from './schema-types';

export type TenantSession = { sessionToken: string; userId: number; expires: Date };
export type TenantSessionAndUser = { session: TenantSession; user: SessionUser };

// tenant_id is passed explicitly so the RLS WITH CHECK (tenant_id = GUC) holds
export async function createTenantSession(tenantId: number, data: TenantSession): Promise<void> {
  await withTenant({ tenantId, userId: null }, async (tx) => {
    await tx.insert(sessions).values({
      sessionToken: data.sessionToken,
      userId: data.userId,
      tenantId,
      expires: data.expires,
    });
  });
}

export async function getTenantSessionAndUser(
  tenantId: number,
  sessionToken: string,
): Promise<TenantSessionAndUser | null> {
  return withTenant({ tenantId, userId: null }, async (tx) => {
    const rows = await tx
      .select({
        sToken: sessions.sessionToken,
        sUser: sessions.userId,
        sExpires: sessions.expires,
        uId: users.id,
        uEmail: users.email,
        uTenant: users.tenantId,
        uRole: users.role,
        uSuper: users.isSuperadmin,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      session: { sessionToken: r.sToken, userId: r.sUser, expires: r.sExpires },
      user: { id: r.uId, email: r.uEmail, tenantId: r.uTenant, role: r.uRole, isSuperadmin: r.uSuper },
    };
  });
}

export async function deleteTenantSession(tenantId: number, sessionToken: string): Promise<void> {
  await withTenant({ tenantId, userId: null }, async (tx) => {
    await tx.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
  });
}

export async function updateTenantSessionExpiry(
  tenantId: number,
  sessionToken: string,
  expires: Date,
): Promise<void> {
  await withTenant({ tenantId, userId: null }, async (tx) => {
    await tx.update(sessions).set({ expires }).where(eq(sessions.sessionToken, sessionToken));
  });
}

export async function getTenantUser(tenantId: number, userId: number): Promise<SessionUser | null> {
  return withTenant({ tenantId, userId: null }, async (tx) => {
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    const u = rows[0];
    if (!u) return null;
    return { id: u.id, email: u.email, tenantId: u.tenantId, role: u.role, isSuperadmin: u.isSuperadmin };
  });
}

function toAdapterUser(user: SessionUser): AdapterUser {
  return {
    id: String(user.id),
    email: user.email,
    emailVerified: null,
    tenantId: user.tenantId,
    role: user.role,
    isSuperadmin: user.isSuperadmin,
  } as unknown as AdapterUser;
}

export function DrizzleTenantAdapter(): Adapter {
  return {
    async createSession(session) {
      const tenant = await getCurrentTenant();
      await createTenantSession(tenant.id, {
        sessionToken: session.sessionToken,
        userId: Number(session.userId),
        expires: session.expires,
      });
      return session;
    },
    async getSessionAndUser(sessionToken) {
      const tenant = await getCurrentTenant();
      const res = await getTenantSessionAndUser(tenant.id, sessionToken);
      if (!res) return null;
      const session: AdapterSession = {
        sessionToken: res.session.sessionToken,
        userId: String(res.session.userId),
        expires: res.session.expires,
      };
      return { session, user: toAdapterUser(res.user) };
    },
    async updateSession(session) {
      const tenant = await getCurrentTenant();
      if (session.expires) {
        await updateTenantSessionExpiry(tenant.id, session.sessionToken, session.expires);
      }
      return undefined;
    },
    async deleteSession(sessionToken) {
      const tenant = await getCurrentTenant();
      await deleteTenantSession(tenant.id, sessionToken);
    },
    async getUser(id) {
      const tenant = await getCurrentTenant();
      const u = await getTenantUser(tenant.id, Number(id));
      return u ? toAdapterUser(u) : null;
    },
  };
}
