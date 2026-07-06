// src/lib/subdomain.ts
// Edge-safe: no Node-only imports, no process.env, no DB.

export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'auth',
  'static',
  '_next',
  'cdn',
  'mail',
  'assets',
]);

export type SubdomainResult =
  | { kind: 'tenant'; slug: string }
  | { kind: 'reserved' }
  | { kind: 'none' };

/**
 * Extract the tenant slug from a Host header value.
 *
 * Rules (all comparisons case-insensitive; slug is always returned lowercase):
 *  - null / empty host                         → 'none'
 *  - host (without port) equals rootDomain     → 'none'
 *  - host does not end with `.${rootDomain}`   → 'none'
 *  - label before rootDomain contains a dot    → 'none'  (no nested subdomains)
 *  - label is in RESERVED_SUBDOMAINS           → 'reserved'
 *  - otherwise                                 → { kind: 'tenant', slug }
 */
export function parseTenantSlug(
  host: string | null,
  rootDomain: string,
): SubdomainResult {
  if (!host) return { kind: 'none' };

  // Strip port
  const h = host.split(':')[0].toLowerCase();
  const rd = rootDomain.toLowerCase();

  if (h === rd) return { kind: 'none' };

  const suffix = `.${rd}`;
  if (!h.endsWith(suffix)) return { kind: 'none' };

  const label = h.slice(0, h.length - suffix.length);

  // No nested subdomains (e.g. a.b.localhost)
  if (label.includes('.')) return { kind: 'none' };
  if (!label) return { kind: 'none' };

  if (RESERVED_SUBDOMAINS.has(label)) return { kind: 'reserved' };

  return { kind: 'tenant', slug: label };
}

/**
 * True gdw. der Host (ohne Port, case-insensitiv) EXAKT `admin.<rootDomain>` ist.
 * Leerer rootDomain → immer false (fail-closed, wie die Middleware bei fehlendem ROOT_DOMAIN).
 */
export function isPlatformHost(host: string | null, rootDomain: string): boolean {
  if (!host || !rootDomain) return false;
  const h = host.split(':')[0].toLowerCase();
  return h === `admin.${rootDomain.toLowerCase()}`;
}
