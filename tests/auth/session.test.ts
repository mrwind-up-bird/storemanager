import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the heavy import chain so `@/auth/session` can be unit-tested in pure Node
// without loading NextAuth/@/env (which would require the full runtime env).
// redirect()/forbidden() are control-flow interrupts in production — model them as throws.
// vi.hoisted() so these are initialised before the hoisted vi.mock factories run.
const { auth, getCurrentTenant } = vi.hoisted(() => ({
  auth: vi.fn(),
  getCurrentTenant: vi.fn(),
}));

vi.mock('@/auth/index', () => ({ auth }));
vi.mock('@/lib/tenant', () => ({ getCurrentTenant }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  forbidden: vi.fn(() => {
    throw new Error('FORBIDDEN');
  }),
}));

import { assertSessionTenant, TenantMismatchError, requireSession, getSessionUser } from '@/auth/session';
import type { SessionUser } from '@/auth/schema-types';

const base: SessionUser = {
  id: 7,
  email: 'u@t.test',
  tenantId: 1,
  role: 'admin',
  isSuperadmin: false,
};

beforeEach(() => {
  auth.mockReset();
  getCurrentTenant.mockReset();
});

describe('assertSessionTenant (session↔tenant invariant)', () => {
  it('passes when the session tenant matches the resolved tenant', () => {
    expect(() => assertSessionTenant(base, 1)).not.toThrow();
  });

  it('throws TenantMismatchError when a tenant-A user is served under tenant B', () => {
    expect(() => assertSessionTenant(base, 2)).toThrow(TenantMismatchError);
  });

  it('exempts superadmins and logs an audit line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const su: SessionUser = { ...base, isSuperadmin: true };
    expect(() => assertSessionTenant(su, 999)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('requireSession (centrally enforced 403 invariant)', () => {
  it('redirects to /login when there is no session', async () => {
    auth.mockResolvedValue(null);
    await expect(requireSession()).rejects.toThrow('REDIRECT:/login');
    expect(getCurrentTenant).not.toHaveBeenCalled();
  });

  it('returns the user when the session tenant matches the request tenant', async () => {
    auth.mockResolvedValue({ user: { ...base, id: String(base.id) } });
    getCurrentTenant.mockResolvedValue({ id: 1 });
    await expect(requireSession()).resolves.toMatchObject({ id: 7, tenantId: 1 });
  });

  it('responds 403 (forbidden) when a tenant-A user is served under tenant B', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    auth.mockResolvedValue({ user: { ...base, id: String(base.id) } });
    getCurrentTenant.mockResolvedValue({ id: 2 });
    await expect(requireSession()).rejects.toThrow('FORBIDDEN');
    warn.mockRestore();
  });

  it('exempts a superadmin served under a foreign tenant (the ONLY exemption)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    auth.mockResolvedValue({ user: { ...base, id: String(base.id), isSuperadmin: true } });
    getCurrentTenant.mockResolvedValue({ id: 999 });
    await expect(requireSession()).resolves.toMatchObject({ id: 7, isSuperadmin: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('getSessionUser', () => {
  it('returns null when there is no session', async () => {
    auth.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });

  it('maps the Auth.js session.user into a typed SessionUser', async () => {
    auth.mockResolvedValue({ user: { ...base, id: String(base.id) } });
    expect(await getSessionUser()).toEqual(base);
  });
});
