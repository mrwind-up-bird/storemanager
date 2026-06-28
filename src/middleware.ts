// src/middleware.ts
// Edge runtime — DO NOT import from src/db/, src/lib/tenant.ts, or any Node-only package.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parseTenantSlug } from '@/lib/subdomain';

// ROOT_DOMAIN is read directly from process.env (not from src/env.ts which is
// Node-only and uses zod). Middleware is fail-closed: missing ROOT_DOMAIN →
// treat every host as having no subdomain → 404 for all app routes.
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? '';

// Set TRUST_PROXY=1 in production behind a load-balancer that guarantees
// X-Forwarded-Host. If unset, the Host header is used exclusively (safer
// default — prevents host-header injection from untrusted proxies).
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

/**
 * Paths that Next.js infrastructure or the auth layer must always be able to
 * reach, regardless of whether a tenant subdomain is present.
 */
const ALWAYS_ALLOW_PREFIXES = [
  '/_next/',
  '/api/auth/',
  '/favicon.ico',
  '/robots.txt',
] as const;

function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOW_PREFIXES.some((p) => pathname.startsWith(p));
}

function resolveHost(request: NextRequest): string {
  if (TRUST_PROXY) {
    const forwarded = request.headers.get('x-forwarded-host');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return request.headers.get('host') ?? '';
}

export function middleware(request: NextRequest): NextResponse {
  const host = resolveHost(request);
  const result = parseTenantSlug(host, ROOT_DOMAIN);

  // Strip any client-supplied tenant header on EVERY path before branching — only
  // middleware may set x-tenant-slug. Without this, a spoofed header survives on
  // always-allowed routes (e.g. /api/auth/*) → confused-deputy tenant resolution.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-tenant-slug');

  if (result.kind === 'tenant') {
    // Forward the resolved slug to Server Components via a request header.
    requestHeaders.set('x-tenant-slug', result.slug);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // reserved or none: let through infrastructure routes (header stripped); 404 everything else.
  if (isAlwaysAllowed(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - _next/static  (Next.js built assets)
     *  - _next/image   (Next.js image optimisation)
     *  - favicon.ico, robots.txt (browser-requested metadata)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)',
  ],
};
