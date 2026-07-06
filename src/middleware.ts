// src/middleware.ts
// Edge runtime — DO NOT import from src/db/, src/lib/tenant.ts, or any Node-only package.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parseTenantSlug, isPlatformHost } from '@/lib/subdomain';

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
  const { pathname } = request.nextUrl;

  // Header-Hygiene ZUERST, auf jedem Pfad: client-gelieferte Zonen-/Tenant-Header strippen —
  // nur die Middleware darf x-tenant-slug und x-platform-zone setzen (Spec §4.1/§13.3).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-tenant-slug');
  requestHeaders.delete('x-platform-zone');

  // Direkter /platform*-Request ist auf JEDEM Host 404 — die Zone ist ausschließlich über den
  // Rewrite unten erreichbar (ein Rewrite durchläuft die Middleware nicht erneut) (Spec §4.3).
  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    return new NextResponse(null, { status: 404 });
  }

  // Stripe-Webhook: exakter Pfad, host-unabhängig erlaubt — die Signaturprüfung im Handler
  // ist der Wächter (Spec §4.4/§9.1). Kein Tenant-Header nötig (Owner-Kontext im Handler).
  if (pathname === '/api/billing/webhook') {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Platform-Zone: Host ist exakt admin.<ROOT_DOMAIN> → Rewrite auf /platform/* (Spec §4.2).
  // Greift VOR dem reserved-404 — 'admin' bleibt in RESERVED_SUBDOMAINS.
  if (isPlatformHost(host, ROOT_DOMAIN)) {
    // Geteilte Root-Assets NICHT rewriten: der Matcher schließt sie nicht aus, und das
    // Root-Layout referenziert sie auf jeder Seite. /sw.js und /icons/* liegen als
    // /public-Statics nur unter ihrem Original-Pfad — ein Rewrite auf /platform/... wäre
    // ein 404 für Icons/Service-Worker auf admin.<ROOT_DOMAIN>. (/manifest.webmanifest
    // bleibt hier bewusst mit drin: der reguläre Not-Found-Pfad greift, Spec §4 will
    // ohnehin „kein PWA" für die Platform-Zone.)
    if (
      pathname === '/manifest.webmanifest' ||
      pathname === '/sw.js' ||
      pathname.startsWith('/icons/')
    ) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    requestHeaders.set('x-platform-zone', '1');
    const url = request.nextUrl.clone();
    url.pathname = pathname === '/' ? '/platform' : `/platform${pathname}`;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  const result = parseTenantSlug(host, ROOT_DOMAIN);

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
