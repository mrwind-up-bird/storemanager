import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { env, tenantUrl } from '@/env';
import { decryptSecret } from '@/lib/crypto';
import { getDiscogsAdapter } from '@/lib/discogs/index';
import { upsertConnection } from '@/lib/discogs-connection';
import { discogsOAuthCookieName, parseCallbackParams } from '../_shared';

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireSession();
  const tenant = await getCurrentTenant();
  const back = (q: string): NextResponse =>
    NextResponse.redirect(`${tenantUrl(tenant.slug)}/ankauf?${q}`);
  const { oauthToken, verifier } = parseCallbackParams(request.nextUrl.searchParams);

  const jar = await cookies();
  const name = discogsOAuthCookieName(env.APP_PROTOCOL);
  const raw = jar.get(name)?.value;
  if (!raw || !oauthToken || !verifier) return back('error=connect');
  try {
    const { token, tokenSecret } = JSON.parse(
      decryptSecret(raw, { tenantId: user.tenantId }),
    ) as { token: string; tokenSecret: string };
    if (token !== oauthToken) return back('error=connect');
    const access = await getDiscogsAdapter().getAccessToken({
      requestToken: token,
      requestTokenSecret: tokenSecret,
      verifier,
    });
    await upsertConnection(
      { tenantId: user.tenantId, userId: user.id },
      {
        discogsUsername: access.username,
        auth: { token: access.token, tokenSecret: access.tokenSecret },
        connectedByUserId: user.id,
      },
    );
    jar.delete(name);
    return back('connected=1');
  } catch {
    return back('error=connect');
  }
}
