import { describe, expect, it } from 'vitest';
import {
  RESERVED_SUBDOMAINS,
  parseTenantSlug,
  type SubdomainResult,
} from '@/lib/subdomain';

describe('RESERVED_SUBDOMAINS', () => {
  it('contains the required 10 entries', () => {
    for (const s of [
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
    ]) {
      expect(RESERVED_SUBDOMAINS.has(s)).toBe(true);
    }
  });
});

describe('parseTenantSlug', () => {
  const cases: Array<[string | null, string, SubdomainResult]> = [
    // tenant cases
    ['demo.localhost', 'localhost', { kind: 'tenant', slug: 'demo' }],
    ['DEMO.localhost', 'localhost', { kind: 'tenant', slug: 'demo' }],
    ['demo.localhost:3000', 'localhost', { kind: 'tenant', slug: 'demo' }],
    ['vinylcave.localhost', 'localhost', { kind: 'tenant', slug: 'vinylcave' }],
    ['demo.example.com', 'example.com', { kind: 'tenant', slug: 'demo' }],
    ['DEMO.EXAMPLE.COM', 'example.com', { kind: 'tenant', slug: 'demo' }],
    ['demo.example.com:443', 'example.com', { kind: 'tenant', slug: 'demo' }],
    // none cases
    ['localhost', 'localhost', { kind: 'none' }],
    ['localhost:3000', 'localhost', { kind: 'none' }],
    [null, 'localhost', { kind: 'none' }],
    ['example.com', 'example.com', { kind: 'none' }],
    ['unrelated.com', 'localhost', { kind: 'none' }],
    ['a.b.localhost', 'localhost', { kind: 'none' }], // nested — no nested subdomains
    // reserved cases
    ['www.localhost', 'localhost', { kind: 'reserved' }],
    ['app.localhost', 'localhost', { kind: 'reserved' }],
    ['api.localhost', 'localhost', { kind: 'reserved' }],
    ['admin.localhost', 'localhost', { kind: 'reserved' }],
    ['auth.localhost', 'localhost', { kind: 'reserved' }],
    ['static.localhost', 'localhost', { kind: 'reserved' }],
    ['_next.localhost', 'localhost', { kind: 'reserved' }],
    ['cdn.localhost', 'localhost', { kind: 'reserved' }],
    ['mail.localhost', 'localhost', { kind: 'reserved' }],
    ['assets.localhost', 'localhost', { kind: 'reserved' }],
    ['www.example.com', 'example.com', { kind: 'reserved' }],
    ['WWW.localhost', 'localhost', { kind: 'reserved' }], // case-insensitive reserved check
  ];

  it.each(cases)(
    'parseTenantSlug(%s, %s) → %o',
    (host, domain, expected) => {
      expect(parseTenantSlug(host, domain)).toEqual(expected);
    },
  );
});

describe('isPlatformHost', () => {
  it('erkennt exakt admin.<rootDomain> (case-insensitiv, Port-strip)', async () => {
    const { isPlatformHost } = await import('@/lib/subdomain');
    expect(isPlatformHost('admin.localhost', 'localhost')).toBe(true);
    expect(isPlatformHost('admin.localhost:3000', 'localhost')).toBe(true);
    expect(isPlatformHost('ADMIN.Localhost:3000', 'localhost')).toBe(true);
  });

  it('lehnt alles andere ab (Tenant, nested, root, leer)', async () => {
    const { isPlatformHost } = await import('@/lib/subdomain');
    expect(isPlatformHost('demo.localhost', 'localhost')).toBe(false);
    expect(isPlatformHost('admin.demo.localhost', 'localhost')).toBe(false);
    expect(isPlatformHost('localhost', 'localhost')).toBe(false);
    expect(isPlatformHost('admin.evil.com', 'localhost')).toBe(false);
    expect(isPlatformHost(null, 'localhost')).toBe(false);
    expect(isPlatformHost('admin.localhost', '')).toBe(false);
  });
});
