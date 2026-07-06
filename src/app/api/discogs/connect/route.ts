import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { env, tenantUrl } from '@/env';
import { encryptSecret } from '@/lib/crypto';
import { getDiscogsAdapter } from '@/lib/discogs/index';
import { discogsOAuthCookieName, resolveReturnTarget } from '../_shared';

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  const tenant = await getCurrentTenant();
  const callbackUrl = `${tenantUrl(tenant.slug)}/api/discogs/callback`;
  const { token, tokenSecret, authorizeUrl } =
    await getDiscogsAdapter().getRequestToken(callbackUrl);

  const returnTo = resolveReturnTarget(request.nextUrl.searchParams.get('from'));
  const cookieValue = encryptSecret(JSON.stringify({ token, tokenSecret, returnTo }), {
    tenantId: user.tenantId,
  });
  (await cookies()).set(discogsOAuthCookieName(env.APP_PROTOCOL), cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.APP_PROTOCOL === 'https',
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl);
}
