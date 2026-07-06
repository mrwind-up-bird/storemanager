import 'server-only';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/env';
import { withOwner } from '@/db/tenant';
import { platformSessions, platformUsers } from '@/db/schema';
import { DUMMY_BCRYPT_HASH } from '@/lib/password';

// ---------------------------------------------------------------------------
// Cookie (Muster wie SESSION_COOKIE_NAME in src/auth/config.ts: __Host- nur unter https)
// ---------------------------------------------------------------------------

/** Pure — unit-testbar (Muster discogsOAuthCookieName). */
export function platformCookieName(protocol: 'http' | 'https'): string {
  return protocol === 'https' ? '__Host-qr.platform' : 'qr.platform';
}

const USE_SECURE = env.APP_PROTOCOL === 'https';
export const PLATFORM_COOKIE_NAME = platformCookieName(env.APP_PROTOCOL);

/** 24 h — bewusst kürzer als die 30-Tage-Tenant-Session (Spec §5). */
export const PLATFORM_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function platformSessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: USE_SECURE,
    maxAge: PLATFORM_SESSION_TTL_MS / 1000,
  };
}

// ---------------------------------------------------------------------------
// Credentials + Session-Lebenszyklus (ALLE Zugriffe via withOwner — die
// Platform-Tabellen haben keine qr_app-Grants, Global Constraint 1)
// ---------------------------------------------------------------------------

export type PlatformUser = { id: number; email: string };

export async function verifyPlatformCredentials(
  email: string,
  password: string,
): Promise<PlatformUser | null> {
  const rows = await withOwner((tx) =>
    tx.select().from(platformUsers).where(eq(platformUsers.email, email)).limit(1),
  );
  const u = rows[0];
  // Dummy-Vergleich bei fehlender Zeile — kein Timing-Orakel (Muster verifyCredentials).
  const ok = await bcrypt.compare(password, u?.password ?? DUMMY_BCRYPT_HASH);
  if (!u || !ok) return null;
  return { id: u.id, email: u.email };
}

export async function createPlatformSession(
  platformUserId: number,
): Promise<{ token: string; expires: Date }> {
  const token = randomUUID();
  const expires = new Date(Date.now() + PLATFORM_SESSION_TTL_MS);
  await withOwner((tx) => tx.insert(platformSessions).values({ token, platformUserId, expires }));
  return { token, expires };
}

/** Token → PlatformUser; abgelaufene Session wird beim Lookup opportunistisch gelöscht (Spec §5). */
export async function getPlatformSessionByToken(token: string): Promise<PlatformUser | null> {
  return withOwner(async (tx) => {
    const rows = await tx
      .select({
        expires: platformSessions.expires,
        id: platformUsers.id,
        email: platformUsers.email,
      })
      .from(platformSessions)
      .innerJoin(platformUsers, eq(platformSessions.platformUserId, platformUsers.id))
      .where(eq(platformSessions.token, token))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    if (r.expires.getTime() <= Date.now()) {
      await tx.delete(platformSessions).where(eq(platformSessions.token, token));
      return null;
    }
    return { id: r.id, email: r.email };
  });
}

export async function getPlatformSession(): Promise<PlatformUser | null> {
  const jar = await cookies();
  const token = jar.get(PLATFORM_COOKIE_NAME)?.value;
  if (!token) return null;
  return getPlatformSessionByToken(token);
}

export async function requirePlatformSession(): Promise<PlatformUser> {
  const user = await getPlatformSession();
  // Zone-relativ: auf admin.<host> rewritet die Middleware /login → /platform/login.
  if (!user) redirect('/login');
  return user;
}

export async function destroyPlatformSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PLATFORM_COOKIE_NAME)?.value;
  if (token) {
    await withOwner((tx) => tx.delete(platformSessions).where(eq(platformSessions.token, token)));
  }
  // NICHT jar.delete(): das erzeugte Lösch-Set-Cookie trägt kein Secure-Attribut, und
  // Browser verwerfen JEDES __Host--Set-Cookie ohne Secure+Path=/ — das Login-Cookie
  // bliebe in Produktion bis zum TTL-Ablauf bestehen (Spec §5: „Cookie clearen").
  // Löschen daher mit denselben Attributen wie beim Setzen, maxAge 0.
  jar.set(PLATFORM_COOKIE_NAME, '', { ...platformSessionCookieOptions(), maxAge: 0 });
}
