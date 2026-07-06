import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { env, tenantUrl } from '@/env';
import { decryptSecret } from '@/lib/crypto';
import { getDiscogsAdapter } from '@/lib/discogs/index';
import { upsertConnection } from '@/lib/discogs-connection';
import { discogsOAuthCookieName, parseCallbackParams, resolveReturnTarget, RETURN_PATHS } from '../_shared';

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireSession();
  const tenant = await getCurrentTenant();

  const jar = await cookies();
  const name = discogsOAuthCookieName(env.APP_PROTOCOL);
  const raw = jar.get(name)?.value;

  // returnTo steckt im verschlüsselten State-Cookie; ohne Cookie → Default 'ankauf'.
  let returnTo = resolveReturnTarget(null);
  let state: { token: string; tokenSecret: string } | null = null;
  if (raw) {
    try {
      const parsedState = JSON.parse(decryptSecret(raw, { tenantId: user.tenantId })) as {
        token: string;
        tokenSecret: string;
        returnTo?: unknown;
      };
      returnTo = resolveReturnTarget(parsedState.returnTo);
      state = { token: parsedState.token, tokenSecret: parsedState.tokenSecret };
    } catch {
      state = null;
    }
  }
  const back = (kind: 'ok' | 'err'): NextResponse =>
    NextResponse.redirect(`${tenantUrl(tenant.slug)}${RETURN_PATHS[returnTo][kind]}`);

  const { oauthToken, verifier } = parseCallbackParams(request.nextUrl.searchParams);
  if (!state || !oauthToken || !verifier) return back('err');
  try {
    if (state.token !== oauthToken) return back('err');
    const access = await getDiscogsAdapter().getAccessToken({
      requestToken: state.token,
      requestTokenSecret: state.tokenSecret,
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
    return back('ok');
  } catch {
    return back('err');
  }
}
