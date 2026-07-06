import 'server-only';
import { encode as defaultEncode } from 'next-auth/jwt';
import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { env } from '@/env';
import { withTenant } from '@/db/tenant';
import { users } from '@/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { DUMMY_BCRYPT_HASH } from '@/lib/password';
import { DrizzleTenantAdapter, createTenantSession } from './adapter';
import type { Role, SessionUser } from './schema-types';

const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_S * 1000;

// `__Host-` cookies REQUIRE the Secure attribute, which browsers only accept over HTTPS.
// Slice-0 dev runs over http on *.localhost, so derive the cookie from the protocol:
// prod (https) → `__Host-` + Secure; dev (http) → plain name, no Secure. Exported so tests
// and any cookie-reading code agree on the name (it changes between dev and prod).
const USE_SECURE_COOKIES = env.APP_PROTOCOL === 'https';
export const SESSION_COOKIE_NAME = USE_SECURE_COOKIES
  ? '__Host-authjs.session-token'
  : 'authjs.session-token';

export async function verifyCredentials(args: {
  email: string;
  password: string;
  tenantId: number;
}): Promise<SessionUser | null> {
  return withTenant({ tenantId: args.tenantId, userId: null }, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.email, args.email), eq(users.tenantId, args.tenantId)))
      .limit(1);
    const u = rows[0];
    // Always run a bcrypt compare (dummy hash when the user is absent) to avoid a
    // user-enumeration timing oracle between "unknown email" and "wrong password".
    const ok = await bcrypt.compare(args.password, u?.password ?? DUMMY_BCRYPT_HASH);
    if (!u || !ok) return null;
    return { id: u.id, email: u.email, tenantId: u.tenantId, role: u.role, isSuperadmin: u.isSuperadmin, mustChangePassword: u.mustChangePassword };
  });
}

export const authConfig: NextAuthConfig = {
  adapter: DrizzleTenantAdapter(),
  // NOTE: do NOT set `strategy: 'database'` explicitly. Auth.js's config assertion throws
  // UnsupportedStrategy ("Signing in with credentials only supported if JWT strategy is
  // enabled") whenever `session.strategy === 'database'` AND every provider is credentials
  // (see @auth/core lib/utils/assert.js). Omitting the strategy keeps the EFFECTIVE strategy
  // as 'database' anyway — init.js defaults to `adapter ? 'database' : 'jwt'` — so the opaque
  // session token minted by jwt.encode below is still persisted + resolved via the tenant
  // adapter (getSessionAndUser), without tripping the assertion. This is the canonical
  // Auth.js credentials-with-database-sessions recipe.
  session: { maxAge: SESSION_MAX_AGE_S },
  trustHost: true,
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: USE_SECURE_COOKIES },
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = typeof creds?.email === 'string' ? creds.email : '';
        const password = typeof creds?.password === 'string' ? creds.password : '';
        if (!email || !password) return null;
        const tenant = await getCurrentTenant();
        const user = await verifyCredentials({ email, password, tenantId: tenant.id });
        return user ? { ...user, id: String(user.id) } : null;
      },
    }),
  ],
  callbacks: {
    jwt({ token, account }) {
      if (account?.provider === 'credentials') {
        (token as { credentials?: boolean }).credentials = true;
      }
      return token;
    },
    session({ session, user }) {
      if (session.user) {
        const u = user as unknown as {
          tenantId: number;
          role: Role;
          isSuperadmin: boolean;
          mustChangePassword: boolean;
        };
        const target = session.user as unknown as Record<string, unknown>;
        target.tenantId = u.tenantId;
        target.role = u.role;
        target.isSuperadmin = u.isSuperadmin;
        target.mustChangePassword = u.mustChangePassword;
      }
      return session;
    },
  },
  jwt: {
    async encode(params) {
      if ((params.token as { credentials?: boolean } | undefined)?.credentials) {
        const userId = params.token?.sub;
        if (!userId) throw new Error('credentials session missing user id');
        const tenant = await getCurrentTenant();
        const sessionToken = randomUUID();
        const expires = new Date(Date.now() + SESSION_MAX_AGE_MS);
        await createTenantSession(tenant.id, { sessionToken, userId: Number(userId), expires });
        return sessionToken;
      }
      return defaultEncode(params);
    },
  },
};
