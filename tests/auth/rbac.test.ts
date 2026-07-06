import { describe, it, expect } from 'vitest';
import { can } from '@/auth/rbac';
import type { SessionUser } from '@/auth/schema-types';
import type { Role } from '@/db/schema';

const mk = (role: Role, isSuperadmin = false): SessionUser => ({
  id: 1,
  email: 'a@b.test',
  tenantId: 1,
  role,
  isSuperadmin,
  mustChangePassword: false,
});

describe('can()', () => {
  it('kunde reads records but cannot write them', () => {
    expect(can(mk('kunde'), 'records:read')).toBe(true);
    expect(can(mk('kunde'), 'records:write')).toBe(false);
    expect(can(mk('kunde'), 'tenant:admin')).toBe(false);
  });

  it('mitarbeiter writes records but is not a tenant admin', () => {
    expect(can(mk('mitarbeiter'), 'records:write')).toBe(true);
    expect(can(mk('mitarbeiter'), 'tenant:admin')).toBe(false);
  });

  it('admin gets tenant:admin but not platform:superadmin', () => {
    expect(can(mk('admin'), 'records:write')).toBe(true);
    expect(can(mk('admin'), 'tenant:admin')).toBe(true);
    expect(can(mk('admin'), 'platform:superadmin')).toBe(false);
  });

  it('the isSuperadmin flag grants every capability incl platform:superadmin', () => {
    expect(can(mk('kunde', true), 'platform:superadmin')).toBe(true);
    expect(can(mk('superadmin'), 'platform:superadmin')).toBe(true);
  });
});
